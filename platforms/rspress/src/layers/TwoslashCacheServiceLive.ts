import { NodeFileSystem } from "@effect/platform-node";
import { Cache } from "@effected/store";
import { AppDirs, Xdg } from "@effected/xdg";
import { Effect, Layer, Option, Path } from "effect";
import { TwoslashCacheService } from "../services/TwoslashCacheService.js";
import type { TwoslashCacheValue } from "../twoslash-cache.js";
import { decodeTwoslashCache, encodeTwoslashCache, twoslashBlobKey } from "../twoslash-cache.js";

const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, Path.layer);

/**
 * XDG app dirs under the same `tsdoctor` namespace the type registry uses, so
 * every derived-artifact cache this plugin keeps lives in one place.
 */
const AppDirsLive = AppDirs.layer({ namespace: "tsdoctor" }).pipe(
	Layer.provide(Layer.mergeAll(Xdg.layer, PlatformLive)),
);

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
export const TwoslashCacheServiceLive = Layer.succeed(TwoslashCacheService, {
	load: (envHash) =>
		Effect.gen(function* () {
			const cache = yield* Cache;
			const entry = yield* cache.get(twoslashBlobKey(envHash));
			return Option.isSome(entry) ? decodeTwoslashCache(entry.value.value) : new Map<string, TwoslashCacheValue>();
		}).pipe(
			Effect.provide(CacheLive),
			Effect.catchCause(() => Effect.succeed(new Map<string, TwoslashCacheValue>())),
		),

	save: (envHash, entries) =>
		Effect.gen(function* () {
			const cache = yield* Cache;
			yield* cache.set({
				key: twoslashBlobKey(envHash),
				value: encodeTwoslashCache(entries),
				// Tagged so a future maintenance command can drop every generation
				// without knowing the individual environment hashes.
				tags: ["twoslash"],
			});
		}).pipe(
			Effect.provide(CacheLive),
			Effect.catchCause(() => Effect.void),
		),
});
