import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { TwoslashCacheStats, TwoslashCacheValue, TwoslashResultCache } from "../twoslash-cache.js";

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
) {}
