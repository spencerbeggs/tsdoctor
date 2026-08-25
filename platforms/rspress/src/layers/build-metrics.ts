import { Context, Layer, Metric } from "effect";

/**
 * The registry map `Metric.MetricRegistry` carries, derived from the Reference
 * rather than restated — Effect's own metadata type is `any`-parameterised, and
 * inferring it keeps that out of this module's surface.
 */
type MetricRegistryMap = typeof Metric.MetricRegistry extends Context.Reference<infer T> ? T : never;

/**
 * Attributes carried by the code-block metrics, giving every code-block
 * measurement its scope, component and whether Twoslash ran.
 *
 * Effect v4 keys a metric's registry entry by name PLUS attribute set, so each
 * distinct combination accumulates its own series. That is what makes per-scope
 * and per-component attribution a property of the metric layer rather than
 * something a bespoke aggregating sink has to recompute.
 */
export interface CodeBlockAttributes extends Readonly<Record<string, string>> {
	/** `ctx.apiScope`, or `"(unscoped)"` when the event carried none. */
	readonly scope: string;
	/** `ApiSignature` | `ApiMember` | `ApiExample` | `with-api`. */
	readonly component: string;
	/** `"true"` when the Twoslash transformer ran — attributes are strings. */
	readonly twoslash: string;
}

/**
 * One build's metric state, in the three forms its consumers need.
 *
 * `Metric.MetricRegistry` is a `Context.Reference` whose default value is
 * created once and then shared by every context that does not override it — so
 * without an explicit registry all builds in a process (and all tests in a run)
 * accumulate together, which is why the summary could only ever be read as a
 * lower bound.
 *
 * Both forms must be handed out together: the `layer` is what Effect programs
 * read through (`logBuildSummary`, `Metric.snapshot`), while `context` is what
 * the metrics sink writes through. The sink runs on the synchronous EventBus
 * fan-out, outside any fiber, so it cannot pick the registry up from an ambient
 * runtime — a bare `Effect.runSync(Metric.update(...))` resolves the Reference
 * DEFAULT and would silently write to a different registry than the one being
 * read.
 *
 * ISOLATION CAVEAT. A store isolates metrics recorded WITH attributes; it does
 * not isolate the plain undimensioned ones. Effect resolves a metric's registry
 * entry once and caches it on the metric object itself when no attributes are
 * present, so these module-level constants keep pointing at whichever registry
 * touched them first, for the life of the process. Attributed writes skip that
 * cache and resolve against the calling context every time, which is why the
 * per-scope code-block report (see `metric-report.ts`) isolates cleanly while
 * the undimensioned totals stay process-wide — unchanged from before, and the
 * reason a second build in one process (dev HMR) still sees cumulative totals.
 */
export interface MetricStore {
	readonly registry: MetricRegistryMap;
	/** Context carrying `registry`, for `Metric.updateUnsafe` from sync code. */
	readonly context: Context.Context<never>;
	/** Layer providing `registry`, for Effect programs that read metrics. */
	readonly layer: Layer.Layer<never>;
}

/** Create an isolated metric store for a single build. */
export function makeMetricStore(): MetricStore {
	const registry: MetricRegistryMap = new Map();
	return {
		registry,
		context: Context.make(Metric.MetricRegistry, registry),
		layer: Layer.succeed(Metric.MetricRegistry, registry),
	};
}

/**
 * All build metrics as named counters/histograms.
 *
 * Metric state lives in the `Metric.MetricRegistry` of the surrounding context,
 * not in these constants, so these may be shared module-level values while each
 * build still gets its own counters — see {@link MetricRegistryLive}.
 *
 * Extracted into its own module so that `metrics-sink.ts` can import it
 * without creating a circular dependency through `ObservabilityLive.ts`
 * (which itself imports `metrics-sink.ts`).
 */
export const BuildMetrics = {
	filesTotal: Metric.counter("files.total"),
	filesNew: Metric.counter("files.new"),
	filesModified: Metric.counter("files.modified"),
	filesUnchanged: Metric.counter("files.unchanged"),
	codeblockDuration: Metric.histogram("codeblock.duration", {
		boundaries: [10, 25, 50, 100, 200, 500, 1000],
	}),
	codeblockShikiDuration: Metric.histogram("codeblock.shiki.duration", {
		boundaries: [5, 10, 25, 50, 100, 250],
	}),
	codeblockTotal: Metric.counter("codeblock.total"),
	codeblockSlow: Metric.counter("codeblock.slow"),
	/**
	 * Summed milliseconds per dimension. Counters rather than histograms because
	 * the question these answer is "where did the time go", which needs a total;
	 * the histograms above still carry the distribution.
	 */
	codeblockTimeMs: Metric.counter("codeblock.time.ms"),
	codeblockTwoslashMs: Metric.counter("codeblock.twoslash.ms"),
	codeblockShikiMs: Metric.counter("codeblock.shiki.ms"),
	/** Blocks the Twoslash transformer actually ran on. */
	codeblockTwoslashTotal: Metric.counter("codeblock.twoslash.total"),
	twoslashErrors: Metric.counter("twoslash.errors"),
	prettierErrors: Metric.counter("prettier.errors"),
	/** Shiki render failures. Previously unmapped, so they never reached a metric. */
	shikiErrors: Metric.counter("shiki.errors"),
	pagesGenerated: Metric.counter("pages.generated"),
	apisCompleted: Metric.counter("apis.completed"),
	apiVersionsLoaded: Metric.counter("api.versions.loaded"),
	externalPackagesTotal: Metric.counter("external.packages.total"),
	phaseDuration: Metric.histogram("phase.duration", {
		boundaries: [50, 100, 250, 500, 1000, 2500, 5000, 10000],
	}),
	/**
	 * Summed phase milliseconds. Tagged by phase name, which the histogram alone
	 * cannot express — every phase previously collapsed into one distribution, so
	 * resolve could not be told apart from generate or write.
	 */
	phaseTimeMs: Metric.counter("phase.time.ms"),
	vfsFiles: Metric.counter("vfs.files"),
	importsPrepended: Metric.counter("imports.prepended"),
	twoslashDiagnostics: Metric.counter("twoslash.diagnostics"),
	configDefaultsApplied: Metric.counter("config.defaults.applied"),
} as const;
