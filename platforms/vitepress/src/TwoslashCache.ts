/**
 * Persistence for the Twoslash result cache: one gzipped generation per type
 * environment in a sqlite-backed `@effected/store` Cache under the XDG cache
 * dir — the same `twoslash.sqlite` and the same blob keys the RSPress plugin
 * writes, so a site built by either adapter warms the other.
 *
 * @remarks
 * `TwoslashTypesCache.read`/`write` are synchronous (Shiki calls them inside
 * its `preprocess` hook), so persistence is load-once before generation and
 * save-once after the site build; every lookup in between is an in-memory
 * map hit. Both operations degrade: a cache that cannot be read is a cache
 * miss, and one that cannot be written loses nothing but the next warm start.
 *
 * @packageDocumentation
 */

import { Cache } from "@effected/store";
import { AppDirs } from "@effected/xdg";
import type { TwoslashCacheStats, TwoslashResultCache } from "@tsdoctor/vfs";
import { decodeTwoslashCache, encodeTwoslashCache, makeTwoslashCache, twoslashBlobKey } from "@tsdoctor/vfs";
import { Context, Effect, Layer, Option, Path } from "effect";

import { AppDirsLive, PlatformLive } from "./Registry.js";

/**
 * A sqlite-backed Cache in the XDG cache dir, separate from the registry's
 * `metadata.sqlite`. Degrading: an unusable cache directory yields a cache
 * that always misses rather than a failed build.
 */
const CacheLive = Layer.unwrap(
	Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const path = yield* Path.Path;
		const cacheDir = yield* appDirs.ensureCache;
		return Cache.layerSqlite({ filename: path.join(cacheDir, "twoslash.sqlite") });
	}),
).pipe(Layer.provide(Layer.mergeAll(AppDirsLive, PlatformLive)), Cache.degrading);

/**
 * The stats a persisted generation reports, with the environment it was
 * stored under.
 *
 * @public
 */
export interface TwoslashCacheReport extends TwoslashCacheStats {
	/** The type-environment hash the generation is keyed by. */
	readonly envHash: string;
	/** Whether the underlying store degraded at construction. */
	readonly degraded: boolean;
}

/**
 * The Twoslash generation store's contract.
 *
 * @public
 */
export interface TwoslashCacheStoreShape {
	/**
	 * Open the generation for `envHash` — seeded from the store — and hold it
	 * until {@link TwoslashCacheStoreShape.persist}.
	 */
	readonly open: (envHash: string) => Effect.Effect<TwoslashResultCache>;
	/**
	 * Persist what this build produced, if a generation was opened and it is
	 * dirty; report the stats either way.
	 */
	readonly persist: () => Effect.Effect<Option.Option<TwoslashCacheReport>>;
}

/**
 * The Twoslash generation store.
 *
 * @public
 */
export class TwoslashCacheStore extends Context.Service<TwoslashCacheStore, TwoslashCacheStoreShape>()(
	"vitepress-plugin-api-extractor/TwoslashCacheStore",
) {
	/**
	 * The live store over the XDG sqlite cache.
	 *
	 * @remarks
	 * `Layer.suspend` because the composition below is declared after this
	 * class: a static initializer runs while the module body is still
	 * evaluating, so naming those consts directly throws at import time with a
	 * clean typecheck.
	 */
	static readonly layer: Layer.Layer<TwoslashCacheStore> = Layer.suspend(() => StoreLive);

	/** An always-cold in-memory store, for tests. */
	static readonly layerTest: Layer.Layer<TwoslashCacheStore> = Layer.sync(this, () => {
		let open: { readonly cache: TwoslashResultCache; readonly envHash: string } | null = null;
		return {
			open: (envHash) =>
				Effect.sync(() => {
					const cache = makeTwoslashCache();
					open = { cache, envHash };
					return cache;
				}),
			persist: () =>
				Effect.sync(() =>
					open === null
						? Option.none()
						: Option.some({ ...open.cache.stats(), envHash: open.envHash, degraded: false }),
				),
		};
	});
}

const StoreLive = Layer.effect(
	TwoslashCacheStore,
	Effect.gen(function* () {
		const store = yield* Cache;
		let open: { readonly cache: TwoslashResultCache; readonly envHash: string } | null = null;
		return {
			open: (envHash) =>
				store.get(twoslashBlobKey(envHash)).pipe(
					Effect.map((entry) => (Option.isSome(entry) ? decodeTwoslashCache(entry.value.value) : new Map())),
					// `catch`, not `catchCause`: a miss must absorb FAILURES, not
					// interruption.
					Effect.catch(() => Effect.succeed(new Map())),
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
					const report = Option.some({ ...stats, envHash, degraded: store.degraded });
					if (!stats.dirty) return Effect.succeed(report);
					return store
						.set({ key: twoslashBlobKey(envHash), value: encodeTwoslashCache(cache.entries()), tags: ["twoslash"] })
						.pipe(
							Effect.catch(() => Effect.void),
							Effect.as(report),
						);
				}),
		};
	}),
).pipe(Layer.provide(CacheLive));
