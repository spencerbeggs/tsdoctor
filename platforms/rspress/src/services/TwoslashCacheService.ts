import type { Effect } from "effect";
import { Context } from "effect";
import type { TwoslashCacheValue } from "../twoslash-cache.js";

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
