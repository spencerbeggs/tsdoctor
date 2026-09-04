import { GlobPatternOptions } from "@effected/glob";
import { LenientManifest } from "@effected/package-json";
import { compileAndExpand } from "@effected/walker";
import type { BundleManifestError } from "@tsdoctor/manifest";
import { TSDOCTOR_MANIFEST_FILENAME } from "@tsdoctor/manifest";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import type { Bundle, BundleDescriptor, BundleLayerError } from "./Bundle.js";
import { readApiModelInfo, readBundle } from "./Bundle.js";

/**
 * Raised when a directory cannot be resolved into a bundle descriptor.
 *
 * @remarks
 * Discovery failures are USER-facing wiring problems — a missing folder, no
 * model file, an ambiguous model set — so the `reason` is a typed literal a
 * consumer can branch on for actionable messaging.
 *
 * @public
 */
export class BundleDiscoveryError extends Schema.TaggedError<BundleDiscoveryError>()("BundleDiscoveryError", {
	/** The directory (or file) the failure is about. */
	path: Schema.String,
	/** What went wrong, structurally. */
	reason: Schema.Literals([
		"notFound",
		"notADirectory",
		"noApiModel",
		"ambiguousApiModel",
		"invalidPackageJson",
		"unreadableDirectory",
		"notABundleFolder",
		"emptyParent",
	]),
	/** Human context for the failure (candidate lists, offending names). */
	detail: Schema.optionalKey(Schema.String),
	/** The underlying failure, when one exists, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const detailPart = this.detail !== undefined ? `: ${this.detail}` : "";
		return `Bundle discovery failed (${this.reason}) at ${this.path}${detailPart}`;
	}
}

/**
 * Overrides for {@link discoverBundle}. Any supplied field wins over
 * discovery.
 *
 * @public
 */
export interface BundleOverrides {
	/** The package name to use instead of the discovered one. */
	readonly name?: string;
	/** The version to use instead of the discovered one. */
	readonly version?: string;
	/** The model path to use instead of `*.api.json` discovery (resolved against the bundle dir when relative). */
	readonly modelPath?: string;
}

/**
 * Options for {@link discoverBundle}.
 *
 * @public
 */
export interface DiscoverBundleOptions {
	/** Base for resolving a relative `dir`. When omitted, a relative `dir` resolves per the injected `Path` service. */
	readonly cwd?: string;
	/** Caller-supplied fields that win over discovery. */
	readonly overrides?: BundleOverrides;
}

/**
 * Options for {@link discoverBundles}.
 *
 * @public
 */
export interface DiscoverBundlesOptions {
	/** Base for resolving a relative `parentDir`. */
	readonly cwd?: string;
}

/** The unscoped tail of an npm package name (`@scope/pkg` → `pkg`). */
function unscopedName(packageName: string): string {
	const slash = packageName.indexOf("/");
	return packageName.startsWith("@") && slash !== -1 ? packageName.slice(slash + 1) : packageName;
}

/** Assert `dir` exists and is a directory, or fail with a discovery error. */
function assertDirectory(dir: string): Effect.Effect<void, BundleDiscoveryError, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const info = yield* fs
			.stat(dir)
			.pipe(Effect.mapError((cause) => new BundleDiscoveryError({ path: dir, reason: "notFound", cause })));
		if (info.type !== "Directory") {
			return yield* Effect.fail(new BundleDiscoveryError({ path: dir, reason: "notADirectory" }));
		}
	});
}

/** List the `*.api.json` files directly inside `dir`, sorted. */
function listModelFiles(
	dir: string,
): Effect.Effect<ReadonlyArray<string>, BundleDiscoveryError, FileSystem.FileSystem | Path.Path> {
	return compileAndExpand("*.api.json", { cwd: dir, glob: GlobPatternOptions.make({}) }).pipe(
		Effect.mapError((cause) => new BundleDiscoveryError({ path: dir, reason: "unreadableDirectory", cause })),
	);
}

/**
 * Read the discovery-lenient name/version pair from a package.json, when
 * present.
 *
 * @remarks
 * Uses `@effected/package-json`'s `LenientManifest` — the shape-on-presence
 * degradable tier below `PackageManifest`. Malformed JSON text (or a
 * non-object document) fails typed as `invalidPackageJson`, matching the
 * previous two-field sniffer; a malformed individual field now degrades to
 * absence instead of failing, which is the ladder's enrich-never-gate rule
 * applied at field granularity (the model's own name covers a nameless
 * discovery).
 */
function readDiscoveryPackageJson(
	packageJsonPath: string,
): Effect.Effect<
	Option.Option<{ readonly name?: string; readonly version?: string }>,
	BundleDiscoveryError,
	FileSystem.FileSystem
> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const exists = yield* fs.exists(packageJsonPath).pipe(Effect.orElseSucceed(() => false));
		if (!exists) {
			return Option.none();
		}
		const parsed = yield* Effect.gen(function* () {
			const text = yield* fs.readFileString(packageJsonPath);
			return yield* LenientManifest.parse(text);
		}).pipe(
			Effect.mapError(
				(cause) => new BundleDiscoveryError({ path: packageJsonPath, reason: "invalidPackageJson", cause }),
			),
		);
		return Option.some({
			...(parsed.name !== undefined ? { name: parsed.name } : {}),
			...(parsed.version !== undefined ? { version: parsed.version } : {}),
		});
	});
}

/**
 * Pick the bundle's model file from the `*.api.json` candidates in its
 * folder.
 *
 * @remarks
 * One candidate wins outright. Zero is a discovery failure — layer 0 is the
 * one required layer. Among several, the file named `<unscoped>.api.json`
 * for the bundle's package name wins; with no such match the set is
 * ambiguous and discovery fails with guidance to pass an explicit
 * `overrides.modelPath`.
 */
function pickModelFile(
	dir: string,
	candidates: ReadonlyArray<string>,
	packageName: string | undefined,
): Effect.Effect<string, BundleDiscoveryError, Path.Path> {
	return Effect.gen(function* () {
		const path = yield* Path.Path;
		if (candidates.length === 1) {
			return path.join(dir, candidates[0] as string);
		}
		if (candidates.length === 0) {
			return yield* Effect.fail(
				new BundleDiscoveryError({
					path: dir,
					reason: "noApiModel",
					detail: "no *.api.json model found; pass an explicit overrides.modelPath",
				}),
			);
		}
		const preferred = packageName !== undefined ? `${unscopedName(packageName)}.api.json` : undefined;
		const match = preferred !== undefined ? candidates.find((candidate) => candidate === preferred) : undefined;
		if (match !== undefined) {
			return path.join(dir, match);
		}
		return yield* Effect.fail(
			new BundleDiscoveryError({
				path: dir,
				reason: "ambiguousApiModel",
				detail: `multiple *.api.json files (${candidates.join(", ")}) and none match "${preferred ?? "<name>.api.json"}"; pass an explicit overrides.modelPath`,
			}),
		);
	});
}

/**
 * Discover a single bundle folder into a {@link BundleDescriptor}.
 *
 * @remarks
 * Generalizes the RSPress plugin's `api.fromDir` helper, framework-neutral:
 * no route derivation — that stays in the adapter. Layer 0 (`*.api.json`) is
 * required; package.json, tsconfig.json and tsdoctor.json are recorded when
 * present. The package name comes from package.json when it has one, falling
 * back to the api.json model's own name; the version comes from package.json
 * alone. Caller overrides win over discovery. `FileSystem` and `Path` stay
 * in the `R` channel — provide the platform layer at the application
 * boundary.
 *
 * @public
 */
export function discoverBundle(
	dir: string,
	options?: DiscoverBundleOptions,
): Effect.Effect<BundleDescriptor, BundleDiscoveryError | BundleLayerError, FileSystem.FileSystem | Path.Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const abs = options?.cwd !== undefined ? path.resolve(options.cwd, dir) : path.resolve(dir);
		yield* assertDirectory(abs);

		const packageJsonPath = path.join(abs, "package.json");
		const packageJson = yield* readDiscoveryPackageJson(packageJsonPath);
		const packageJsonName = Option.isSome(packageJson) ? packageJson.value.name : undefined;

		const overriddenModel = options?.overrides?.modelPath;
		const modelPath =
			overriddenModel !== undefined
				? path.resolve(abs, overriddenModel)
				: yield* Effect.flatMap(listModelFiles(abs), (candidates) =>
						pickModelFile(abs, candidates, options?.overrides?.name ?? packageJsonName),
					);

		// The model header supplies the name only when package.json cannot.
		const name = options?.overrides?.name ?? packageJsonName ?? (yield* readApiModelInfo(modelPath)).name;
		const version = options?.overrides?.version ?? (Option.isSome(packageJson) ? packageJson.value.version : undefined);

		const tsconfigPath = path.join(abs, "tsconfig.json");
		const manifestPath = path.join(abs, TSDOCTOR_MANIFEST_FILENAME);
		const hasTsconfig = yield* fs.exists(tsconfigPath).pipe(Effect.orElseSucceed(() => false));
		const hasManifest = yield* fs.exists(manifestPath).pipe(Effect.orElseSucceed(() => false));

		return {
			dir: abs,
			dirname: path.basename(abs),
			name,
			...(version !== undefined ? { version } : {}),
			modelPath,
			...(Option.isSome(packageJson) ? { packageJsonPath } : {}),
			...(hasTsconfig ? { tsconfigPath } : {}),
			...(hasManifest ? { manifestPath } : {}),
		};
	});
}

/**
 * Strictly scan a parent directory and discover one bundle per subfolder.
 *
 * @remarks
 * Generalizes the RSPress plugin's `apis.fromDir`: every non-dotfile
 * subdirectory MUST be a valid bundle folder (contain at least one
 * `*.api.json`) — a stray subfolder fails discovery with guidance to use
 * {@link discoverBundle} for selective inclusion — and an empty scan is a
 * failure, not an empty array (the models have probably not been built).
 * Subfolders are processed in sorted order.
 *
 * @public
 */
export function discoverBundles(
	parentDir: string,
	options?: DiscoverBundlesOptions,
): Effect.Effect<
	ReadonlyArray<BundleDescriptor>,
	BundleDiscoveryError | BundleLayerError,
	FileSystem.FileSystem | Path.Path
> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const absParent = options?.cwd !== undefined ? path.resolve(options.cwd, parentDir) : path.resolve(parentDir);
		yield* assertDirectory(absParent);

		const entries = yield* fs
			.readDirectory(absParent)
			.pipe(
				Effect.mapError((cause) => new BundleDiscoveryError({ path: absParent, reason: "unreadableDirectory", cause })),
			);

		const subdirs: Array<string> = [];
		for (const entry of [...entries].sort()) {
			if (entry.startsWith(".")) {
				continue;
			}
			const entryPath = path.join(absParent, entry);
			const info = yield* fs.stat(entryPath).pipe(Effect.option);
			if (Option.isSome(info) && info.value.type === "Directory") {
				subdirs.push(entry);
			}
		}

		const descriptors: Array<BundleDescriptor> = [];
		for (const subdir of subdirs) {
			const subdirPath = path.join(absParent, subdir);
			const models = yield* listModelFiles(subdirPath);
			if (models.length === 0) {
				return yield* Effect.fail(
					new BundleDiscoveryError({
						path: absParent,
						reason: "notABundleFolder",
						detail: `"${subdir}" has no *.api.json model; use discoverBundle for selective inclusion`,
					}),
				);
			}
			descriptors.push(yield* discoverBundle(subdirPath));
		}

		if (descriptors.length === 0) {
			return yield* Effect.fail(
				new BundleDiscoveryError({
					path: absParent,
					reason: "emptyParent",
					detail: "no bundle folders found; have the package models been built?",
				}),
			);
		}

		return descriptors;
	});
}

/**
 * Discover and read a single bundle in one call.
 *
 * @public
 */
export function loadBundle(
	dir: string,
	options?: DiscoverBundleOptions,
): Effect.Effect<
	Bundle,
	BundleDiscoveryError | BundleLayerError | BundleManifestError,
	FileSystem.FileSystem | Path.Path
> {
	return Effect.flatMap(discoverBundle(dir, options), readBundle);
}

/**
 * Discover and read every bundle under a parent directory in one call.
 *
 * @public
 */
export function loadBundles(
	parentDir: string,
	options?: DiscoverBundlesOptions,
): Effect.Effect<
	ReadonlyArray<Bundle>,
	BundleDiscoveryError | BundleLayerError | BundleManifestError,
	FileSystem.FileSystem | Path.Path
> {
	return Effect.flatMap(discoverBundles(parentDir, options), (descriptors) => Effect.forEach(descriptors, readBundle));
}
