import type { FileSnapshot } from "@tsdoctor/snapshot";
import { SnapshotService, hashContent } from "@tsdoctor/snapshot";
import { Effect, Layer, Option, Ref } from "effect";
import { deriveOutputPaths, normalizeBaseRoute } from "../../src/path-derivation.js";
import { PathDerivationService } from "../../src/services/PathDerivationService.js";
import { TwoslashCacheService } from "../../src/services/TwoslashCacheService.js";
import { TypeRegistryService } from "../../src/services/TypeRegistryService.js";

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
 * Mock PathDerivationService using the real pure functions.
 */
export const MockPathDerivationServiceLayer = Layer.succeed(PathDerivationService, {
	derivePaths: (input) => Effect.succeed(deriveOutputPaths(input)),
	normalizeBaseRoute: (route) => Effect.succeed(normalizeBaseRoute(route)),
});

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
});
