import type { LogLevel } from "effect";
import { Effect, Layer, Logger, Metric, References } from "effect";
import { makeEventBusLayer } from "../observability/EventBus.js";
import type { EventLevel } from "../observability/events.js";
import type { CodeBlockReport } from "../observability/metric-report.js";
import { formatCodeBlockReport, seriesFor } from "../observability/metric-report.js";
import { makeConsoleSink } from "../observability/sinks/console-sink.js";
import type { IssuesSnapshot } from "../observability/sinks/issues-sink.js";
import { makeIssuesSink } from "../observability/sinks/issues-sink.js";
import { makeMetricsSink } from "../observability/sinks/metrics-sink.js";
import type { RenderPhaseSamples } from "../observability/sinks/render-sink.js";
import { makeRenderSink } from "../observability/sinks/render-sink.js";
import { makeTraceSink } from "../observability/sinks/trace-sink.js";
import type { EventSink } from "../observability/sinks/types.js";
import type { ResolvedObservability } from "../schemas/observability.js";
import type { MetricStore } from "./build-metrics.js";
import { BuildMetrics, makeMetricStore } from "./build-metrics.js";

function formatTime(date: Date): string {
	return date.toTimeString().slice(0, 8);
}

/**
 * A slim Effect Logger layer that gates the residual `Effect.log*` calls in
 * `build-program.ts` and `logBuildSummary` at the configured level.
 *
 * Level mapping: none→None, error→Error, warn→Warn, info→Info,
 * debug/trace→Debug.  Format: `[HH:MM:SS] <prefix><message>` with
 * `⚠️  ` / `🔴 ` prefixes for Warn / Error to match the EventBus
 * console-sink style.
 */
export function makeSummaryLoggerLayer(logLevel: EventLevel | "none"): Layer.Layer<never> {
	const effectLevel: LogLevel.LogLevel =
		logLevel === "none"
			? "None"
			: logLevel === "error"
				? "Error"
				: logLevel === "warn"
					? "Warn"
					: logLevel === "info"
						? "Info"
						: "Debug"; // debug | trace

	const pluginLogger = Logger.make(({ logLevel: lvl, message, date }) => {
		const time = formatTime(date);
		// v4 delivers the log arguments as an array.
		const msg = Array.isArray(message) ? message.map(String).join(" ") : String(message);
		const prefix = lvl === "Warn" ? "⚠️  " : lvl === "Error" ? "🔴 " : "";
		console.log(`[${time}] ${prefix}${msg}`);
	});

	return Layer.mergeAll(Logger.layer([pluginLogger]), Layer.succeed(References.MinimumLogLevel, effectLevel));
}

export interface BuiltSinks {
	readonly layer: ReturnType<typeof makeEventBusLayer>;
	readonly trace: (EventSink & { flush: () => void }) | null;
	readonly issues: EventSink & { snapshot: () => IssuesSnapshot; reset: () => void };
	readonly render: EventSink & { snapshot: () => RenderPhaseSamples };
	/** This build's isolated metric registry; its `layer` must be in the stack. */
	readonly metrics: MetricStore;
}

/**
 * Compose the console + metrics + issues + render (+ optional trace) sinks into
 * an EventBus layer.
 *
 * `cwd` is known at plugin-factory time (unlike the RSPress `outDir`), so the
 * trace path is resolved eagerly by `resolveObservability` and the trace sink
 * opens its file immediately — no deferred re-binding is needed.
 */
export function buildEventBus(obs: ResolvedObservability): BuiltSinks {
	const issues = makeIssuesSink();
	const render = makeRenderSink();
	// The sink writes through `metrics.context`; callers MUST also put
	// `metrics.layer` in the runtime's stack so reads resolve the same registry.
	const metrics = makeMetricStore();
	const sinks: EventSink[] = [
		makeConsoleSink(obs.logLevel, { json: obs.json }),
		makeMetricsSink(metrics.context),
		issues,
		render,
	];
	const trace = obs.tracePath ? makeTraceSink(obs.tracePath) : null;
	if (trace) sinks.push(trace);
	return { layer: makeEventBusLayer(sinks), trace, issues, render, metrics };
}

/**
 * Log a build summary by reading all metric snapshots.
 * Accepts the configured slow-codeblock threshold so the warning message
 * interpolates the actual threshold rather than a hard-coded 100ms.
 * Replaces the 4 separate logSummary() calls in afterBuild.
 *
 * When a code-block report is supplied, the per-scope attribution lines are
 * appended after the aggregate code-block line. The report is optional so
 * existing callers and tests keep working unchanged.
 */
export const logBuildSummary = (slowCodeBlockMs: number, renderPhase?: CodeBlockReport) =>
	Effect.gen(function* () {
		const filesTotal = yield* Metric.value(BuildMetrics.filesTotal);
		const filesNew = yield* Metric.value(BuildMetrics.filesNew);
		const filesModified = yield* Metric.value(BuildMetrics.filesModified);
		const filesUnchanged = yield* Metric.value(BuildMetrics.filesUnchanged);
		const twoslashErrors = yield* Metric.value(BuildMetrics.twoslashErrors);
		const prettierErrors = yield* Metric.value(BuildMetrics.prettierErrors);
		const codeblockTotal = yield* Metric.value(BuildMetrics.codeblockTotal);
		const codeblockSlow = yield* Metric.value(BuildMetrics.codeblockSlow);
		const pagesGenerated = yield* Metric.value(BuildMetrics.pagesGenerated);
		const externalPackages = yield* Metric.value(BuildMetrics.externalPackagesTotal);
		const phaseDurationSnapshot = yield* Metric.value(BuildMetrics.phaseDuration);
		const snapshots = yield* Metric.snapshot;

		const total = filesTotal.count;
		const newCount = filesNew.count;
		const modified = filesModified.count;
		const unchanged = filesUnchanged.count;
		const tsErrors = twoslashErrors.count;
		const prErrors = prettierErrors.count;
		const blocks = codeblockTotal.count;
		const slowBlocks = codeblockSlow.count;

		// File summary
		if (total === 0) {
			yield* Effect.log("📝 No files generated");
		} else if (newCount === 0 && modified === 0) {
			yield* Effect.log(`📝 ${total} files (all unchanged)`);
		} else {
			const parts: string[] = [];
			if (newCount > 0) parts.push(`${newCount} new`);
			if (modified > 0) parts.push(`${modified} modified`);
			if (unchanged > 0) parts.push(`${unchanged} unchanged`);
			yield* Effect.log(`📝 ${total} files (${parts.join(", ")})`);
		}

		// Pages and external packages summary
		if (pagesGenerated.count > 0) {
			yield* Effect.log(`🧩 ${pagesGenerated.count} pages, ${externalPackages.count} external package(s)`);
		}

		// Per-phase duration summary. The named breakdown comes from the tagged
		// `phase.time.ms` counter; the histogram alone collapses every phase into
		// one distribution and cannot say which phase was slow.
		if (phaseDurationSnapshot.count > 0) {
			const phases = seriesFor(snapshots, "phase.time.ms");
			const named = phases
				.map((p) => `${p.attributes.phase ?? "?"} ${(p.value / 1000).toFixed(1)}s`)
				.slice(0, 6)
				.join(", ");
			yield* Effect.log(
				named.length > 0
					? `⏱ ${phaseDurationSnapshot.count} phase(s): ${named}`
					: `⏱ ${phaseDurationSnapshot.count} phase(s) timed`,
			);
		}

		// Code block summary
		if (blocks > 0 && slowBlocks > 0) {
			yield* Effect.logWarning(
				`Code block performance: ${slowBlocks} of ${blocks} blocks were slow (>${slowCodeBlockMs}ms)`,
			);
		}

		// Render-phase attribution (per scope / component), when collected
		if (renderPhase) {
			for (const line of formatCodeBlockReport(renderPhase)) {
				yield* Effect.log(line);
			}
		}

		// Error summary
		const totalErrors = tsErrors + prErrors;
		if (totalErrors > 0) {
			const errorParts: string[] = [];
			if (tsErrors > 0) errorParts.push(`${tsErrors} Twoslash`);
			if (prErrors > 0) errorParts.push(`${prErrors} Prettier`);
			yield* Effect.logWarning(`${totalErrors} error(s) in code blocks (${errorParts.join(", ")})`);

			// Which diagnostic dominates, and where — the question an agent fixing
			// broken examples actually asks. Free from the tagged counter.
			const byCode = seriesFor(snapshots, "twoslash.diagnostics");
			for (const series of byCode.slice(0, 5)) {
				yield* Effect.logWarning(
					`  ${series.attributes.code ?? "TS?"} x${series.value} in ${series.attributes.scope ?? "(unscoped)"}`,
				);
			}
		}
	});
