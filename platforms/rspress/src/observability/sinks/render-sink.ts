import path from "node:path";
import { Effect, FileSystem } from "effect";
import type { CodeBlockComponent, PluginEvent } from "../events.js";
import type { CodeBlockReport } from "../metric-report.js";
import type { EventSink } from "./types.js";

/**
 * Sample-shaped render-phase data: the parts of code-block attribution that do
 * NOT belong in the metric registry.
 *
 * Scope, component and whether Twoslash ran are bounded dimensions and live as
 * metric attributes (see `metric-report.ts`). File paths are unbounded — one
 * series per page would grow the registry with the site — so per-file totals and
 * the slowest individual blocks are accumulated here instead, with the slowest
 * list explicitly capped.
 *
 * This sink is fed almost entirely during RSPress's own render pass, which runs
 * after the plugin's `config()` hook returns. That is safe because RSPress's MDX
 * loader runs on the Rspack main thread, in this module instance — see
 * `render-phase-instrumentation.md`.
 */

/** Per-file timing rollup. */
export interface RenderFileBucket {
	readonly blocks: number;
	readonly twoslashBlocks: number;
	readonly totalMs: number;
	readonly twoslashMs: number;
}

/** One code block, retained only for the slowest-N list. */
export interface RenderBlockSample {
	readonly apiScope: string;
	readonly file: string;
	readonly component: CodeBlockComponent;
	readonly totalMs: number;
	readonly twoslashMs: number;
	readonly shikiMs: number;
}

export interface RenderPhaseSamples {
	/**
	 * Wall clock from the first code block's event to the last, in milliseconds.
	 *
	 * Cross-check on the summed per-block totals: block timings are measured over
	 * synchronous spans, so summing them is valid only if nothing is double
	 * counted. The window opens at the first EVENT, which is emitted after that
	 * block's work is already done, so the summed total legitimately runs up to
	 * one block's duration above it. Materially above that — a summed total some
	 * multiple of the window — means a span is being measured across an `await`
	 * again, which reports the whole page batch for every block on the page.
	 */
	readonly wallMs: number;
	/** Keyed by `ctx.file` — the MDX page the block was rendered from. */
	readonly byFile: Record<string, RenderFileBucket>;
	readonly slowest: RenderBlockSample[];
}

const UNSCOPED = "(unscoped)";

/** How many of the slowest blocks the artifact retains. */
const SLOWEST_LIMIT = 25;

export function makeRenderSink(): EventSink & { snapshot: () => RenderPhaseSamples } {
	let firstAt = 0;
	let lastAt = 0;
	const byFile = new Map<string, RenderFileBucket>();
	// Kept sorted descending by totalMs, truncated to SLOWEST_LIMIT.
	const slowest: RenderBlockSample[] = [];

	return {
		minLevel: "trace",
		handle(event: PluginEvent): void {
			if (event._tag !== "CodeBlockProcessed") return;

			const now = performance.now();
			if (firstAt === 0) firstAt = now;
			lastAt = now;

			const sample: RenderBlockSample = {
				apiScope: event.ctx.apiScope ?? UNSCOPED,
				file: event.ctx.file ?? "unknown",
				component: event.component,
				totalMs: event.totalMs,
				twoslashMs: event.twoslashMs,
				shikiMs: event.shikiMs,
			};

			const current = byFile.get(sample.file) ?? { blocks: 0, twoslashBlocks: 0, totalMs: 0, twoslashMs: 0 };
			byFile.set(sample.file, {
				blocks: current.blocks + 1,
				twoslashBlocks: current.twoslashBlocks + (event.twoslash ? 1 : 0),
				totalMs: current.totalMs + sample.totalMs,
				twoslashMs: current.twoslashMs + sample.twoslashMs,
			});

			if (slowest.length < SLOWEST_LIMIT || sample.totalMs > (slowest.at(-1)?.totalMs ?? 0)) {
				const at = slowest.findIndex((s) => s.totalMs < sample.totalMs);
				slowest.splice(at === -1 ? slowest.length : at, 0, sample);
				if (slowest.length > SLOWEST_LIMIT) slowest.length = SLOWEST_LIMIT;
			}
		},
		snapshot(): RenderPhaseSamples {
			return {
				wallMs: firstAt === 0 ? 0 : lastAt - firstAt,
				byFile: Object.fromEntries(byFile),
				slowest: [...slowest],
			};
		},
	};
}

export interface WriteRenderPhaseOpts {
	readonly cwd: string;
	readonly packageName: string;
	readonly generatedAt: string;
}

/**
 * Write the render-phase attribution artifact to
 * `<cwd>/.api-docs/build/render-phase.json`, combining the metric-derived
 * rollups with the sample-shaped per-file and slowest-block data.
 *
 * Writes nothing when no code block was processed, so a build that never
 * reached the render phase does not leave an empty artifact behind.
 */
export function writeRenderPhaseJson(
	report: CodeBlockReport,
	samples: RenderPhaseSamples,
	opts: WriteRenderPhaseOpts,
): Effect.Effect<void, never, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		if (report.overall.blocks === 0) return;
		const fs = yield* FileSystem.FileSystem;
		const dir = path.join(opts.cwd, ".api-docs", "build");
		yield* fs.makeDirectory(dir, { recursive: true }).pipe(Effect.ignore);
		const doc = {
			generatedAt: opts.generatedAt,
			package: opts.packageName,
			target: "prod",
			overall: report.overall,
			wallMs: samples.wallMs,
			byScope: report.byScope,
			byComponent: report.byComponent,
			series: report.series,
			byFile: samples.byFile,
			slowest: samples.slowest,
		};
		yield* fs
			.writeFileString(path.join(dir, "render-phase.json"), `${JSON.stringify(doc, null, 2)}\n`)
			.pipe(Effect.ignore);
	});
}
