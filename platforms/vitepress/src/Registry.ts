/**
 * External type loading: the `@tsdoctor/registry` stack over the same XDG
 * cache the RSPress plugin uses, and the degrading merge of a documented
 * package's dependencies into the build's virtual file system.
 *
 * @remarks
 * External types are an enhancement — without them code blocks type-check
 * without their dependencies' declarations, which is a worse page rather
 * than a broken build — so every failure here degrades to "no external
 * types" and is reported as a warning the caller may print.
 *
 * @packageDocumentation
 */

import { NodeFileSystem, NodeHttpClient } from "@effect/platform-node";
import { Cache } from "@effected/store";
import { AppDirs, Xdg } from "@effected/xdg";
import { PackageFetcher, PackageSpec, RegistryObserver, TypeCache, TypeRegistry } from "@tsdoctor/registry";
import type { Vfs } from "@tsdoctor/vfs";
import { Effect, Layer, Path } from "effect";

/**
 * The XDG namespace every tsdoctor cache lives under — shared with the
 * RSPress plugin so both adapters read one type cache and one Twoslash
 * result cache.
 *
 * @public
 */
export const TSDOCTOR_NAMESPACE = "tsdoctor";

/** Node platform services: the filesystem and path implementations. */
export const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, Path.layer);

/** XDG application directories rooted at {@link TSDOCTOR_NAMESPACE}. */
export const AppDirsLive = AppDirs.layer({ namespace: TSDOCTOR_NAMESPACE }).pipe(
	Layer.provide(Layer.mergeAll(Xdg.layer, PlatformLive)),
);

/** Metadata plane: a sqlite-backed `@effected/store` Cache rooted in the XDG cache dir. */
const MetadataCacheLive = Layer.unwrap(
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const path = yield* Path.Path;
		const cacheDir = yield* appDirs.ensureCache;
		return Cache.layerSqlite({ filename: path.join(cacheDir, "metadata.sqlite") });
	}),
).pipe(Layer.provide(Layer.mergeAll(AppDirsLive, PlatformLive)), Cache.degrading);

/** The registry emits no logs of its own; this adapter listens to nothing yet. */
const RegistryObserverLive = Layer.succeed(RegistryObserver, { emit: () => Effect.void });

/**
 * The full registry runtime: `TypeRegistry` over an XDG-rooted `TypeCache`
 * and the jsDelivr `PackageFetcher`. Bound to a const so the stack builds
 * once per runtime.
 *
 * @public
 */
export const RegistryLive: Layer.Layer<TypeRegistry> = TypeRegistry.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(TypeCache.layerXdg(), PackageFetcher.layer)),
	Layer.provideMerge(RegistryObserverLive),
	Layer.provide(Layer.mergeAll(MetadataCacheLive, AppDirsLive, PlatformLive, NodeHttpClient.layerUndici)),
	Layer.orDie,
);

/**
 * An external package to load declarations for.
 *
 * @public
 */
export interface ExternalPackage {
	/** The npm package name. */
	readonly name: string;
	/** The version spec as declared: exact, range or dist-tag. */
	readonly version: string;
}

/**
 * The outcome of {@link loadExternalTypes}: what merged, what was skipped
 * and why. Never a failure.
 *
 * @public
 */
export interface ExternalTypesReport {
	/** Packages whose declarations were merged. */
	readonly loaded: ReadonlyArray<string>;
	/** Packages dropped because no published version matched, or loading failed. */
	readonly skipped: ReadonlyArray<string>;
	/** A human-readable reason when the whole batch degraded. */
	readonly warning?: string;
}

/**
 * The dependency-field names `package.json` declares packages under.
 */
const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies"] as const;

/**
 * The external packages a documented package's manifest declares, in the
 * `dependencies` and `peerDependencies` fields.
 *
 * @public
 */
export function externalPackagesOf(packageJson: Record<string, unknown> | undefined): ReadonlyArray<ExternalPackage> {
	if (packageJson === undefined) return [];
	const packages: ExternalPackage[] = [];
	for (const field of DEPENDENCY_FIELDS) {
		const entries = packageJson[field];
		if (entries === null || typeof entries !== "object") continue;
		for (const [name, version] of Object.entries(entries as Record<string, unknown>)) {
			if (typeof version === "string" && !version.startsWith("workspace:") && !version.startsWith("catalog:")) {
				packages.push({ name, version });
			}
		}
	}
	return packages;
}

/**
 * Resolve each package to an exact published version and merge its
 * declarations into `vfs`, in place. First-party packages (the ones being
 * documented) are excluded: their api.json-derived declarations are
 * authoritative and a published copy would clobber them.
 *
 * @remarks
 * Degrades, never fails: an unresolvable package is skipped, and an
 * infrastructure failure (no HOME for XDG, an unreachable CDN) leaves the
 * VFS as it was with a `warning` in the report.
 *
 * @public
 */
export const loadExternalTypes = Effect.fn("Registry.loadExternalTypes")(function* (
	vfs: Vfs,
	packages: ReadonlyArray<ExternalPackage>,
	documented: ReadonlySet<string>,
) {
	const candidates = packages.filter((pkg) => !documented.has(pkg.name));
	if (candidates.length === 0) return { loaded: [], skipped: [] } satisfies ExternalTypesReport;

	const registry = yield* TypeRegistry;
	const resolved = yield* Effect.forEach(
		candidates,
		(pkg) =>
			registry.resolveVersion(pkg.name, pkg.version).pipe(
				Effect.map((version): PackageSpec | null => new PackageSpec({ name: pkg.name, version })),
				Effect.catch(() => Effect.succeed<PackageSpec | null>(null)),
			),
		{ concurrency: 5 },
	);
	const specs = resolved.filter((spec): spec is PackageSpec => spec !== null);
	const skipped = candidates.filter((_, index) => resolved[index] === null).map((pkg) => pkg.name);
	if (specs.length === 0) return { loaded: [], skipped } satisfies ExternalTypesReport;

	const result = yield* Effect.result(registry.getVfs(specs, { autoFetch: true }));
	if (result._tag === "Failure") {
		return {
			loaded: [],
			skipped: [...skipped, ...specs.map((spec) => spec.name)],
			warning: result.failure.message,
		} satisfies ExternalTypesReport;
	}
	for (const [file, content] of result.success.entries()) vfs.set(file, content);
	return { loaded: specs.map((spec) => spec.name), skipped } satisfies ExternalTypesReport;
});
