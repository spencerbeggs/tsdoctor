import { NodeHttpClient } from "@effect/platform-node";
import { Cache } from "@effected/store";
import { AppDirs } from "@effected/xdg";
import { PackageFetcher, PackageSpec, RegistryObserver, TypeCache, TypeRegistry } from "@tsdoctor/registry";
import { Duration, Effect, Layer, Path } from "effect";
import { resolveExternalPackageVersions } from "../config-utils.js";
import { TypeRegistryError as PluginTypeRegistryError } from "../errors.js";
import { emit } from "../observability/EventBus.js";
import { PluginEvent } from "../observability/events.js";
import { TypeRegistryService } from "../services/TypeRegistryService.js";
import { AppDirsLive, PlatformLive } from "./xdg.js";

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
).pipe(Layer.provide(Layer.mergeAll(AppDirsLive, PlatformLive)));

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
 * TypeRegistryServiceLive: uses @tsdoctor/registry Effect programs directly.
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
 * with a message, which `ConfigServiceLive` turns into a build-continues
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

/**
 * TypeRegistryServiceLive: the `@tsdoctor/registry` stack, acquired once.
 *
 * @remarks
 * `Layer.catchCause` keeps a broken environment — no HOME for XDG, an
 * unwritable cache directory — from aborting the build at `ManagedRuntime`
 * construction. External type loading is an enhancement: without it code
 * blocks render without Twoslash enrichment, which is a degradation, not a
 * failure. That was true while the stack was provided per method and the
 * in-method handlers absorbed it; hoisting acquisition made it something the
 * layer has to say for itself.
 */
export const TypeRegistryServiceLive: Layer.Layer<TypeRegistryService> = RegistryBackedLive.pipe(
	Layer.catchCause(() => DegradedLive),
);
