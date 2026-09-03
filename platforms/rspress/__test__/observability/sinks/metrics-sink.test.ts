import type { Metric } from "effect";
import { describe, expect, it } from "vitest";
import { BuildMetrics, makeMetricStore } from "../../../src/layers/build-metrics.js";
import { PluginEvent } from "../../../src/observability/events.js";
import { makeMetricsSink } from "../../../src/observability/sinks/metrics-sink.js";

const ctx = { buildId: "b1" };

// biome-ignore lint/suspicious/noExplicitAny: a heterogeneous metric map is the point of the helper
type AnyMetric = Metric.Metric<any, any>;

/**
 * Run `f` against a fresh sink and return how far each named metric advanced.
 *
 * These are DELTAS, not absolutes, and deliberately so: a metric store does not
 * isolate UNDIMENSIONED metrics. Effect resolves an attribute-free metric's
 * registry entry once and caches it on the metric object, so these module-level
 * constants accumulate across every test in the process regardless of which
 * store is passed. The dimensioned code-block metrics DO isolate and are
 * asserted exactly in `metric-report.test.ts`; see the isolation caveat on
 * `makeMetricStore`.
 */
function measure<K extends string>(
	metrics: Record<K, AnyMetric>,
	f: (sink: ReturnType<typeof makeMetricsSink>) => void,
): Record<K, number> {
	const store = makeMetricStore();
	const sink = makeMetricsSink(store.context);
	const read = (metric: AnyMetric): number => (metric.valueUnsafe(store.context) as { count?: number }).count ?? 0;

	const entries = Object.entries(metrics) as Array<[K, AnyMetric]>;
	const before = new Map(entries.map(([key, metric]) => [key, read(metric)]));
	f(sink);
	return Object.fromEntries(entries.map(([key, metric]) => [key, read(metric) - (before.get(key) ?? 0)])) as Record<
		K,
		number
	>;
}

function fileDecision(status: "new" | "modified" | "unchanged") {
	return PluginEvent.FileDecision({
		ctx,
		level: "debug",
		file: "class/foo.mdx",
		status,
		contentHash: "abc123",
		frontmatterHash: "def456",
		source: "snapshot",
	});
}

const FILE_METRICS = {
	total: BuildMetrics.filesTotal,
	new: BuildMetrics.filesNew,
	modified: BuildMetrics.filesModified,
	unchanged: BuildMetrics.filesUnchanged,
};

describe("makeMetricsSink", () => {
	it("declares minLevel 'trace' so it captures every event", () => {
		expect(makeMetricsSink(makeMetricStore().context).minLevel).toBe("trace");
	});

	it("increments filesTotal and filesNew when FileDecision{status:'new'} is handled", () => {
		expect(measure(FILE_METRICS, (sink) => sink.handle(fileDecision("new")))).toEqual({
			total: 1,
			new: 1,
			modified: 0,
			unchanged: 0,
		});
	});

	it("increments filesModified when FileDecision{status:'modified'} is handled", () => {
		expect(measure(FILE_METRICS, (sink) => sink.handle(fileDecision("modified")))).toEqual({
			total: 1,
			new: 0,
			modified: 1,
			unchanged: 0,
		});
	});

	it("increments filesUnchanged when FileDecision{status:'unchanged'} is handled", () => {
		expect(measure(FILE_METRICS, (sink) => sink.handle(fileDecision("unchanged")))).toEqual({
			total: 1,
			new: 0,
			modified: 0,
			unchanged: 1,
		});
	});

	it("increments pagesGenerated when PageGenerated is handled", () => {
		const d = measure({ pages: BuildMetrics.pagesGenerated }, (sink) =>
			sink.handle(
				PluginEvent.PageGenerated({
					ctx,
					level: "info",
					item: "Pipeline",
					category: "Classes",
					codeblockCount: 2,
					durationMs: 5,
				}),
			),
		);

		expect(d.pages).toBe(1);
	});

	it("increments apisCompleted when ApiDocsCompleted is handled", () => {
		const d = measure({ apis: BuildMetrics.apisCompleted }, (sink) =>
			sink.handle(PluginEvent.ApiDocsCompleted({ ctx, level: "debug", packageName: "@modules/kitchensink" })),
		);

		expect(d.apis).toBe(1);
	});

	it("increments twoslashDiagnostics and twoslashErrors when TwoslashDiagnostic is handled", () => {
		const d = measure({ diagnostics: BuildMetrics.twoslashDiagnostics, errors: BuildMetrics.twoslashErrors }, (sink) =>
			sink.handle(
				PluginEvent.TwoslashDiagnostic({
					ctx,
					level: "warn",
					file: "class/foo.mdx",
					line: 1,
					col: 1,
					code: 2440,
					message: "Import declaration conflicts",
					snippet: "import { x } from 'y';",
				}),
			),
		);

		expect(d).toEqual({ diagnostics: 1, errors: 1 });
	});

	it("increments prettierErrors when PrettierError is handled", () => {
		const d = measure({ prettier: BuildMetrics.prettierErrors }, (sink) =>
			sink.handle(PluginEvent.PrettierError({ ctx, level: "warn", file: "class/foo.mdx", reason: "syntax" })),
		);

		expect(d.prettier).toBe(1);
	});

	it("records duration, shiki duration and the slow counter when a slow CodeBlockProcessed is handled", () => {
		const d = measure(
			{
				total: BuildMetrics.codeblockTotal,
				slow: BuildMetrics.codeblockSlow,
				duration: BuildMetrics.codeblockDuration,
				shikiDuration: BuildMetrics.codeblockShikiDuration,
				timeMs: BuildMetrics.codeblockTimeMs,
				twoslashMs: BuildMetrics.codeblockTwoslashMs,
				shikiMs: BuildMetrics.codeblockShikiMs,
				twoslashBlocks: BuildMetrics.codeblockTwoslashTotal,
			},
			(sink) =>
				sink.handle(
					PluginEvent.CodeBlockProcessed({
						ctx,
						level: "debug",
						lang: "ts",
						component: "ApiExample",
						twoslash: true,
						shikiMs: 30,
						twoslashMs: 70,
						totalMs: 120,
						slow: true,
					}),
				),
		);

		// The summed-millisecond counters carry the split the histograms cannot.
		expect(d).toEqual({
			total: 1,
			slow: 1,
			duration: 1,
			shikiDuration: 1,
			timeMs: 120,
			twoslashMs: 70,
			shikiMs: 30,
			twoslashBlocks: 1,
		});
	});

	it("skips the shiki histogram and slow counter when shikiMs is 0 and not slow", () => {
		const d = measure(
			{
				total: BuildMetrics.codeblockTotal,
				slow: BuildMetrics.codeblockSlow,
				shikiDuration: BuildMetrics.codeblockShikiDuration,
				twoslashBlocks: BuildMetrics.codeblockTwoslashTotal,
			},
			(sink) =>
				sink.handle(
					PluginEvent.CodeBlockProcessed({
						ctx,
						level: "debug",
						lang: "ts",
						component: "ApiSignature",
						twoslash: false,
						shikiMs: 0,
						twoslashMs: 0,
						totalMs: 4,
						slow: false,
					}),
				),
		);

		// A block Twoslash never ran on must not be counted as typechecked.
		expect(d).toEqual({ total: 1, slow: 0, shikiDuration: 0, twoslashBlocks: 0 });
	});

	it("increments vfsFiles when VfsGenerated is handled", () => {
		const d = measure({ vfs: BuildMetrics.vfsFiles }, (sink) =>
			sink.handle(
				PluginEvent.VfsGenerated({ ctx, level: "debug", file: "index.d.ts", declCount: 12, contentHash: "h" }),
			),
		);

		expect(d.vfs).toBe(1);
	});

	it("increments importsPrepended when ImportsPrepended is handled", () => {
		const d = measure({ imports: BuildMetrics.importsPrepended }, (sink) =>
			sink.handle(
				PluginEvent.ImportsPrepended({
					ctx,
					level: "debug",
					file: "index.d.ts",
					imports: [{ from: "zod", symbols: ["ZodType"] }],
				}),
			),
		);

		expect(d.imports).toBe(1);
	});

	it("records phaseDuration when PhaseCompleted is handled", () => {
		const d = measure({ phase: BuildMetrics.phaseDuration }, (sink) =>
			sink.handle(PluginEvent.PhaseCompleted({ ctx, level: "info", phase: "generate", durationMs: 250 })),
		);

		expect(d.phase).toBe(1);
	});

	it("ignores unmapped event tags without touching any counter", () => {
		let threw = false;
		const d = measure({ total: BuildMetrics.codeblockTotal, files: BuildMetrics.filesTotal }, (sink) => {
			try {
				sink.handle(PluginEvent.ShikiError({ ctx, level: "warn", file: "f.mdx", reason: "bad" }));
			} catch {
				threw = true;
			}
		});

		expect(threw).toBe(false);
		expect(d).toEqual({ total: 0, files: 0 });
	});
});
