import { Cache } from "@effected/store";
import type { AppDirs, AppDirsError } from "@effected/xdg";
import type { Vfs } from "@tsdoctor/vfs";
import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import { MAX_NESTING_DEPTH } from "./internal/limits.js";
import { isSafeRelativePath } from "./internal/resolution.js";
import { PackageSpec } from "./PackageSpec.js";

/**
 * Per-package cache metadata: the pinned version, when it was cached and how
 * long it lives.
 *
 * @remarks
 * Stored JSON-encoded in the metadata plane (`@effected/store`'s `Cache`);
 * `ttl` is also forwarded to the store's native TTL so expiry happens there
 * (evict-on-read, bulk prune). An absent `ttl` means the entry never expires.
 *
 * @public
 */
export class TypeCacheMetadata extends Schema.Class<TypeCacheMetadata>("TypeCacheMetadata")({
	/** The pinned version the files on disk belong to. */
	version: Schema.String,
	/** When the package was cached. */
	cachedAt: Schema.DateTimeUtcFromString,
	/** Time-to-live; absent = never expires. */
	ttl: Schema.optionalKey(Schema.DurationFromMillis),
}) {}

/** JSON codec for the metadata plane's stored bytes. */
const MetadataFromJson = Schema.fromJsonString(TypeCacheMetadata);

/**
 * Raised when a cache operation fails: disk IO, metadata-store IO, or a file
 * path that tries to escape the cache directory.
 *
 * @remarks
 * `cause` carries the underlying failure structurally (a `PlatformError`,
 * the store's `CacheError`, or a `SchemaError` from metadata decoding); v3
 * flattened everything to `message: String(error)`.
 *
 * @public
 */
export class TypeCacheError extends Schema.TaggedError<TypeCacheError>()("TypeCacheError", {
	/** The cache operation that failed. */
	operation: Schema.Literals([
		"exists",
		"read",
		"write",
		"list",
		"readMetadata",
		"writeMetadata",
		"getVfs",
		"remove",
		"prune",
	]),
	/** The file path or metadata key involved. */
	path: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Type cache ${this.operation} failed for "${this.path}"`;
	}
}

/**
 * Result of {@link TypeCacheShape.prune}: how many metadata entries were
 * evicted and which packages they were.
 *
 * @public
 */
export interface CachePruneResult {
	/** How many expired metadata entries were removed. */
	readonly count: number;
	/** The packages whose cache directories were deleted. */
	readonly removed: ReadonlyArray<{ readonly name: string; readonly version: string }>;
}

/**
 * The service shape {@link TypeCache} provides.
 *
 * @public
 */
export interface TypeCacheShape {
	/**
	 * Report whether the package's files exist on disk.
	 *
	 * @remarks
	 * A pure disk check — it does not consult metadata, so it distinguishes
	 * "files present" from "metadata live" (the stale-vs-miss ladder). Unlike
	 * v3, a filesystem failure surfaces as `TypeCacheError` instead of being
	 * laundered to `false`.
	 *
	 * "Files present" is trusted to mean "package complete" only because
	 * {@link TypeCacheShape.writePackage} promotes a staged tree atomically:
	 * the live directory appears only once every file is written, so a present
	 * directory is never a half-written one.
	 */
	readonly exists: (pkg: PackageSpec) => Effect.Effect<boolean, TypeCacheError>;
	/** Read one cached file's contents. */
	readonly read: (pkg: PackageSpec, filePath: string) => Effect.Effect<string, TypeCacheError>;
	/**
	 * Write one file into the package's cache directory.
	 *
	 * @remarks
	 * `filePath` is data from a CDN file tree: absolute paths and `..`
	 * segments are rejected as a typed `TypeCacheError` before any join — a
	 * hostile tree must not write outside `<cacheDir>/<name>/<version>/`.
	 *
	 * This is the low-level single-file primitive: it writes directly into the
	 * live directory and does not guard completeness.
	 * {@link TypeCacheShape.writePackage} is the atomic whole-package path the
	 * registry uses.
	 */
	readonly write: (pkg: PackageSpec, filePath: string, content: string) => Effect.Effect<void, TypeCacheError>;
	/**
	 * Write a package's entire file set atomically: stage every file in a
	 * sibling directory, then promote it onto the live directory in one
	 * `rename`.
	 *
	 * @remarks
	 * The invariant this method exists to hold: a reader either sees the
	 * package's previous complete state or its new complete state, never a
	 * half-written mixture. It works in three phases:
	 *
	 * 1. **Stage.** Files are written into a `.staging-<version>` directory that
	 *    is a *sibling* of the live `<cacheDir>/<name>/<version>/` dir (same
	 *    parent, so the final `rename` is same-filesystem and atomic). A
	 *    `.staging-*` sibling is invisible to reads, which operate on the live
	 *    directory specifically. Any leftover staging tree from a prior crash is
	 *    cleared first. Each `filePath` runs through the same path guard
	 *    {@link TypeCacheShape.write} uses (resolved against the staging root),
	 *    so a hostile tree cannot escape; a path-safety or IO failure here
	 *    aborts before promotion, leaving the live directory untouched.
	 * 2. **Promote.** The live directory is removed, then the staging directory
	 *    is renamed onto it. Because the whole directory is replaced rather than
	 *    merged, obsolete files from a previous, larger file set are dropped.
	 * 3. There is a tiny window between the remove and the rename where the live
	 *    directory is briefly absent. A concurrent reader that observes it there
	 *    classifies the package as a *miss* (via the stale-vs-miss ladder),
	 *    which self-heals on the next fetch — strictly better than observing a
	 *    partial tree and serving it as usable stale data.
	 *
	 * All failures map to a typed `TypeCacheError` with operation `"write"`.
	 */
	readonly writePackage: (
		pkg: PackageSpec,
		files: Iterable<readonly [string, string]>,
	) => Effect.Effect<void, TypeCacheError>;
	/** List the package's cached files, relative to its cache directory. */
	readonly listFiles: (pkg: PackageSpec) => Effect.Effect<ReadonlyArray<string>, TypeCacheError>;
	/**
	 * Read the package's metadata entry.
	 *
	 * @remarks
	 * `Option.none()` when absent **or expired** — the store's TTL expiry
	 * evicts on read, which is what drives the stale-vs-miss distinction.
	 */
	readonly readMetadata: (pkg: PackageSpec) => Effect.Effect<Option.Option<TypeCacheMetadata>, TypeCacheError>;
	/** Write the package's metadata entry, forwarding its `ttl` to the store. */
	readonly writeMetadata: (pkg: PackageSpec, metadata: TypeCacheMetadata) => Effect.Effect<void, TypeCacheError>;
	/** Build the package's `Vfs`: every cached file keyed `node_modules/<name>/<path>`. */
	readonly getVfs: (pkg: PackageSpec) => Effect.Effect<Vfs, TypeCacheError>;
	/**
	 * Remove the package: metadata first, then files.
	 *
	 * @remarks
	 * The ordering is load-bearing. Files can outlive their metadata (TTL
	 * expiry evicts on read, leaving files behind), so the deletion cannot ride
	 * the store's transactional `onRemoved` callback — it only fires when a
	 * metadata row actually matched. Removing metadata first means a crash
	 * between the two steps leaves harmless orphaned files (a later refetch
	 * overwrites them), never a phantom cache hit.
	 */
	readonly remove: (pkg: PackageSpec) => Effect.Effect<void, TypeCacheError>;
	/**
	 * Evict every expired metadata entry and delete the corresponding
	 * directories.
	 *
	 * @remarks
	 * Deliberately best-effort, NOT transactional: file removals are side
	 * effects outside the SQL transaction, so a mid-loop rollback would
	 * restore all metadata while leaving earlier directories already deleted.
	 * Metadata is pruned first; per-directory removal failures are ignored (an
	 * orphaned directory is harmless — a later refetch overwrites it).
	 */
	readonly prune: Effect.Effect<CachePruneResult, TypeCacheError>;
}

const make = (cacheDir: string): Effect.Effect<TypeCacheShape, never, Cache | FileSystem.FileSystem | Path.Path> =>
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const cache = yield* Cache;
		const path = yield* Path.Path;

		const pkgDir = (pkg: PackageSpec): string => path.join(cacheDir, pkg.name, pkg.version);

		// The staging directory for an atomic `writePackage`: a sibling of the
		// live pkg dir (shares the `<cacheDir>/<name>` parent) so the promoting
		// `rename` is same-filesystem and atomic, and a `.staging-*` name reads
		// never look at.
		const stagingDir = (pkg: PackageSpec): string => path.join(cacheDir, pkg.name, `.staging-${pkg.version}`);

		const fail = (operation: typeof TypeCacheError.fields.operation.Type, target: string) => (cause: unknown) =>
			new TypeCacheError({ operation, path: target, cause });

		const safeJoin = (
			operation: typeof TypeCacheError.fields.operation.Type,
			root: string,
			filePath: string,
		): Effect.Effect<string, TypeCacheError> =>
			isSafeRelativePath(filePath)
				? Effect.succeed(path.join(root, filePath))
				: Effect.fail(
						new TypeCacheError({
							operation,
							path: filePath,
							cause: new Error("path escapes the package cache directory"),
						}),
					);

		const safePath = (
			operation: typeof TypeCacheError.fields.operation.Type,
			pkg: PackageSpec,
			filePath: string,
		): Effect.Effect<string, TypeCacheError> => safeJoin(operation, pkgDir(pkg), filePath);

		const listRecursive = (
			dir: string,
			relativeTo: string,
			depth: number,
		): Effect.Effect<Array<string>, TypeCacheError> =>
			Effect.gen(function* () {
				if (depth > MAX_NESTING_DEPTH) {
					return yield* Effect.fail(fail("list", dir)(new Error("cache tree exceeds the nesting-depth limit")));
				}
				const entries = yield* fs.readDirectory(dir).pipe(Effect.mapError(fail("list", dir)));
				const files: Array<string> = [];
				for (const entry of entries) {
					const fullPath = path.join(dir, entry);
					const stat = yield* fs.stat(fullPath).pipe(Effect.mapError(fail("list", fullPath)));
					if (stat.type === "Directory") {
						files.push(...(yield* listRecursive(fullPath, relativeTo, depth + 1)));
					} else {
						files.push(path.relative(relativeTo, fullPath));
					}
				}
				return files;
			});

		const exists = Effect.fn("TypeCache.exists")(function* (pkg: PackageSpec) {
			return yield* fs.exists(pkgDir(pkg)).pipe(Effect.mapError(fail("exists", pkgDir(pkg))));
		});

		const read = Effect.fn("TypeCache.read")(function* (pkg: PackageSpec, filePath: string) {
			const fullPath = yield* safePath("read", pkg, filePath);
			return yield* fs.readFileString(fullPath).pipe(Effect.mapError(fail("read", fullPath)));
		});

		const write = Effect.fn("TypeCache.write")(function* (pkg: PackageSpec, filePath: string, content: string) {
			const fullPath = yield* safePath("write", pkg, filePath);
			const dirPath = path.dirname(fullPath);
			yield* fs.makeDirectory(dirPath, { recursive: true }).pipe(Effect.mapError(fail("write", dirPath)));
			yield* fs.writeFileString(fullPath, content).pipe(Effect.mapError(fail("write", fullPath)));
		});

		const writePackage = Effect.fn("TypeCache.writePackage")(function* (
			pkg: PackageSpec,
			files: Iterable<readonly [string, string]>,
		) {
			const staging = stagingDir(pkg);
			const live = pkgDir(pkg);
			// Clear any staging tree left behind by a prior crash, then recreate
			// it so the promoting `rename` has a directory to move even when the
			// file set is empty.
			yield* fs.remove(staging, { recursive: true, force: true }).pipe(Effect.mapError(fail("write", staging)));
			yield* fs.makeDirectory(staging, { recursive: true }).pipe(Effect.mapError(fail("write", staging)));
			// Stage every file. A path-safety or IO failure here aborts before
			// promotion, so the live directory is left untouched.
			for (const [filePath, content] of files) {
				const fullPath = yield* safeJoin("write", staging, filePath);
				const dirPath = path.dirname(fullPath);
				yield* fs.makeDirectory(dirPath, { recursive: true }).pipe(Effect.mapError(fail("write", dirPath)));
				yield* fs.writeFileString(fullPath, content).pipe(Effect.mapError(fail("write", fullPath)));
			}
			// Promote atomically: drop the old tree, then rename staging onto it.
			// The whole directory is replaced, so obsolete files from a larger
			// prior set are dropped.
			yield* fs.remove(live, { recursive: true, force: true }).pipe(Effect.mapError(fail("write", live)));
			yield* fs.rename(staging, live).pipe(Effect.mapError(fail("write", live)));
		});

		const listFiles = Effect.fn("TypeCache.listFiles")(function* (pkg: PackageSpec) {
			return yield* listRecursive(pkgDir(pkg), pkgDir(pkg), 0);
		});

		const readMetadata = Effect.fn("TypeCache.readMetadata")(function* (pkg: PackageSpec) {
			const key = pkg.cacheKey;
			const entry = yield* cache.get(key).pipe(Effect.mapError(fail("readMetadata", key)));
			if (Option.isNone(entry)) return Option.none<TypeCacheMetadata>();
			const decoded = yield* Schema.decodeUnknownEffect(MetadataFromJson)(
				new TextDecoder().decode(entry.value.value),
			).pipe(Effect.mapError(fail("readMetadata", key)));
			return Option.some(decoded);
		});

		const writeMetadata = Effect.fn("TypeCache.writeMetadata")(function* (
			pkg: PackageSpec,
			metadata: TypeCacheMetadata,
		) {
			const key = pkg.cacheKey;
			const encoded = yield* Schema.encodeEffect(MetadataFromJson)(metadata).pipe(
				Effect.mapError(fail("writeMetadata", key)),
			);
			yield* cache
				.set({
					key,
					value: new TextEncoder().encode(encoded),
					contentType: "application/json",
					tags: [pkg.name],
					...(metadata.ttl !== undefined ? { ttl: metadata.ttl } : {}),
				})
				.pipe(Effect.mapError(fail("writeMetadata", key)));
		});

		const getVfs = Effect.fn("TypeCache.getVfs")(function* (pkg: PackageSpec) {
			const dir = pkgDir(pkg);
			const files = yield* listRecursive(dir, dir, 0);
			const vfs: Vfs = new Map();
			for (const file of files) {
				const fullPath = path.join(dir, file);
				const content = yield* fs.readFileString(fullPath).pipe(Effect.mapError(fail("getVfs", fullPath)));
				vfs.set(`node_modules/${pkg.name}/${file.replace(/\\/g, "/")}`, content);
			}
			return vfs;
		});

		const remove = Effect.fn("TypeCache.remove")(function* (pkg: PackageSpec) {
			const key = pkg.cacheKey;
			const dir = pkgDir(pkg);
			// Metadata first — see the TSDoc on TypeCacheShape.remove.
			yield* cache.invalidate(key).pipe(Effect.mapError(fail("remove", key)));
			yield* fs.remove(dir, { recursive: true, force: true }).pipe(Effect.mapError(fail("remove", dir)));
		});

		const prune: Effect.Effect<CachePruneResult, TypeCacheError> = Effect.gen(function* () {
			const result = yield* cache.prune().pipe(Effect.mapError(fail("prune", cacheDir)));
			const removed: Array<{ name: string; version: string }> = [];
			for (const key of result.keys) {
				const parsed = PackageSpec.parseCacheKey(key);
				if (Option.isNone(parsed)) continue;
				const dir = pkgDir(parsed.value);
				// Best-effort per directory, but `removed` reports only the
				// directories that were actually deleted — a failed removal is
				// still swallowed (the orphan is harmless), just not claimed.
				const deleted = yield* fs.remove(dir, { recursive: true, force: true }).pipe(
					Effect.as(true),
					Effect.orElseSucceed(() => false),
				);
				if (deleted) removed.push({ name: parsed.value.name, version: parsed.value.version });
			}
			return { count: result.count, removed } satisfies CachePruneResult;
		}).pipe(Effect.withSpan("TypeCache.prune"));

		return {
			exists,
			read,
			write,
			writePackage,
			listFiles,
			readMetadata,
			writeMetadata,
			getVfs,
			remove,
			prune,
		} satisfies TypeCacheShape;
	});

/**
 * The two-plane cache for fetched type definitions: files on disk under
 * `<cacheDir>/<name>/<version>/`, metadata in `@effected/store`'s `Cache`
 * with native TTL expiry.
 *
 * @remarks
 * The layer statics are parameterized factories — bind the built layer to a
 * `const` and provide that, or two provide sites mint two caches (the layer
 * memoization discipline). The metadata plane is swappable in tests: store's
 * `Cache.layerTest` (`:memory:`) satisfies {@link TypeCache.layer} with no
 * real database file.
 *
 * @example
 * ```ts
 * import { TypeCache } from "@tsdoctor/registry";
 *
 * const TypeCacheLayer = TypeCache.layer({ cacheDir: "/var/cache/my-app/types" });
 * ```
 *
 * @public
 */
export class TypeCache extends Context.Service<TypeCache, TypeCacheShape>()("@tsdoctor/registry/TypeCache") {
	/**
	 * A cache rooted at an explicit directory.
	 *
	 * @remarks
	 * `cacheDir` must be an absolute path — a relative one is developer wiring
	 * and dies at layer construction.
	 */
	static layer(options: {
		readonly cacheDir: string;
	}): Layer.Layer<TypeCache, never, Cache | FileSystem.FileSystem | Path.Path> {
		return Layer.effect(
			TypeCache,
			Effect.gen(function* () {
				const path = yield* Path.Path;
				if (!path.isAbsolute(options.cacheDir)) {
					return yield* Effect.die(
						new Error(`TypeCache.layer: cacheDir must be an absolute path, received "${options.cacheDir}"`),
					);
				}
				return yield* make(options.cacheDir);
			}),
		);
	}

	/**
	 * A cache rooted under the application's XDG cache directory:
	 * `<AppDirs cache>/<namespace>/`.
	 *
	 * @remarks
	 * Uses `AppDirs.ensureCache`, which also discharges the store's recorded
	 * constraint that the database directory must exist before
	 * `SqliteClient.layer` is built. This package never builds the store layer
	 * itself — the consumer composes `Cache.layerSqlite` (or `layerTest`) at
	 * the edge.
	 */
	static layerXdg(options?: {
		readonly namespace?: string;
	}): Layer.Layer<TypeCache, AppDirsError, Cache | AppDirs | FileSystem.FileSystem | Path.Path> {
		const namespace = options?.namespace ?? "ts-vfs";
		return Layer.effect(
			TypeCache,
			Effect.gen(function* () {
				if (namespace.length === 0 || /[/\\]/.test(namespace) || namespace === "." || namespace === "..") {
					return yield* Effect.die(
						new Error(
							`TypeCache.layerXdg: \`namespace\` must be a single path component, received ${JSON.stringify(namespace)}`,
						),
					);
				}
				// Lazy import: `@effected/xdg` is an optional peer, and `index.ts`
				// re-exports `TypeCache`, so a static value import here would make
				// every entry-point consumer resolve it eagerly. Unreachable in
				// practice — `AppDirs` sits in this layer's `R` channel, so anyone
				// who satisfied that requirement already has the package — which is
				// why a load failure is a defect rather than a widening of the
				// public error channel.
				const xdg = yield* Effect.tryPromise({
					try: () => import("@effected/xdg"),
					catch: (cause) =>
						new Error("TypeCache.layerXdg requires the optional `@effected/xdg` peer to be installed", { cause }),
				}).pipe(Effect.orDie);
				const appDirs = yield* xdg.AppDirs;
				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				const base = yield* appDirs.ensureCache;
				const cacheDir = path.join(base, namespace);
				yield* fs
					.makeDirectory(cacheDir, { recursive: true })
					.pipe(Effect.mapError((cause) => new xdg.AppDirsError({ directory: "cache", path: cacheDir, cause })));
				return yield* make(cacheDir);
			}),
		);
	}
}
