import { Cache } from "@effected/store";
import { AppDirs } from "@effected/xdg";
import { Context, Effect, Layer, Option, Path } from "effect";
import { AppDirsLive, PlatformLive } from "../layers/xdg.js";
import type { TwoslashCacheStats, TwoslashCacheValue, TwoslashResultCache } from "../twoslash-cache.js";
import { decodeTwoslashCache, encodeTwoslashCache, makeTwoslashCache, twoslashBlobKey } from "../twoslash-cache.js";

export interface TwoslashCacheServiceShape {
	/**
	 * Load the stored generation for `envHash`, or an empty map when there is
	 * none.
	 *
	 * Never fails: an unreachable or corrupt cache is a cache miss, and must not
	 * be able to break a build that would otherwise succeed.
	 */
	readonly load: (envHash: string) => Effect.Effect<Map<string, TwoslashCacheValue>>;

	/** Persist a generation. Never fails, for the same reason as {@link load}. */
	readonly save: (envHash: string, entries: ReadonlyMap<string, TwoslashCacheValue>) => Effect.Effect<void>;

	/**
	 * Open the generation for `envHash` and hold it for the rest of the build.
	 *
	 * @remarks
	 * The returned cache is what the Twoslash transformers read and write during
	 * the render pass. The service holds it because the render pass runs AFTER
	 * `config()` returns, so somebody has to carry it across that boundary, and
	 * the service that persists a generation is the honest owner. It was
	 * previously two fields on `ResolvedBuildContext` plus a mutable
	 * `twoslashCacheHandle` in `plugin.ts` — the build's config-resolution result
	 * carrying a live mutable cache so that a later lifecycle hook could find it.
	 */
	readonly open: (envHash: string) => Effect.Effect<TwoslashResultCache>;

	/**
	 * Persist what this build produced, if anything.
	 *
	 * @returns `Option.none` when no generation was opened (an inert build, or a
	 * failure before resolution); otherwise the stats, for the caller to report.
	 *
	 * @remarks
	 * Writes only when the cache is dirty. An all-hit build has nothing to add,
	 * and rewriting an identical blob would churn the cache for nothing.
	 */
	readonly persist: () => Effect.Effect<Option.Option<TwoslashCacheStats & { readonly envHash: string }>>;
}

/**
 * Persistence for the Twoslash result cache.
 *
 * Split from the synchronous cache object (`twoslash-cache.ts`) because
 * `TwoslashTypesCache.read`/`write` are called from inside Shiki's `preprocess`
 * hook and cannot await: the service loads once before the render phase and
 * saves once after it, while every lookup in between is a synchronous map hit.
 */
export class TwoslashCacheService extends Context.Service<TwoslashCacheService, TwoslashCacheServiceShape>()(
	"rspress-plugin-api-extractor/TwoslashCacheService",
) {
	/**
	 * Live Twoslash cache persistence.
	 *
	 * @remarks
	 * Failure is absorbed at TWO levels, and both are load-bearing. Inside the
	 * service, a failed read or write degrades that one operation. Around the
	 * layer, a failed CONSTRUCTION — no HOME for XDG, an unwritable cache
	 * directory, a corrupt database — degrades to {@link DegradedLive}.
	 *
	 * The second is why `Layer.catchCause` wraps this at all. While the sqlite
	 * layer was provided inside each method, a construction failure surfaced as
	 * that method's failure and the in-method handler swallowed it. Hoisting
	 * acquisition to layer construction moved the failure to `ManagedRuntime`
	 * build time, where it would abort the entire build — breaking the contract
	 * this service documents, that an unreachable cache must never fail a build
	 * that would otherwise succeed. `catchCause` rather than a failure-only catch
	 * because a defect thrown by the sqlite driver must degrade too.
	 *
	 * `Layer.suspend` because the composition below is declared after this class:
	 * a static initializer runs while the module body is still evaluating, so
	 * naming those consts directly throws at import time with a clean typecheck.
	 */
	static readonly layer: Layer.Layer<TwoslashCacheService> = Layer.suspend(() =>
		CacheBackedLive.pipe(Layer.catchCause(() => DegradedLive)),
	);

	/**
	 * An always-cold in-memory double.
	 *
	 * @remarks
	 * Tests that resolve config must not touch the user's real XDG cache, and
	 * must not have their results depend on whether a previous run warmed it.
	 *
	 * `open` returns a REAL in-memory generation rather than a stub, and that is
	 * not an accident: `registerEnvironment` hands this object to the Twoslash
	 * transformers, so a cache that could not be read or written would change
	 * the render path's SHAPE rather than merely dropping its persistence.
	 */
	static readonly makeTest = (overrides: Partial<TwoslashCacheServiceShape> = {}): TwoslashCacheServiceShape => ({
		load: overrides.load ?? (() => Effect.succeed(new Map())),
		save: overrides.save ?? (() => Effect.void),
		open: overrides.open ?? (() => Effect.succeed(makeTwoslashCache())),
		persist: overrides.persist ?? (() => Effect.succeed(Option.none())),
	});

	/** {@link TwoslashCacheService.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<TwoslashCacheServiceShape> = {}): Layer.Layer<TwoslashCacheService> =>
		Layer.succeed(TwoslashCacheService, TwoslashCacheService.makeTest(overrides));
}

/**
 * A sqlite-backed `@effected/store` Cache in the XDG cache dir, separate from
 * the registry's `metadata.sqlite`.
 *
 * XDG rather than the repo: these are regenerable results derived from content
 * hashes, so they belong with the user's other caches — shared across worktrees
 * and checkouts of the same project, and untouched by cleaning `dist/`. Nothing
 * here needs to be committed for a build to be correct.
 */
const CacheLive = Layer.unwrap(
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const path = yield* Path.Path;
		const cacheDir = yield* appDirs.ensureCache;
		return Cache.layerSqlite({ filename: path.join(cacheDir, "twoslash.sqlite") });
	}),
).pipe(Layer.provide(Layer.mergeAll(AppDirsLive, PlatformLive)));

/**
 * Live Twoslash cache persistence.
 *
 * Both operations swallow every failure by design — see the service docs. A
 * missing HOME, an unwritable cache dir or a corrupt database degrades the
 * build to "type-check everything", which is exactly the behaviour before this
 * cache existed.
 */
/**
 * Add the build-generation half of the service on top of a load/save pair.
 *
 * @remarks
 * Shared by the real and degraded layers so the two cannot drift: a degraded
 * build must still hand out a working in-memory cache, otherwise the
 * transformers have nothing to read or write and the render pass changes
 * shape rather than merely losing persistence.
 */
function withGeneration(base: Pick<TwoslashCacheServiceShape, "load" | "save">): TwoslashCacheServiceShape {
	let open: { readonly cache: TwoslashResultCache; readonly envHash: string } | null = null;
	return {
		...base,
		open: (envHash) =>
			base.load(envHash).pipe(
				Effect.map((restored) => {
					const cache = makeTwoslashCache(restored);
					open = { cache, envHash };
					return cache;
				}),
			),
		persist: () =>
			Effect.suspend(() => {
				if (open === null) return Effect.succeed(Option.none());
				const { cache, envHash } = open;
				const stats = cache.stats();
				const report = Option.some({ ...stats, envHash });
				return stats.dirty ? base.save(envHash, cache.entries()).pipe(Effect.as(report)) : Effect.succeed(report);
			}),
	};
}

const CacheBackedLive = Layer.effect(
	TwoslashCacheService,
	Effect.gen(function* () {
		// The sqlite Cache is acquired ONCE here, at layer construction, and
		// released when the ManagedRuntime is disposed. It used to be provided
		// inside each method: `Effect.provide` builds into a forked MemoMap whose
		// parent never built this layer, so every call opened and closed its own
		// database — twice per build for load + save.
		const cache = yield* Cache;
		return withGeneration({
			load: (envHash) =>
				cache.get(twoslashBlobKey(envHash)).pipe(
					Effect.map((entry) =>
						Option.isSome(entry) ? decodeTwoslashCache(entry.value.value) : new Map<string, TwoslashCacheValue>(),
					),
					// `catch`, not `catchCause`: a cache miss must absorb FAILURES,
					// not interruption. Swallowing an interrupt here would keep a
					// cancelled build working past its own cancellation.
					Effect.catch(() => Effect.succeed(new Map<string, TwoslashCacheValue>())),
				),

			save: (envHash, entries) =>
				cache
					.set({
						key: twoslashBlobKey(envHash),
						value: encodeTwoslashCache(entries),
						// Tagged so a future maintenance command can drop every
						// generation without knowing the individual environment hashes.
						tags: ["twoslash"],
					})
					.pipe(Effect.catch(() => Effect.void)),
		});
	}),
).pipe(Layer.provide(CacheLive));

/**
 * A cache that holds nothing, for when the real one cannot be opened.
 *
 * @remarks
 * `load` returns empty and `save` discards, which is precisely the behaviour
 * before this cache existed: type-check everything, persist nothing.
 */
const DegradedLive = Layer.succeed(
	TwoslashCacheService,
	withGeneration({
		load: () => Effect.succeed(new Map<string, TwoslashCacheValue>()),
		save: () => Effect.void,
	}),
);
