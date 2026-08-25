import { NodeFileSystem } from "@effect/platform-node";
import type { FileSnapshot } from "@tsdoctor/snapshot";
import { SnapshotService, hashContent } from "@tsdoctor/snapshot";
import { Effect, Layer, Option, Path, Ref } from "effect";
import { OgServiceLive } from "../../src/layers/OgServiceLive.js";
import { TwoslashCacheService } from "../../src/services/TwoslashCacheService.js";
import { TypeRegistryService } from "../../src/services/TypeRegistryService.js";
import { makeTwoslashCache } from "../../src/twoslash-cache.js";

/**
 * Mock SnapshotService with in-memory Map storage.
 */
export const MockSnapshotServiceLayer = Layer.effect(
	SnapshotService,
	Effect.gen(function* () {
		const store = yield* Ref.make(new Map<string, FileSnapshot>());
		return {
			hashContent,
			getSnapshot: (outputDir: string, filePath: string) =>
				Ref.get(store).pipe(Effect.map((m) => Option.fromUndefinedOr(m.get(`${outputDir}::${filePath}`)))),
			getAllForDirectory: (outputDir: string) =>
				Ref.get(store).pipe(Effect.map((m) => [...m.values()].filter((s) => s.outputDir === outputDir))),
			getFilePaths: (outputDir: string) =>
				Ref.get(store).pipe(
					Effect.map((m) => [...m.values()].filter((s) => s.outputDir === outputDir).map((s) => s.filePath)),
				),
			upsert: (snapshot: FileSnapshot) =>
				Ref.update(store, (m) => {
					const next = new Map(m);
					next.set(`${snapshot.outputDir}::${snapshot.filePath}`, snapshot);
					return next;
				}).pipe(Effect.as(true)),
			batchUpsert: (snapshots: ReadonlyArray<FileSnapshot>) =>
				Ref.update(store, (m) => {
					const next = new Map(m);
					for (const snapshot of snapshots) {
						next.set(`${snapshot.outputDir}::${snapshot.filePath}`, snapshot);
					}
					return next;
				}).pipe(Effect.as(snapshots.length)),
			deleteSnapshot: (outputDir: string, filePath: string) =>
				Ref.update(store, (m) => {
					const next = new Map(m);
					next.delete(`${outputDir}::${filePath}`);
					return next;
				}),
			cleanupStale: (_outputDir: string, _currentFiles: ReadonlySet<string>) =>
				Effect.succeed([] as ReadonlyArray<string>),
		};
	}),
);

/**
 * Mock TypeRegistryService returning empty VFS and cache.
 */
export const MockTypeRegistryServiceLayer = Layer.succeed(TypeRegistryService, {
	resolveVersions: (packages) => Effect.succeed(packages),
	loadPackages: (_packages) => Effect.succeed({ vfs: new Map() }),
});

/**
 * Mock TwoslashCacheService: always a cold cache, and saves go nowhere.
 *
 * Tests exercising config resolution must not touch the user's real XDG cache,
 * and must not have their results depend on whether a previous run warmed it.
 */
export const MockTwoslashCacheServiceLayer = Layer.succeed(TwoslashCacheService, {
	load: () => Effect.succeed(new Map()),
	save: () => Effect.void,
	// A real in-memory generation, not a stub: `registerEnvironment` hands this
	// to the Twoslash transformers, so a cache that cannot be read or written
	// would change the render path's shape rather than merely its persistence.
	open: () => Effect.succeed(makeTwoslashCache()),
	persist: () => Effect.succeed(Option.none()),
});

/**
 * The real `OgService` over the Node platform.
 *
 * @remarks
 * Not a stub. `writeSingleFile` only calls it when `siteUrl` and `packageName`
 * are both set, which the build-stages fixtures do not set, so a stub that
 * returned `Option.none` would pass whether or not the wiring was right. The
 * real layer over the real filesystem is both simpler and honest — the
 * behaviour it would stub out is covered directly in
 * `__test__/layers/og-service.test.ts`.
 */
export const TestOgServiceLayer = Layer.provide(OgServiceLive, Layer.mergeAll(NodeFileSystem.layer, Path.layer));
