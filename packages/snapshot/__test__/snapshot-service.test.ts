import { Effect, Option } from "effect";
import { describe, expect, test } from "vitest";
import type { FileSnapshot } from "../src/SnapshotService.js";
import { SnapshotService } from "../src/SnapshotService.js";

function makeSnapshot(overrides: Partial<FileSnapshot> = {}): FileSnapshot {
	return {
		outputDir: "/test/output",
		filePath: "api/class/MyClass.mdx",
		publishedTime: "2024-01-15T12:00:00.000Z",
		modifiedTime: "2024-01-15T12:00:00.000Z",
		contentHash: "abc123",
		frontmatterHash: "def456",
		buildTime: "2024-01-15T12:00:00.000Z",
		...overrides,
	};
}

// The query semantics run against the real SQL over an in-memory database:
// each `layerMemory()` call is a fresh, empty `:memory:` store, so no test sees
// another's rows and none needs a temp directory. The file-backed constructor
// (WAL, checkpoint-on-close) keeps its own coverage in
// `snapshot-service-layer.test.ts`.
describe("SnapshotService queries", () => {
	test("upsert + getSnapshot: insert new, retrieve it", async () => {
		const snapshot = makeSnapshot();

		const program = Effect.gen(function* () {
			const svc = yield* SnapshotService;
			yield* svc.upsert(snapshot);
			const result = yield* svc.getSnapshot(snapshot.outputDir, snapshot.filePath);
			return result;
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(SnapshotService.layerMemory())));

		expect(Option.isSome(result)).toBe(true);
		const value = Option.getOrThrow(result);
		expect(value.outputDir).toBe(snapshot.outputDir);
		expect(value.filePath).toBe(snapshot.filePath);
		expect(value.contentHash).toBe(snapshot.contentHash);
		expect(value.frontmatterHash).toBe(snapshot.frontmatterHash);
		expect(value.publishedTime).toBe(snapshot.publishedTime);
		expect(value.modifiedTime).toBe(snapshot.modifiedTime);
	});

	test("getSnapshot returns None for missing entry", async () => {
		const program = Effect.gen(function* () {
			const svc = yield* SnapshotService;
			return yield* svc.getSnapshot("/nonexistent", "missing.mdx");
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(SnapshotService.layerMemory())));

		expect(Option.isNone(result)).toBe(true);
	});

	test("batchUpsert inserts multiple in transaction", async () => {
		const snapshots = [
			makeSnapshot({ filePath: "api/class/A.mdx" }),
			makeSnapshot({ filePath: "api/class/B.mdx" }),
			makeSnapshot({ filePath: "api/class/C.mdx" }),
		];

		const program = Effect.gen(function* () {
			const svc = yield* SnapshotService;
			const count = yield* svc.batchUpsert(snapshots);
			const all = yield* svc.getAllForDirectory("/test/output");
			return { count, all };
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(SnapshotService.layerMemory())));

		expect(result.count).toBe(3);
		expect(result.all).toHaveLength(3);
		const paths = result.all.map((s) => s.filePath).sort();
		expect(paths).toEqual(["api/class/A.mdx", "api/class/B.mdx", "api/class/C.mdx"]);
	});

	test("cleanupStale removes stale entries", async () => {
		const snapshots = [
			makeSnapshot({ filePath: "api/class/Keep.mdx" }),
			makeSnapshot({ filePath: "api/class/Remove.mdx" }),
			makeSnapshot({ filePath: "api/class/AlsoRemove.mdx" }),
		];

		const program = Effect.gen(function* () {
			const svc = yield* SnapshotService;
			yield* svc.batchUpsert(snapshots);

			const currentFiles = new Set(["api/class/Keep.mdx"]);
			const stale = yield* svc.cleanupStale("/test/output", currentFiles);

			const remaining = yield* svc.getAllForDirectory("/test/output");
			return { stale, remaining };
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(SnapshotService.layerMemory())));

		expect([...result.stale].sort()).toEqual(["api/class/AlsoRemove.mdx", "api/class/Remove.mdx"]);
		expect(result.remaining).toHaveLength(1);
		expect(result.remaining[0].filePath).toBe("api/class/Keep.mdx");
	});

	test("deleteSnapshot removes specific entry", async () => {
		const snapshot = makeSnapshot();

		const program = Effect.gen(function* () {
			const svc = yield* SnapshotService;
			yield* svc.upsert(snapshot);

			const before = yield* svc.getSnapshot(snapshot.outputDir, snapshot.filePath);
			yield* svc.deleteSnapshot(snapshot.outputDir, snapshot.filePath);
			const after = yield* svc.getSnapshot(snapshot.outputDir, snapshot.filePath);

			return { before, after };
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(SnapshotService.layerMemory())));

		expect(Option.isSome(result.before)).toBe(true);
		expect(Option.isNone(result.after)).toBe(true);
	});

	test("getFilePaths returns all paths for directory", async () => {
		const snapshots = [
			makeSnapshot({ filePath: "api/class/A.mdx" }),
			makeSnapshot({ filePath: "api/enum/B.mdx" }),
			makeSnapshot({ outputDir: "/other/dir", filePath: "api/class/C.mdx" }),
		];

		const program = Effect.gen(function* () {
			const svc = yield* SnapshotService;
			yield* svc.batchUpsert(snapshots);
			const paths = yield* svc.getFilePaths("/test/output");
			return paths;
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(SnapshotService.layerMemory())));

		expect([...result].sort()).toEqual(["api/class/A.mdx", "api/enum/B.mdx"]);
	});
});
