import { SnapshotService, hashContent } from "@tsdoctor/snapshot";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { MockSnapshotServiceLayer } from "./layers.js";

describe("MockSnapshotServiceLayer", () => {
	it("starts empty and stores upserted snapshots", async () => {
		const program = Effect.gen(function* () {
			const service = yield* SnapshotService;

			// Initially empty
			const before = yield* service.getSnapshot("docs", "test.mdx");
			expect(Option.isNone(before)).toBe(true);

			// Upsert a snapshot
			yield* service.upsert({
				outputDir: "docs",
				filePath: "test.mdx",
				publishedTime: "2026-01-01T00:00:00Z",
				modifiedTime: "2026-01-01T00:00:00Z",
				contentHash: "abc123",
				frontmatterHash: "def456",
				buildTime: "2026-01-01T00:00:00Z",
			});

			// Now found
			const after = yield* service.getSnapshot("docs", "test.mdx");
			expect(Option.isSome(after)).toBe(true);
			if (Option.isSome(after)) {
				expect(after.value.contentHash).toBe("abc123");
			}
		});

		await Effect.runPromise(program.pipe(Effect.provide(MockSnapshotServiceLayer)));
	});

	// `hashContent` is a standalone export, not a service member: it is a pure
	// function with no IO, so putting it on the shape forced every double to
	// supply it and bought nothing. See @tsdoctor/snapshot's index.
	it("hashContent produces consistent SHA-256", async () => {
		const program = Effect.gen(function* () {
			yield* SnapshotService;
			const hash1 = hashContent("hello");
			const hash2 = hashContent("hello");
			const hash3 = hashContent("world");
			expect(hash1).toBe(hash2);
			expect(hash1).not.toBe(hash3);
			expect(hash1).toHaveLength(64);
		});

		await Effect.runPromise(program.pipe(Effect.provide(MockSnapshotServiceLayer)));
	});
});
