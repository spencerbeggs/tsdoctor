import { NodeHttpClient } from "@effect/platform-node";
import { Cache } from "@effected/store";
import { AppDirs } from "@effected/xdg";
import { PackageFetcher, PackageSpec, RegistryObserver, TypeCache, TypeRegistry } from "@tsdoctor/registry";
import type { Vfs } from "@tsdoctor/vfs";
import { Cause, Context, Duration, Effect, Layer, Path } from "effect";
import { resolveExternalPackageVersions } from "../config-utils.js";
import type { TypeRegistryError } from "../errors.js";
import { TypeRegistryError as PluginTypeRegistryError } from "../errors.js";
import { AppDirsLive, PlatformLive } from "../layers/xdg.js";
import { emit } from "../observability/EventBus.js";
import { PluginEvent } from "../observability/events.js";

export interface ExternalPackageSpec {
	readonly name: string;
	readonly version: string;
}

export interface TypeRegistryResult {
	readonly vfs: Vfs;
}

export interface TypeRegistryServiceShape {
	/**
	 * Resolve each package's version spec (range / npm tag) to an exact
	 * published version, dropping any package that cannot be resolved
	 * (unpublished or workspace-only). The CDN backing {@link loadPackages}
	 * requires exact versions, so callers should resolve before loading.
	 */
	readonly resolveVersions: (
		packages: ReadonlyArray<ExternalPackageSpec>,
	) => Effect.Effect<ReadonlyArray<ExternalPackageSpec>>;

	readonly loadPackages: (
		packages: ReadonlyArray<ExternalPackageSpec>,
	) => Effect.Effect<TypeRegistryResult, TypeRegistryError>;
}

export class TypeRegistryService extends Context.Service<TypeRegistryService, TypeRegistryServiceShape>()(
	"rspress-plugin-api-extractor/TypeRegistryService",
) {
	/**
	 * The `@tsdoctor/registry` stack, acquired once.
	 *
	 * @remarks
	 * `Layer.catchCause` keeps a broken environment — no HOME for XDG, an
	 * unwritable cache directory — from aborting the build at `ManagedRuntime`
	 * construction. External type loading is an enhancement: without it code
	 * blocks render without Twoslash enrichment, which is a degradation, not a
	 * failure. That was true while the stack was provided per method and the
	 * in-method handlers absorbed it; hoisting acquisition made it something the
	 * layer has to say for itself.
	 *
	 * `Layer.suspend` because the composition below is declared after this class: a
	 * static initializer runs while the module body is still evaluating, so naming
	 * those consts directly throws at import time with a clean typecheck.
	 */
	static readonly layer: Layer.Layer<TypeRegistryService> = Layer.suspend(() =>
		RegistryBackedLive.pipe(
			Layer.catchCause((cause) =>
				// Interruption is not a broken environment: it is the caller
				// shutting down. Handing back a working degraded registry to a
				// fiber that was meant to stop would swallow the interrupt, so it
				// is re-raised. Everything else — a failure, or a defect thrown by
				// a driver during construction — degrades.
				//
				// The interrupt is rebuilt from the ORIGINAL cause's interruptors
				// rather than raised fresh with `Effect.interrupt`, which would
				// report this fiber as the interruptor and discard the one that
				// actually cancelled the build. `Cause.interrupt` stays
				// `Cause<never>`, so the layer's `never` error channel survives.
				Cause.hasInterrupts(cause)
					? Layer.effectContext(Effect.failCause(Cause.interrupt([...Cause.interruptors(cause)][0])))
					: DegradedLive,
			),
		),
	);

	/**
	 * An in-memory double: no network, no XDG cache, no sqlite.
	 *
	 * @remarks
	 * Defaults resolve every spec unchanged and load an empty VFS — the shape a
	 * build takes when nothing external is configured. Override a member to
	 * exercise a specific path; an override for one member leaves the other at
	 * its default rather than forcing the test to restate it, which is the whole
	 * difference from the hand-written `Layer.succeed` doubles this replaces.
	 */
	static readonly makeTest = (overrides: Partial<TypeRegistryServiceShape> = {}): TypeRegistryServiceShape => ({
		resolveVersions: overrides.resolveVersions ?? ((packages) => Effect.succeed([...packages])),
		loadPackages: overrides.loadPackages ?? (() => Effect.succeed({ vfs: new Map() })),
	});

	/** {@link TypeRegistryService.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<TypeRegistryServiceShape> = {}): Layer.Layer<TypeRegistryService> =>
		Layer.succeed(TypeRegistryService, TypeRegistryService.makeTest(overrides));
}

/**
 * Forward @tsdoctor/registry's typed `RegistryEvent`s to the plugin's Effect
 * logger. Since v1 the library emits no logs of its own — observers are the only
 * diagnostic surface — so this restores the build output and routes it through
 * the plugin's configured log level/format (a single source, no duplication).
 *
 * The summary (`BatchComplete`) and failures are surfaced at info/warning;
 * per-package detail stays at debug so a normal build is quiet.
 */
const RegistryObserverLayer = Layer.succeed(RegistryObserver, {
	emit: (event) => {
		switch (event._tag) {
			case "VersionResolved":
				return emit(
					PluginEvent.TypeRegistryEvent({
						ctx: { packageName: event.package },
						level: "debug",
						kind: "VersionResolved",
						detail: `${event.requested} -> ${event.resolved}`,
					}),
				);
			case "VersionResolveFailed":
				return emit(
					PluginEvent.TypeRegistryEvent({
						ctx: { packageName: event.package },
						level: "debug",
						kind: "VersionResolveFailed",
						detail: `${event.requested}: ${event.kind}`,
					}),
				);
			case "CacheHit":
			case "CacheMiss":
			case "FetchStart":
				return emit(
					PluginEvent.TypeRegistryEvent({
						ctx: { packageName: event.package, version: event.version },
						level: "debug",
						kind: event._tag,
						detail: "",
					}),
				);
			case "CacheStale":
				return emit(
					PluginEvent.TypeRegistryEvent({
						ctx: { packageName: event.package, version: event.version },
						level: "debug",
						kind: "CacheStale",
						detail: "",
					}),
				);
			// A single HTTP request returned non-2xx. This is low-level and usually
			// handled gracefully upstream (e.g. an unpublished/workspace package that
			// is then dropped), so it stays at debug. A package that actually fails to
			// load surfaces as PackageLoadFailed at warning.
			case "FetchFailed":
				return emit(
					PluginEvent.TypeRegistryEvent({
						ctx: {},
						level: "debug",
						kind: "FetchFailed",
						detail: `HTTP ${event.status}: ${event.url}${event.bodySnippet ? ` — ${event.bodySnippet}` : ""}`,
					}),
				);
			case "PackageLoaded":
				return emit(
					PluginEvent.TypeRegistryEvent({
						ctx: { packageName: event.package, version: event.version },
						level: "debug",
						kind: "PackageLoaded",
						detail: `${event.files} files, ${event.source}`,
					}),
				);
			case "PackageLoadFailed":
				return emit(
					PluginEvent.TypeRegistryEvent({
						ctx: { packageName: event.package, version: event.version },
						level: "warn",
						kind: "PackageLoadFailed",
						detail: `[${event.kind}] ${event.error instanceof Error ? event.error.message : String(event.error)}`,
					}),
				);
			case "BatchStart":
				return emit(
					PluginEvent.TypeRegistryEvent({
						ctx: {},
						level: "debug",
						kind: "BatchStart",
						detail: `${event.total} package(s)`,
					}),
				);
			case "BatchComplete":
				return emit(
					PluginEvent.TypeRegistryEvent({
						ctx: {},
						level: "info",
						kind: "BatchComplete",
						detail: `${event.loaded}/${event.total} packages, ${event.totalFiles} files, ${Math.round(
							Duration.toMillis(event.duration),
						)}ms`,
					}),
				);
		}
	},
});

/** Metadata plane: a sqlite-backed `@effected/store` Cache rooted in the XDG cache dir. */
const MetadataCacheLive = Layer.unwrap(
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const path = yield* Path.Path;
		const cacheDir = yield* appDirs.ensureCache;
		return Cache.layerSqlite({ filename: path.join(cacheDir, "metadata.sqlite") });
	}),
).pipe(Layer.provide(Layer.mergeAll(AppDirsLive, PlatformLive)), Cache.degrading);

/**
 * The full registry runtime: TypeRegistry over an XDG-rooted TypeCache and the
 * jsDelivr PackageFetcher, with the observer that forwards registry events to
 * the plugin's EventBus (found ambiently via serviceOption at emit time).
 */
const RegistryLayer = TypeRegistry.layer.pipe(
	Layer.provideMerge(Layer.mergeAll(TypeCache.layerXdg(), PackageFetcher.layer)),
	Layer.provideMerge(RegistryObserverLayer),
	Layer.provide(Layer.mergeAll(MetadataCacheLive, AppDirsLive, PlatformLive, NodeHttpClient.layerUndici)),
);

/**
 * TypeRegistryService.layer: uses @tsdoctor/registry Effect programs directly.
 */
const RegistryBackedLive = Layer.effect(
	TypeRegistryService,
	Effect.gen(function* () {
		// The whole registry stack — XDG dirs, `metadata.sqlite`, the undici HTTP
		// client, the type cache — is acquired ONCE here and released when the
		// ManagedRuntime is disposed. It used to be provided inside each method,
		// where `Effect.provide` builds into a forked MemoMap whose parent never
		// built this layer: the stack was constructed and torn down on every
		// call, twice per build for resolveVersions + loadPackages.
		const registry = yield* TypeRegistry;
		return {
			resolveVersions: (packages) =>
				resolveExternalPackageVersions(packages, (pkg) => registry.resolveVersion(pkg.name, pkg.version)).pipe(
					// Registry infrastructure failure (e.g. no HOME for XDG, cache DB
					// unwritable): pass the specs through unresolved so the failure
					// surfaces on loadPackages with a meaningful error instead of
					// being silently swallowed here.
					Effect.catch(() => Effect.succeed([...packages])),
				),

			// The empty-input guard is now a plain short-circuit rather than a
			// necessity: with the layer acquired at construction there is no stack
			// to avoid building, but skipping the round trip is still free.
			loadPackages: (packages) =>
				packages.length === 0
					? Effect.succeed({ vfs: new Map<string, string>() })
					: Effect.gen(function* () {
							const specs = packages.map((pkg) => new PackageSpec({ name: pkg.name, version: pkg.version }));
							return { vfs: yield* registry.getVfs(specs, { autoFetch: true }) };
						}).pipe(
							Effect.catch((error) =>
								Effect.fail(
									new PluginTypeRegistryError({
										packageName: packages.map((p) => p.name).join(", "),
										version: packages.map((p) => p.version).join(", "),
										reason: error instanceof Error ? (error.message ?? String(error)) : String(error),
									}),
								),
							),
						),
		};
	}),
).pipe(Layer.provide(RegistryLayer));

/**
 * The service when the registry stack cannot be built at all.
 *
 * @remarks
 * Preserves exactly the split the working service documents: `resolveVersions`
 * passes its specs through unresolved rather than swallowing the problem, so
 * the failure surfaces from `loadPackages` as a {@link PluginTypeRegistryError}
 * with a message, which `ConfigService.layer` turns into a build-continues
 * warning. Before acquisition moved to layer construction this fell out of the
 * per-method handlers; it has to be stated explicitly now.
 */
const DegradedLive = Layer.succeed(TypeRegistryService, {
	resolveVersions: (packages) => Effect.succeed([...packages]),
	loadPackages: (packages) =>
		Effect.fail(
			new PluginTypeRegistryError({
				packageName: packages.map((p) => p.name).join(", "),
				version: packages.map((p) => p.version).join(", "),
				reason: "type registry unavailable: its cache directory or metadata database could not be opened",
			}),
		),
});
