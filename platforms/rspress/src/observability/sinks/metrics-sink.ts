import type { Context } from "effect";
import { Metric } from "effect";
import type { CodeBlockAttributes } from "../../layers/build-metrics.js";
import { BuildMetrics } from "../../layers/build-metrics.js";
import type { PluginEvent } from "../events.js";
import type { EventSink } from "./types.js";

/**
 * Event-driven metrics sink.
 *
 * Translates each `PluginEvent` to the corresponding `BuildMetrics` counter or
 * histogram update against the build's metric registry. The fan-out from `EventBus.emit` is
 * synchronous, so by the time the emitting fiber resumes the metrics are already
 * recorded — counts are exact when `logBuildSummary` reads them in `afterBuild`.
 *
 * Unmapped event tags hit the `default` branch and are silently ignored.
 *
 * Events whose breakdown is worth querying are recorded twice — undimensioned
 * for the build-wide totals, and tagged for `metric-report.ts`. The attributes
 * are deliberately bounded (scope, status, phase, TS code); anything unbounded,
 * such as a file path, belongs in a sample-shaped sink instead.
 *
 * Intentionally NOT derived here: `externalPackagesTotal` and `apiVersionsLoaded`
 * remain inline increments in `ConfigServiceLive`. `externalPackagesTotal` counts
 * CONFIGURED packages via `incrementBy(length)`; the only candidate event,
 * `TypeRegistryEvent{BatchComplete}`, carries an unstructured `detail` string and
 * a `loaded` (SUCCEEDED) count — different semantics, so deriving it here would
 * change what the metric means. `apiVersionsLoaded` has no corresponding event.
 */
export function makeMetricsSink(context: Context.Context<never>): EventSink {
	// Writes go through `updateUnsafe` against an explicit context rather than
	// `Effect.runSync(Metric.update(...))`: the sink runs on the synchronous
	// fan-out, outside any fiber, so a bare runSync would resolve the
	// MetricRegistry Reference DEFAULT and write to a different registry than the
	// one `logBuildSummary` and `Metric.snapshot` read through the layer.
	const update = <I, S>(metric: Metric.Metric<I, S>, input: I): void => metric.updateUnsafe(input, context);
	/** Record `metric` twice: undimensioned, and tagged for breakdown queries. */
	const both = <I, S>(metric: Metric.Metric<I, S>, input: I, attributes: Readonly<Record<string, string>>): void => {
		update(metric, input);
		update(Metric.withAttributes(metric, attributes), input);
	};
	const scopeOf = (event: PluginEvent): string => event.ctx.apiScope ?? "(unscoped)";

	return {
		minLevel: "trace",
		handle(event: PluginEvent): void {
			switch (event._tag) {
				case "FileDecision":
					// Tagged by scope AND status, so incremental-build behaviour can be
					// read per API rather than only as a build-wide total.
					both(BuildMetrics.filesTotal, 1, { scope: scopeOf(event), status: event.status });
					if (event.status === "new") {
						update(BuildMetrics.filesNew, 1);
					} else if (event.status === "modified") {
						update(BuildMetrics.filesModified, 1);
					} else {
						update(BuildMetrics.filesUnchanged, 1);
					}
					break;

				case "PageGenerated":
					update(BuildMetrics.pagesGenerated, 1);
					break;

				case "ApiDocsCompleted":
					update(BuildMetrics.apisCompleted, 1);
					break;

				case "TwoslashDiagnostic":
					// Tagged by TS code and scope: "which diagnostic dominates, and where"
					// is the question an agent fixing examples actually asks.
					both(BuildMetrics.twoslashDiagnostics, 1, { code: `TS${event.code}`, scope: scopeOf(event) });
					update(BuildMetrics.twoslashErrors, 1);
					break;

				case "PrettierError":
					both(BuildMetrics.prettierErrors, 1, { scope: scopeOf(event) });
					break;

				case "ShikiError":
					both(BuildMetrics.shikiErrors, 1, { scope: scopeOf(event) });
					break;

				case "CodeBlockProcessed": {
					// Every code-block measurement is recorded twice: once undimensioned
					// (the build-wide totals the summary reads) and once tagged with
					// scope/component/twoslash. Effect v4 keys a registry entry by name
					// PLUS attributes, so the tagged writes accumulate their own series
					// and `Metric.snapshot` yields the per-scope and per-component
					// breakdown without any sink recomputing it.
					const attrs: CodeBlockAttributes = {
						scope: event.ctx.apiScope ?? "(unscoped)",
						component: event.component,
						twoslash: String(event.twoslash),
					};
					const tagged = <I, S>(metric: Metric.Metric<I, S>) => Metric.withAttributes(metric, attrs);

					update(BuildMetrics.codeblockTotal, 1);
					update(tagged(BuildMetrics.codeblockTotal), 1);
					update(BuildMetrics.codeblockDuration, event.totalMs);
					update(BuildMetrics.codeblockTimeMs, event.totalMs);
					update(tagged(BuildMetrics.codeblockTimeMs), event.totalMs);
					update(BuildMetrics.codeblockTwoslashMs, event.twoslashMs);
					update(tagged(BuildMetrics.codeblockTwoslashMs), event.twoslashMs);
					update(BuildMetrics.codeblockShikiMs, event.shikiMs);
					update(tagged(BuildMetrics.codeblockShikiMs), event.shikiMs);
					if (event.twoslash) {
						update(BuildMetrics.codeblockTwoslashTotal, 1);
						update(tagged(BuildMetrics.codeblockTwoslashTotal), 1);
					}
					// Guard the shiki histogram so a 0ms observation does not skew the
					// lowest bucket (matches the prior inline `if (shikiTime > 0)` guard).
					if (event.shikiMs > 0) {
						update(BuildMetrics.codeblockShikiDuration, event.shikiMs);
					}
					if (event.slow) {
						update(BuildMetrics.codeblockSlow, 1);
						update(tagged(BuildMetrics.codeblockSlow), 1);
					}
					break;
				}

				case "VfsGenerated":
					update(BuildMetrics.vfsFiles, 1);
					break;

				case "ImportsPrepended":
					update(BuildMetrics.importsPrepended, 1);
					break;

				case "PhaseCompleted":
					update(BuildMetrics.phaseDuration, event.durationMs);
					both(BuildMetrics.phaseTimeMs, event.durationMs, { phase: event.phase });
					break;

				case "DefaultApplied":
					update(BuildMetrics.configDefaultsApplied, 1);
					break;

				default:
					break;
			}
		},
	};
}
