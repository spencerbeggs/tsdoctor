import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import type { CodeBlockComponent } from "../../../src/observability/events.js";
import { PluginEvent } from "../../../src/observability/events.js";
import type { CodeBlockReport } from "../../../src/observability/metric-report.js";
import { makeRenderSink, writeRenderPhaseJson } from "../../../src/observability/sinks/render-sink.js";

interface BlockOpts {
	readonly apiScope?: string;
	readonly file?: string;
	readonly component?: CodeBlockComponent;
	readonly twoslash?: boolean;
	readonly twoslashMs?: number;
	readonly shikiMs?: number;
	readonly totalMs?: number;
	readonly slow?: boolean;
}

function block(opts: BlockOpts = {}) {
	const twoslashMs = opts.twoslashMs ?? 0;
	const shikiMs = opts.shikiMs ?? 0;
	return PluginEvent.CodeBlockProcessed({
		ctx: {
			buildId: "b",
			...(opts.apiScope != null ? { apiScope: opts.apiScope } : {}),
			...(opts.file != null ? { file: opts.file } : {}),
		},
		level: "debug",
		lang: "typescript",
		component: opts.component ?? "ApiExample",
		twoslash: opts.twoslash ?? twoslashMs > 0,
		twoslashMs,
		shikiMs,
		totalMs: opts.totalMs ?? twoslashMs + shikiMs,
		slow: opts.slow ?? false,
	});
}

/** A minimal report standing in for what the metric registry would produce. */
function report(blocks: number, totalMs: number): CodeBlockReport {
	const bucket = {
		blocks,
		twoslashBlocks: blocks,
		slowBlocks: 0,
		totalMs,
		twoslashMs: totalMs,
		shikiMs: 0,
		otherMs: 0,
	};
	return {
		overall: bucket,
		series: [{ scope: "pkg", component: "ApiExample", twoslash: true, ...bucket }],
		byScope: { pkg: bucket },
		byComponent: { ApiExample: bucket },
	};
}

describe("makeRenderSink", () => {
	it("rolls up blocks per file", () => {
		const sink = makeRenderSink();
		sink.handle(block({ file: "a.mdx", twoslashMs: 500, totalMs: 500 }));
		sink.handle(block({ file: "a.mdx", component: "ApiSignature", shikiMs: 10, totalMs: 10 }));
		sink.handle(block({ file: "b.mdx", component: "ApiSignature", shikiMs: 20, totalMs: 20 }));

		const { byFile } = sink.snapshot();
		expect(byFile["a.mdx"]?.blocks).toBe(2);
		expect(byFile["a.mdx"]?.totalMs).toBe(510);
		expect(byFile["a.mdx"]?.twoslashMs).toBe(500);
		expect(byFile["b.mdx"]?.blocks).toBe(1);
	});

	it("counts only blocks Twoslash actually ran on as typechecked", () => {
		const sink = makeRenderSink();
		sink.handle(block({ file: "a.mdx", twoslash: true, twoslashMs: 400, totalMs: 400 }));
		sink.handle(block({ file: "a.mdx", component: "ApiSignature", twoslash: false, shikiMs: 5, totalMs: 5 }));

		expect(sink.snapshot().byFile["a.mdx"]?.twoslashBlocks).toBe(1);
	});

	it("attributes blocks with no file to a single unknown bucket", () => {
		const sink = makeRenderSink();
		sink.handle(block({ shikiMs: 8, totalMs: 8 }));

		expect(sink.snapshot().byFile.unknown?.blocks).toBe(1);
	});

	it("keeps the slowest blocks in descending order, capped at 25", () => {
		const sink = makeRenderSink();
		// 40 blocks of increasing cost — only the top 25 survive, slowest first.
		for (let i = 1; i <= 40; i++) {
			sink.handle(block({ apiScope: "pkg", file: `f${i}.mdx`, totalMs: i, twoslashMs: i }));
		}

		const { slowest } = sink.snapshot();
		expect(slowest).toHaveLength(25);
		expect(slowest[0]?.totalMs).toBe(40);
		expect(slowest.at(-1)?.totalMs).toBe(16);
		expect(slowest.map((s) => s.totalMs)).toEqual([...slowest.map((s) => s.totalMs)].sort((a, b) => b - a));
	});

	it("records the scope and component on retained samples", () => {
		const sink = makeRenderSink();
		sink.handle(block({ apiScope: "pkg", file: "a.mdx", component: "with-api", totalMs: 12, shikiMs: 12 }));

		const [sample] = sink.snapshot().slowest;
		expect(sample?.apiScope).toBe("pkg");
		expect(sample?.component).toBe("with-api");
	});

	it("falls back to an unscoped label on samples with no scope", () => {
		const sink = makeRenderSink();
		sink.handle(block({ file: "a.mdx", totalMs: 3, shikiMs: 3 }));

		expect(sink.snapshot().slowest[0]?.apiScope).toBe("(unscoped)");
	});

	it("ignores events that are not code blocks", () => {
		const sink = makeRenderSink();
		sink.handle(
			PluginEvent.PageGenerated({
				ctx: { buildId: "b" },
				level: "debug",
				item: "X",
				category: "class",
				codeblockCount: 3,
				durationMs: 5,
			}),
		);

		expect(sink.snapshot().byFile).toEqual({});
	});

	it("reports a zero window when nothing was processed", () => {
		expect(makeRenderSink().snapshot().wallMs).toBe(0);
	});

	it("spans a window from the first block to the last", () => {
		const sink = makeRenderSink();
		sink.handle(block({ totalMs: 1 }));
		sink.handle(block({ totalMs: 1 }));

		expect(sink.snapshot().wallMs).toBeGreaterThanOrEqual(0);
	});
});

describe("writeRenderPhaseJson", () => {
	it("combines metric rollups with per-file samples", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "render-phase-"));
		const sink = makeRenderSink();
		sink.handle(block({ apiScope: "pkg", file: "a.mdx", twoslashMs: 120, shikiMs: 30, totalMs: 160 }));

		await Effect.runPromise(
			writeRenderPhaseJson(report(1, 160), sink.snapshot(), {
				cwd,
				packageName: "@sites/x",
				generatedAt: "2026-08-25T00:00:00.000Z",
			}).pipe(Effect.provide(NodeFileSystem.layer)),
		);

		const doc = JSON.parse(readFileSync(join(cwd, ".api-docs", "build", "render-phase.json"), "utf-8"));
		expect(doc.package).toBe("@sites/x");
		expect(doc.overall.blocks).toBe(1);
		expect(doc.byScope.pkg.twoslashMs).toBe(160);
		expect(doc.byFile["a.mdx"].twoslashMs).toBe(120);
		expect(doc.slowest[0].file).toBe("a.mdx");
	});

	it("writes no artifact when no code block was processed", async () => {
		const cwd = mkdtempSync(join(tmpdir(), "render-phase-empty-"));

		await Effect.runPromise(
			writeRenderPhaseJson(report(0, 0), makeRenderSink().snapshot(), {
				cwd,
				packageName: "@sites/x",
				generatedAt: "2026-08-25T00:00:00.000Z",
			}).pipe(Effect.provide(NodeFileSystem.layer)),
		);

		expect(existsSync(join(cwd, ".api-docs", "build", "render-phase.json"))).toBe(false);
	});
});
