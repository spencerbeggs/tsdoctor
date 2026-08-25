import { Effect, Metric } from "effect";

/**
 * Reporting over the Effect metric registry.
 *
 * The code-block metrics are recorded twice by `metrics-sink.ts` — once
 * undimensioned and once tagged with `{ scope, component, twoslash }` — and
 * Effect v4 keys a registry entry by metric name PLUS attribute set. Reading a
 * snapshot therefore yields the per-scope and per-component breakdown directly,
 * with no sink recomputing it.
 *
 * Deliberately NOT metrics: per-file totals and the slowest individual blocks.
 * Those are unbounded-cardinality (one series per file path would grow the
 * registry with the site), so they stay sample-shaped in `render-sink.ts`. The
 * dividing line is cardinality: bounded dimensions are metrics, unbounded ones
 * are samples.
 */

/** One attribute combination of a metric, with its accumulated value. */
export interface MetricSeries {
	readonly attributes: Readonly<Record<string, string>>;
	readonly value: number;
}

/**
 * Break any counter down by its attributes, largest first.
 *
 * This is the generic form of what the code-block report does: because Effect
 * keys a registry entry by metric name plus attribute set, a breakdown is a
 * filter over `Metric.snapshot`, not something a sink has to accumulate. Adding
 * a dimension to an existing metric therefore costs a tag at the emit site and
 * nothing here.
 */
export function seriesFor(snapshots: ReadonlyArray<Metric.Metric.Snapshot>, id: string): MetricSeries[] {
	return snapshots
		.filter((snap) => snap.id === id && snap.attributes !== undefined)
		.map((snap) => ({ attributes: snap.attributes ?? {}, value: counterValue(snap.state) }))
		.filter((series) => series.value > 0)
		.sort((a, b) => b.value - a.value);
}

/** Rolled-up timings for one group of code blocks. */
export interface CodeBlockBucket {
	readonly blocks: number;
	readonly twoslashBlocks: number;
	readonly slowBlocks: number;
	readonly totalMs: number;
	readonly twoslashMs: number;
	readonly shikiMs: number;
	/** `totalMs` minus Twoslash and Shiki: Prettier, cross-linking, encoding. */
	readonly otherMs: number;
}

/** One fully-qualified attribute combination. */
export interface CodeBlockSeries extends CodeBlockBucket {
	readonly scope: string;
	readonly component: string;
	readonly twoslash: boolean;
}

export interface CodeBlockReport {
	readonly overall: CodeBlockBucket;
	readonly series: CodeBlockSeries[];
	readonly byScope: Record<string, CodeBlockBucket>;
	readonly byComponent: Record<string, CodeBlockBucket>;
}

const METRIC_IDS = {
	blocks: "codeblock.total",
	twoslashBlocks: "codeblock.twoslash.total",
	slowBlocks: "codeblock.slow",
	totalMs: "codeblock.time.ms",
	twoslashMs: "codeblock.twoslash.ms",
	shikiMs: "codeblock.shiki.ms",
} as const;

type Field = keyof typeof METRIC_IDS;

const ID_TO_FIELD = new Map<string, Field>(Object.entries(METRIC_IDS).map(([field, id]) => [id, field as Field]));

function emptyBucket(): CodeBlockBucket {
	return { blocks: 0, twoslashBlocks: 0, slowBlocks: 0, totalMs: 0, twoslashMs: 0, shikiMs: 0, otherMs: 0 };
}

function withOther(bucket: CodeBlockBucket): CodeBlockBucket {
	return { ...bucket, otherMs: Math.max(0, bucket.totalMs - bucket.twoslashMs - bucket.shikiMs) };
}

function add(a: CodeBlockBucket, b: CodeBlockBucket): CodeBlockBucket {
	return withOther({
		blocks: a.blocks + b.blocks,
		twoslashBlocks: a.twoslashBlocks + b.twoslashBlocks,
		slowBlocks: a.slowBlocks + b.slowBlocks,
		totalMs: a.totalMs + b.totalMs,
		twoslashMs: a.twoslashMs + b.twoslashMs,
		shikiMs: a.shikiMs + b.shikiMs,
		otherMs: 0,
	});
}

/** Counter states carry `count`; anything else contributes nothing. */
function counterValue(state: unknown): number {
	if (typeof state !== "object" || state === null || !("count" in state)) return 0;
	const count = (state as { count: unknown }).count;
	return typeof count === "number" ? count : Number(count);
}

/**
 * Build the code-block report from an explicit set of metric snapshots.
 *
 * Split from {@link codeBlockReport} so it can be exercised without a live
 * metric registry.
 */
export function codeBlockReportFrom(snapshots: ReadonlyArray<Metric.Metric.Snapshot>): CodeBlockReport {
	const bySeries = new Map<string, { scope: string; component: string; twoslash: boolean } & CodeBlockBucket>();

	for (const snap of snapshots) {
		const field = ID_TO_FIELD.get(snap.id);
		// Only the tagged writes carry attributes; the undimensioned duplicates are
		// skipped here and the totals recomputed by summing the series, so the two
		// can never disagree inside the report.
		if (!field || !snap.attributes) continue;
		const { scope, component, twoslash } = snap.attributes;
		if (scope === undefined || component === undefined || twoslash === undefined) continue;

		const key = `${scope} ${component} ${twoslash}`;
		const current = bySeries.get(key) ?? { scope, component, twoslash: twoslash === "true", ...emptyBucket() };
		bySeries.set(key, { ...current, [field]: current[field] + counterValue(snap.state) });
	}

	const series = [...bySeries.values()].map((s) => ({ ...s, ...withOther(s) })).sort((a, b) => b.totalMs - a.totalMs);

	let overall = emptyBucket();
	const byScope = new Map<string, CodeBlockBucket>();
	const byComponent = new Map<string, CodeBlockBucket>();
	for (const s of series) {
		overall = add(overall, s);
		byScope.set(s.scope, add(byScope.get(s.scope) ?? emptyBucket(), s));
		byComponent.set(s.component, add(byComponent.get(s.component) ?? emptyBucket(), s));
	}

	return {
		overall,
		series,
		byScope: Object.fromEntries(byScope),
		byComponent: Object.fromEntries(byComponent),
	};
}

/** Read the code-block report from the current context's metric registry. */
export const codeBlockReport: Effect.Effect<CodeBlockReport> = Effect.map(Metric.snapshot, codeBlockReportFrom);

/**
 * Render the report as the console summary lines logged at the end of a build.
 * Returns an empty array when no code block was processed.
 */
export function formatCodeBlockReport(report: CodeBlockReport): string[] {
	const { overall } = report;
	if (overall.blocks === 0) return [];

	const s = (ms: number) => `${(ms / 1000).toFixed(1)}s`;
	const pct = (ms: number) => (overall.totalMs > 0 ? `${Math.round((ms / overall.totalMs) * 100)}%` : "0%");

	const lines: string[] = [
		`render phase: ${overall.blocks} code blocks in ${s(overall.totalMs)} ` +
			`(twoslash ${s(overall.twoslashMs)} ${pct(overall.twoslashMs)}, ` +
			`shiki ${s(overall.shikiMs)} ${pct(overall.shikiMs)}, ` +
			`other ${s(overall.otherMs)} ${pct(overall.otherMs)})`,
	];

	const scopes = Object.entries(report.byScope).sort((a, b) => b[1].totalMs - a[1].totalMs);
	for (const [scope, bucket] of scopes.slice(0, 10)) {
		lines.push(
			`  ${scope}: ${bucket.blocks} blocks, ${s(bucket.totalMs)} ` +
				`(twoslash ${s(bucket.twoslashMs)}, ${bucket.twoslashBlocks} typechecked)`,
		);
	}
	if (scopes.length > 10) lines.push(`  and ${scopes.length - 10} more scopes`);

	return lines;
}
