import { join } from "node:path";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem } from "effect";
import { describe, expect, it } from "vitest";
import { PluginEvent } from "../../../src/observability/events.js";
import { eventToIssue, makeIssuesSink, writeIssuesJson } from "../../../src/observability/sinks/issues-sink.js";

describe("eventToIssue", () => {
	it("maps a TwoslashDiagnostic to a twoslash warning with TS code and api scope", () => {
		const mapped = eventToIssue(
			PluginEvent.TwoslashDiagnostic({
				ctx: { buildId: "b", packageName: "@effect/schema" },
				level: "warn",
				file: "api/class/schema.mdx",
				line: 12,
				col: 8,
				code: 2304,
				message: "Cannot find name 'ZodType'.",
				snippet: "",
			}),
		);
		expect(mapped).toEqual({
			bucket: "warnings",
			issue: {
				source: "twoslash",
				level: "warn",
				text: "Cannot find name 'ZodType'.",
				code: "TS2304",
				file: "api/class/schema.mdx",
				line: 12,
				column: 8,
				api: "@effect/schema",
			},
		});
	});
	it("maps a RouteCollisionDetected to a routing error", () => {
		const mapped = eventToIssue(
			PluginEvent.RouteCollisionDetected({ ctx: { buildId: "b" }, level: "error", items: ["Foo", "foo"] }),
		);
		expect(mapped?.bucket).toBe("errors");
		expect(mapped?.issue.source).toBe("routing");
		expect(mapped?.issue.code).toBe("route-collision");
	});
	it("ignores non-issue events", () => {
		expect(
			eventToIssue(
				PluginEvent.PageGenerated({
					ctx: { buildId: "b" },
					level: "debug",
					item: "X",
					category: "class",
					codeblockCount: 0,
					durationMs: 1,
				}),
			),
		).toBeNull();
	});
});

describe("makeIssuesSink", () => {
	it("accumulates issues into buckets", () => {
		const sink = makeIssuesSink();
		sink.handle(PluginEvent.PrettierError({ ctx: { buildId: "b" }, level: "warn", file: "x.mdx", reason: "bad" }));
		sink.handle(
			PluginEvent.ModelLoadFailed({ ctx: { buildId: "b" }, level: "error", modelPath: "m.json", reason: "nope" }),
		);
		const snap = sink.snapshot();
		expect(snap.warnings).toHaveLength(1);
		expect(snap.errors).toHaveLength(1);
		expect(snap.suppressed).toHaveLength(0);
		expect(snap.warnings[0]?.source).toBe("prettier");
	});

	it("reset() clears all buckets", () => {
		const sink = makeIssuesSink();
		sink.handle(PluginEvent.PrettierError({ ctx: { buildId: "b" }, level: "warn", file: "x.mdx", reason: "bad" }));
		sink.handle(
			PluginEvent.ModelLoadFailed({ ctx: { buildId: "b" }, level: "error", modelPath: "m.json", reason: "nope" }),
		);
		sink.reset();
		const snap = sink.snapshot();
		expect(snap.warnings).toHaveLength(0);
		expect(snap.errors).toHaveLength(0);
		expect(snap.suppressed).toHaveLength(0);
	});
});

describe("writeIssuesJson", () => {
	it("writes the bundler-compatible schema to .api-docs/build/issues.json", async () => {
		// An in-memory volume: the write and the read-back share ONE provide, so
		// the assertion inspects the volume the writer actually wrote to.
		const dir = "/site";
		const doc = await Effect.runPromise(
			Effect.gen(function* () {
				yield* writeIssuesJson(
					{
						warnings: [
							{ source: "twoslash", level: "warn", text: "x", code: "TS1", file: "f.mdx", line: 1, column: 2 },
						],
						errors: [],
						suppressed: [],
					},
					{ cwd: dir, packageName: "@site/x", generatedAt: "2026-07-22T00:00:00.000Z" },
				);
				const fs = yield* FileSystem.FileSystem;
				return JSON.parse(yield* fs.readFileString(join(dir, ".api-docs", "build", "issues.json")));
			}).pipe(Effect.provide(MemoryFileSystem.layer)),
		);
		expect(doc).toEqual({
			generatedAt: "2026-07-22T00:00:00.000Z",
			package: "@site/x",
			target: "prod",
			warnings: [{ source: "twoslash", level: "warn", text: "x", code: "TS1", file: "f.mdx", line: 1, column: 2 }],
			errors: [],
			suppressed: [],
		});
	});
});
