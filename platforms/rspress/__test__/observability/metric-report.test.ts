import { Effect, Metric } from "effect";
import { describe, expect, it } from "vitest";
import { makeMetricStore } from "../../src/layers/build-metrics.js";
import type { CodeBlockComponent } from "../../src/observability/events.js";
import { PluginEvent } from "../../src/observability/events.js";
import { codeBlockReport, formatCodeBlockReport, seriesFor } from "../../src/observability/metric-report.js";
import { makeMetricsSink } from "../../src/observability/sinks/metrics-sink.js";

interface BlockOpts {
	readonly apiScope?: string;
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
		ctx: { buildId: "b", ...(opts.apiScope != null ? { apiScope: opts.apiScope } : {}) },
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

/**
 * Run the sink and read the report against a FRESH metric registry.
 *
 * The isolation is the point: `Metric.MetricRegistry` is a `Context.Reference`
 * whose default `Map` is shared by every context that does not override it, so
 * without this each test would see every other test's counters and could only
 * assert lower bounds.
 */
function reportFor(events: ReadonlyArray<PluginEvent>) {
	const store = makeMetricStore();
	const sink = makeMetricsSink(store.context);
	for (const event of events) sink.handle(event);
	// The sink wrote through `store.context`; the read must go through the layer
	// carrying the SAME registry, which is exactly the pairing the plugin wires.
	return Effect.runPromise(codeBlockReport.pipe(Effect.provide(store.layer)));
}

describe("codeBlockReport", () => {
	it("reports nothing when no code block was processed", async () => {
		const report = await reportFor([]);

		expect(report.overall.blocks).toBe(0);
		expect(report.series).toEqual([]);
	});

	it("attributes exact totals per scope", async () => {
		const report = await reportFor([
			block({ apiScope: "pkg-a", twoslashMs: 500, totalMs: 500 }),
			block({ apiScope: "pkg-a", component: "ApiSignature", shikiMs: 10, totalMs: 10 }),
			block({ apiScope: "pkg-b", component: "ApiSignature", shikiMs: 20, totalMs: 20 }),
		]);

		expect(report.overall.blocks).toBe(3);
		expect(report.overall.totalMs).toBe(530);
		expect(report.byScope["pkg-a"]?.blocks).toBe(2);
		expect(report.byScope["pkg-a"]?.totalMs).toBe(510);
		expect(report.byScope["pkg-b"]?.totalMs).toBe(20);
	});

	it("attributes exact totals per component", async () => {
		const report = await reportFor([
			block({ apiScope: "pkg", component: "ApiExample", twoslashMs: 800, totalMs: 800 }),
			block({ apiScope: "pkg", component: "ApiMember", shikiMs: 3, totalMs: 3 }),
			block({ apiScope: "pkg", component: "ApiMember", shikiMs: 4, totalMs: 4 }),
		]);

		expect(report.byComponent.ApiExample?.totalMs).toBe(800);
		expect(report.byComponent.ApiMember?.blocks).toBe(2);
		expect(report.byComponent.ApiMember?.totalMs).toBe(7);
	});

	it("counts only blocks Twoslash actually ran on as typechecked", async () => {
		const report = await reportFor([
			block({ apiScope: "pkg", twoslash: true, twoslashMs: 400, totalMs: 400 }),
			block({ apiScope: "pkg", component: "ApiSignature", twoslash: false, shikiMs: 5, totalMs: 5 }),
		]);

		expect(report.overall.blocks).toBe(2);
		expect(report.overall.twoslashBlocks).toBe(1);
	});

	it("derives the residue not spent in Twoslash or Shiki", async () => {
		const report = await reportFor([block({ apiScope: "pkg", twoslashMs: 700, shikiMs: 200, totalMs: 1000 })]);

		expect(report.overall.otherMs).toBe(100);
	});

	it("splits one scope into a series per component", async () => {
		const report = await reportFor([
			block({ apiScope: "pkg", component: "ApiExample", twoslashMs: 900, totalMs: 900 }),
			block({ apiScope: "pkg", component: "ApiSignature", shikiMs: 5, totalMs: 5 }),
		]);

		expect(report.series).toHaveLength(2);
		// Sorted by cost, so the expensive series leads.
		expect(report.series[0]?.component).toBe("ApiExample");
		expect(report.series[0]?.twoslash).toBe(true);
		expect(report.series[1]?.twoslash).toBe(false);
	});

	it("buckets blocks carrying no scope separately", async () => {
		const report = await reportFor([block({ component: "with-api", shikiMs: 8, totalMs: 8 })]);

		expect(report.byScope["(unscoped)"]?.blocks).toBe(1);
	});

	it("counts slow blocks per scope", async () => {
		const report = await reportFor([
			block({ apiScope: "pkg", twoslashMs: 900, totalMs: 900, slow: true }),
			block({ apiScope: "pkg", component: "ApiSignature", shikiMs: 2, totalMs: 2 }),
		]);

		expect(report.byScope.pkg?.slowBlocks).toBe(1);
	});

	it("does not leak counters between registries", async () => {
		await reportFor([block({ apiScope: "pkg", twoslashMs: 500, totalMs: 500 })]);
		const second = await reportFor([block({ apiScope: "pkg", twoslashMs: 20, totalMs: 20 })]);

		expect(second.overall.blocks).toBe(1);
		expect(second.overall.totalMs).toBe(20);
	});
});

/** Snapshot the registry after driving the sink, for generic breakdown queries. */
function snapshotFor(events: ReadonlyArray<PluginEvent>) {
	const store = makeMetricStore();
	const sink = makeMetricsSink(store.context);
	for (const event of events) sink.handle(event);
	return Effect.runPromise(Metric.snapshot.pipe(Effect.provide(store.layer)));
}

describe("seriesFor", () => {
	it("returns nothing for a metric that was never recorded", async () => {
		expect(seriesFor(await snapshotFor([]), "phase.time.ms")).toEqual([]);
	});

	it("breaks phase time down by phase name, largest first", async () => {
		const snapshots = await snapshotFor([
			PluginEvent.PhaseCompleted({ ctx: { buildId: "b" }, level: "info", phase: "resolve", durationMs: 200 }),
			PluginEvent.PhaseCompleted({ ctx: { buildId: "b" }, level: "info", phase: "generate", durationMs: 900 }),
			PluginEvent.PhaseCompleted({ ctx: { buildId: "b" }, level: "info", phase: "generate", durationMs: 100 }),
		]);

		const series = seriesFor(snapshots, "phase.time.ms");
		expect(series).toHaveLength(2);
		expect(series[0]).toEqual({ attributes: { phase: "generate" }, value: 1000 });
		expect(series[1]).toEqual({ attributes: { phase: "resolve" }, value: 200 });
	});

	it("breaks twoslash diagnostics down by TS code and scope", async () => {
		const diagnostic = (code: number, apiScope: string) =>
			PluginEvent.TwoslashDiagnostic({
				ctx: { buildId: "b", apiScope },
				level: "warn",
				file: "f.mdx",
				line: 1,
				col: 1,
				code,
				message: "m",
				snippet: "s",
			});

		const series = seriesFor(
			await snapshotFor([diagnostic(2304, "a"), diagnostic(2304, "a"), diagnostic(2353, "b")]),
			"twoslash.diagnostics",
		);

		expect(series[0]).toEqual({ attributes: { code: "TS2304", scope: "a" }, value: 2 });
		expect(series[1]).toEqual({ attributes: { code: "TS2353", scope: "b" }, value: 1 });
	});

	it("breaks file decisions down by scope and status", async () => {
		const decision = (status: "new" | "unchanged", apiScope: string) =>
			PluginEvent.FileDecision({
				ctx: { buildId: "b", apiScope },
				level: "debug",
				file: "f.mdx",
				status,
				contentHash: "c",
				frontmatterHash: "f",
				source: "snapshot",
			});

		const series = seriesFor(
			await snapshotFor([decision("new", "a"), decision("unchanged", "a"), decision("unchanged", "a")]),
			"files.total",
		);

		expect(series[0]).toEqual({ attributes: { scope: "a", status: "unchanged" }, value: 2 });
		expect(series[1]).toEqual({ attributes: { scope: "a", status: "new" }, value: 1 });
	});

	it("records shiki errors, which previously reached no metric at all", async () => {
		const series = seriesFor(
			await snapshotFor([
				PluginEvent.ShikiError({ ctx: { buildId: "b", apiScope: "a" }, level: "warn", file: "f.mdx", reason: "bad" }),
			]),
			"shiki.errors",
		);

		expect(series).toEqual([{ attributes: { scope: "a" }, value: 1 }]);
	});
});

describe("formatCodeBlockReport", () => {
	it("returns nothing when no code block was processed", async () => {
		expect(formatCodeBlockReport(await reportFor([]))).toEqual([]);
	});

	it("reports the twoslash share of total render time", async () => {
		const report = await reportFor([block({ apiScope: "pkg-a", twoslashMs: 8000, shikiMs: 2000, totalMs: 10000 })]);

		const [headline] = formatCodeBlockReport(report);
		expect(headline).toContain("1 code blocks in 10.0s");
		expect(headline).toContain("twoslash 8.0s 80%");
		expect(headline).toContain("shiki 2.0s 20%");
	});

	it("lists scopes slowest-first and truncates past ten", async () => {
		const events = Array.from({ length: 12 }, (_, i) =>
			block({ apiScope: `pkg-${i + 1}`, twoslashMs: (i + 1) * 100, totalMs: (i + 1) * 100 }),
		);

		const lines = formatCodeBlockReport(await reportFor(events));
		expect(lines[1]).toContain("pkg-12");
		expect(lines.at(-1)).toBe("  and 2 more scopes");
	});
});
