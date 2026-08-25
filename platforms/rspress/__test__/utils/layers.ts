import { NodeFileSystem } from "@effect/platform-node";
import type { FileSnapshot } from "@tsdoctor/snapshot";
import { SnapshotService } from "@tsdoctor/snapshot";
import { Effect, Layer, Option, Path, Ref } from "effect";
import { OgService } from "../../src/services/OgService.js";
import { TwoslashCacheService } from "../../src/services/TwoslashCacheService.js";
import { TypeRegistryService } from "../../src/services/TypeRegistryService.js";

/**
 * A STATEFUL SnapshotService double, backed by an in-memory Map.
 *
 * @remarks
 * Deliberately not `SnapshotService.layerTest()`. That double is stateless —
 * every lookup misses and every write is discarded — which is the right shape
 * for a test that only needs the service present. These tests exercise
 * incremental-build behaviour, where a write has to be visible to the read that
 * follows it; against a stateless double, "unchanged file is skipped" would
 * pass for the wrong reason, because nothing was ever stored to compare with.
 */
export const MockSnapshotServiceLayer = Layer.effect(
	SnapshotService,
	Effect.gen(function* () {
		const store = yield* Ref.make(new Map<string, FileSnapshot>());
		return {
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
 * TypeRegistryService resolving every spec unchanged and loading an empty VFS.
 *
 * @remarks
 * A thin alias over the service's own double, kept because it is referenced by
 * name across the suite. New tests can call `TypeRegistryService.layerTest()`
 * directly, and pass overrides for the members they actually exercise.
 */
export const MockTypeRegistryServiceLayer = TypeRegistryService.layerTest();

/**
 * Mock TwoslashCacheService: always a cold cache, and saves go nowhere.
 *
 * Tests exercising config resolution must not touch the user's real XDG cache,
 * and must not have their results depend on whether a previous run warmed it.
 */
export const MockTwoslashCacheServiceLayer = TwoslashCacheService.layerTest();

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
export const TestOgServiceLayer = Layer.provide(OgService.layer, Layer.mergeAll(NodeFileSystem.layer, Path.layer));
