---
status: current
module: rspress-plugin-api-extractor
category: performance
created: 2026-08-25
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 95
related:
  - rspress-plugin-api-extractor/roadmap-1.0.md
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/page-generation-system.md
dependencies: []
---

# Render-Phase Instrumentation

## Table of Contents

- [Overview](#overview)
- [The Two Blocking Questions](#the-two-blocking-questions)
- [What Was Not Measured](#what-was-not-measured)
- [Measuring Correctly](#measuring-correctly)
- [Dimensional Metrics](#dimensional-metrics)
- [The Artifact](#the-artifact)
- [Measured Data](#measured-data)
- [Fix Priority Decision](#fix-priority-decision)
- [Delivered: The Twoslash Result Cache](#delivered-the-twoslash-result-cache)
- [Known Limitations](#known-limitations)
- [File Locations](#file-locations)
- [Related Documentation](#related-documentation)

## Overview

This is the phase-3 design doc named in `roadmap-1.0.md`: attribute render-phase
time per scope and per code block, produce data, then decide fix priority from
that data. The settled sequencing was **instrument first, decide after** — and
that sequencing paid for itself twice, because the first two measurements this
work produced were both wrong in ways that would have sent the optimization
effort at the wrong target.

The headline result: **Twoslash accounts for ~97% of render-phase code-block
time, concentrated in ~11% of blocks.** Fix (a), a persisted Twoslash result
cache, is the performance work. Fix (b), per-scope TypeScript environments,
stays scheduled on correctness grounds — the data gives it no performance case.

## The Two Blocking Questions

`build-progress-and-issues.md` recorded two open questions blocking any
render-phase instrumentation. Both are answered from the vendored RSPress source
(`.repos/rspress`, v2.0.17).

### Does the render pass run on the main process or in Rspack workers?

**Main Node process.** The MDX loader (`packages/core/src/node/mdx/loader.ts`)
is registered as a plain JS loader through `bundlerChain`, and neither RSPress
nor rsbuild enables `experiments.parallelLoader`. The decisive evidence is
`packages/core/src/node/mdx/processor.ts`, which keeps a **module-level `Map`**
as a cross-compiler cache explicitly commented "only for web and node, one write
and one read" — a cache that can only work if those compilations share one
module instance. The single `worker_threads` use in RSPress is
`ssg/renderPageWorker.ts`, the SSG page render, which runs downstream of
bundling and never touches the plugin's remark plugins.

Consequence: the existing EventBus works unchanged during the render phase, and
a main-process observer sees live counters. The obstacle was never the process
model — it was the `Effect.scoped` **lifetime**, which ends when `config()`
returns. `afterBuild` runs after bundling, so it can read everything the render
pass emitted.

### What is the code-block denominator?

**Knowable at generation time.** `PageGenerated` already carries a real
`codeblockCount`, computed in `build-stages.ts` by counting the
`<ApiSignature|ApiMember|ApiExample>` JSX elements the page generators emit. The
count is complete even on an incremental build, because `generateSinglePage`
produces content for every work item before the snapshot comparison decides
whether to write it.

In the event, the denominator turned out not to be needed for the phase-3 gate:
the per-block attribution below answers the question directly, and a live
render-phase progress ticker remains future work (see
[Known Limitations](#known-limitations)).

### Not a problem: the `node_md` environment

RSPress builds up to three environments — `web`, `node` (SSG), and `node_md`
(only when `config.llms` is set, which this plugin's LLMs integration requires).
An early concern was that the plugin's remark plugins would run twice, doubling
Twoslash work. They do not: `createMDXOptions` excludes both
`remarkPluginsFromPlugins` and all rehype plugins when `isSsgMd` is true. The
`node_md` compile skips the plugin entirely. The `web` and `node` compiles share
a single MDX compile through the cross-compiler cache above, so each page's code
blocks are rendered **once** per production build.

## What Was Not Measured

`CodeBlockProcessed` was emitted from exactly one place: `remark-with-api.ts`,
the user-authored ` ```ts with-api ` fence path. The generated-page path —
`remark-api-codeblocks.ts` rendering the `ApiSignature` / `ApiMember` /
`ApiExample` components the page generators emit — emitted **nothing**.

That is the dominant path. Every recorded code-block statistic, including the
"184 of 184 blocks were slow" figure from the effected/website build that
motivated this phase, described only the minority `with-api` path.

The one instrumented path was also mislabeled. `shikiMs` was measured around
`codeToHast`, which runs Twoslash as a Shiki transformer, so it *included*
Twoslash; `twoslashMs` was computed as `total - shikiMs`, so it actually
measured Prettier plus cross-linking. The Shiki/Twoslash split was not being
measured at all. `twoslash-timing-wrapper.ts` — which wraps the transformer's
`preprocess` hook, exactly where the work happens — existed in the tree as dead
code, referenced only by its own test.

## Measuring Correctly

### The Twoslash/Shiki split

`@shikijs/twoslash`'s transformer (`.repos/shiki/packages/twoslash/src/core.ts`)
calls `twoslasher()` — the entire type-check — inside its `preprocess` hook. The
other hooks (`tokens`, `pre`, `postprocess`) only decorate the result. Wrapping
`preprocess` therefore yields a true split: `twoslashMs` is time inside that
hook, and `shikiMs` is the render call minus it.

The wrapper is created **fresh per block**, closing over that block's
accumulator. Blocks on a page are rendered concurrently, so a shared accumulator
would be raced; a per-block wrapper cannot be. It delegates to the shared
transformer instance, so the TypeScript environment cache is still reused across
blocks, and it spreads the original's remaining hooks so Shiki's internal
`WeakMap` keyed on `this.meta` still lines up.

### Spans must not cross an `await`

This is the trap that produced the first wrong answer, and it is worth stating
precisely because the resulting numbers looked entirely plausible.

`unist-util-visit` is synchronous. It creates and starts every block's async IIFE
on a page before any of them resumes from its first `await`. An async function
runs synchronously up to that point, so `highlighter.codeToHast` — itself
synchronous — completes for **every** block during the visit pass. Each block's
continuation, where a `performance.now() - blockStart` would be evaluated, is
then scheduled as a microtask that runs only after the whole page's batch is
done.

A span measured across the `await` therefore reports *the page's batch window*,
not the block's cost. The symptom was unmistakable once looked for: on the
`sites/multi` build, every slow block came from `pipeline.mdx` and reported
1063–1066 ms, and `maxTotalMs` was ~1065 ms for all three component kinds. The
summed "total" was 36.0 s, and it attributed 78% of the time to Shiki.

The fix is to measure only synchronous spans and add them:

```ts
const shikiStart = performance.now();
const hastPromise = generateShikiHast(...); // sync render happens during this call
const renderMs = performance.now() - shikiStart;
let hast = await hastPromise;

const postStart = performance.now();
// ... cross-linking (synchronous)
const postMs = performance.now() - postStart;

const totalBlockTime = renderMs + postMs;
```

With that change the same build reports 7.9 s and attributes 97% to Twoslash.

### The additivity cross-check

Summing per-block spans is only valid if nothing is double-counted, so the
render sink also records `wallMs` — the window from the first code-block event
to the last. The window opens at the first *event*, which is emitted after that
block's work is already finished, so the summed total legitimately runs up to
one block's duration above it (observed: 7,872 ms summed against a 7,111 ms
window, a gap of ~761 ms against a slowest block of ~873 ms). A summed total
that is a *multiple* of the window is the signature of the await-crossing bug
returning.

## Dimensional Metrics

The first version of this work aggregated per-scope and per-component rollups by
hand inside a new sink. That was the wrong shape: every new question would have
cost another sink. Effect v4 metrics carry attributes, and a registry entry is
keyed by metric name **plus** attribute set, so each distinct combination
accumulates its own series.

Code-block measurements are therefore recorded twice by `metrics-sink.ts`: once
undimensioned (the build-wide totals the summary reads) and once tagged with
`{ scope, component, twoslash }`. `Metric.snapshot` then yields the whole
breakdown, and `metric-report.ts` only groups and formats it. Adding a dimension
is now a tag, not a sink.

### Which sinks the pattern generalizes to

The pattern applies to **aggregation**, not to every sink, and the cardinality
rule below decides. Of the five sinks:

- **Console** and **trace** are payload renderers — they need the event's text,
  paths and reasons. Metrics cannot express them and they are not candidates.
- **Issues** stores sample-shaped diagnostic text (`text`, `file`, `line`,
  `column`) for `issues.json`. The text stays a sample; its *counts* were worth
  dimensioning.
- **Metrics** and **render** are covered above.

So beyond the code-block metrics, three further dimensions were added at the
emit site, each answering a question the flat counter could not:

| Metric | Attributes | Question it answers |
| --- | --- | --- |
| `phase.time.ms` | `phase` | Which phase was slow — the histogram collapsed every phase into one distribution |
| `twoslash.diagnostics` | `code`, `scope` | Which TS code dominates, and in which API |
| `files.total` | `scope`, `status` | Incremental-build behaviour per API, not just build-wide |
| `shiki.errors` | `scope` | Previously hit the sink's `default` branch and reached no metric at all |

`seriesFor(snapshots, id)` in `metric-report.ts` is the generic reader: it
breaks any counter down by its attributes, largest first. Adding a dimension now
costs a tag at the emit site and nothing in the reporting layer.

### Bounded dimensions are metrics; unbounded ones are samples

Scope, component and whether Twoslash ran are bounded — a site has a handful of
each. File paths are not: one series per page would grow the registry with the
site. So per-file totals and the slowest-N individual blocks stay sample-shaped
in `render-sink.ts`, with the slowest list explicitly capped at 25. That
cardinality line is the rule for anything added later.

### Registry scoping, and the limit of it

`Metric.MetricRegistry` is a `Context.Reference` whose default `Map` is created
once and shared by every context that does not override it — Effect's own
documentation flags this. The plugin never provided one, so all builds in a
process and all tests in a run accumulated into a single registry. That is why
`logBuildSummary` needed its `isFirstBuild` guard and why the metric tests could
only assert `toBeGreaterThanOrEqual` lower bounds.

Each build now gets a `MetricStore` — a registry plus the two forms its
consumers need. These **must** be handed out together:

- `layer` is what Effect programs read through (`logBuildSummary`,
  `Metric.snapshot`).
- `context` is what the metrics sink writes through, via `metric.updateUnsafe`.

The sink runs on the synchronous EventBus fan-out, outside any fiber, so it
cannot pick up an ambient runtime's registry. A bare
`Effect.runSync(Metric.update(...))` resolves the Reference **default** and
silently writes to a different registry than the one being read — a divergence
that produces an all-zeros summary and no error. Writing through an explicit
context also removes ~30 `Effect.runSync` allocations from the hot path.

**The isolation has a real limit.** A store isolates metrics recorded *with*
attributes. It does not isolate the undimensioned ones: Effect resolves an
attribute-free metric's registry entry once and caches it on the metric object,
so module-level constants keep pointing at whichever registry touched them
first, for the life of the process. Attributed writes skip that cache and
resolve against the calling context every time. Consequences:

- The dimensioned code-block report isolates cleanly and is asserted exactly.
- The undimensioned totals remain process-wide, unchanged from before — which
  is why a second build in one process (dev HMR) still sees cumulative totals,
  and why the metrics-sink tests assert deltas rather than absolutes.

## The Artifact

Production builds write `<cwd>/.api-docs/build/render-phase.json`, alongside
`issues.json` (see `build-progress-and-issues.md` for the directory's
lifecycle). It combines both halves: `overall` / `byScope` / `byComponent` /
`series` come from the metric registry, `wallMs` / `byFile` / `slowest` from the
render sink. Nothing is written when no code block was processed, so a build
that never reached the render phase leaves no empty artifact.

The console summary appends the per-scope lines after the aggregate code-block
line:

```text
render phase: 129 code blocks in 7.9s (twoslash 7.6s 97%, shiki 0.2s 3%, other 0.0s 0%)
  kitchensink: 100 blocks, 7.9s (twoslash 7.6s, 14 typechecked)
  effect-kit: 29 blocks, 0.0s (twoslash 0.0s, 0 typechecked)
```

## Measured Data

`sites/multi` (two APIs: `kitchensink`, `effect-kit`), production build.

| Component | blocks | total | share | per block | twoslash |
| --- | --- | --- | --- | --- | --- |
| `ApiExample` | 14 (11%) | 7,777 ms | **98.7%** | 556 ms | 7,623 ms |
| `ApiSignature` | 61 (47%) | 84 ms | 1.1% | 1.4 ms | 0 |
| `ApiMember` | 54 (42%) | 11 ms | 0.1% | 0.2 ms | 0 |

Overall: 129 blocks, 7,872 ms summed over a 7,111 ms window; Twoslash 7,623 ms
(96.8%), Shiki 243 ms (3.1%), everything else 7 ms.

Every one of the 13–14 blocks flagged slow (>500 ms) is a Twoslash block; not a
single non-Twoslash block crosses the threshold. The five metric series show the
same split per scope — `kitchensink/ApiExample/twoslash=true` carries 7,777 ms
across 14 blocks, while `kitchensink/ApiMember/twoslash=false` carries 10 ms
across 48.

Second data point, `sites/effect` (no `@example` TSDoc, therefore no Twoslash
blocks): 29 blocks, 0.1 s total. Cost tracks Twoslash blocks exactly.

Consistency with the real-scale evidence: at ~556 ms per Twoslash block, the
effected/website build's 184 slow blocks imply roughly 92 s, the right order of
magnitude for its observed 3m20s render pass.

## Fix Priority Decision

**Fix (a) — a persisted Twoslash result cache — is the performance work**, and
is now built; see [Delivered](#delivered-the-twoslash-result-cache). It
targets 97% of measured render-phase code-block cost. It is also cheaper to
build than assumed: `@shikijs/twoslash` already exposes a first-class
`TwoslashTypesCache` extension point (`init` / `read` / `write` / `preprocess`,
in `.repos/shiki/packages/twoslash/src/types.ts`) passed as the transformer's
`typesCache` option, so the cache protocol does not have to be invented — only
a keying scheme (code hash, VFS hash, compiler-options hash) and a store. The
XDG-backed `@effected/store` `Cache` the registry already uses is the obvious
home.

**Fix (b) — per-scope TypeScript environments — is not a performance fix.** The
data gives it no case: 97% of the time is inside `twoslasher()`, and splitting
one shared environment into several would *reduce* `tsEnvCache` sharing across
blocks, plausibly making it slower. It remains scheduled as the `with-api`
scoping **correctness** fix that retires the documented "first API's tsconfig
wins" limitation (`type-loading-vfs.md`) — on correctness grounds, which is
what the roadmap anticipated when it said the evidence decides its priority, not
its existence.

## Delivered: The Twoslash Result Cache

Fix (a) is implemented (`src/twoslash-cache.ts`, `services/TwoslashCacheService.ts`,
`layers/TwoslashCacheServiceLive.ts`).

### Shape

`@shikijs/twoslash` accepts a `typesCache` on the transformer, and calls its
`read`/`write` around the whole `twoslasher()` invocation — so a hit skips the
type-check entirely rather than merely speeding it up. Those hooks are
**synchronous**, so persistence is load-once before the render phase (in
`ConfigServiceLive`, once the VFS is final) and save-once after it (in
`afterBuild`, since the render phase runs after `config()` returns); every
lookup in between is an in-memory map hit.

The stored value is `Pick<TwoslashReturn, "nodes" | "code">` plus an optional
`meta.extension`, all of it plain JSON — verified against
`twoslash-protocol`'s node definitions, which are numbers, strings and string
tuples with no functions or class instances. A generation is stored as one
gzipped JSON blob in a sqlite-backed `@effected/store` `Cache` under the XDG
cache dir (`~/.cache/tsdoctor/twoslash.sqlite`), alongside the type registry's
own cache. XDG rather than the repo: the contents are regenerable and
content-addressed, so they belong with the user's caches, shared across
worktrees and untouched by cleaning `dist/`.

### Soundness and invalidation

The key covers every input: the per-entry key is the code (plus language), and
the type environment and compiler options are folded into the blob's identity
via `twoslashEnvHash`. Any VFS change therefore starts a fresh generation,
because a declaration change anywhere can legitimately change any block's
inferred types. Generations coexist, keyed by environment hash.

That soundness buys coarse invalidation: the cache makes repeat builds over an
**unchanged** API nearly free — CI re-runs, prose-only edits, theme and config
changes — and does nothing for the build right after an API item changes.
Sharpening it needs per-scope type environments (fix (b)), which would stop one
package's change from invalidating every other package's blocks.

Every failure path degrades to a cache miss: an unreadable blob, a missing
HOME, an unwritable cache dir. A cache that cannot be read must never fail a
build that would otherwise succeed.

### Measured

`sites/multi`, production builds with Rspack's own cache cleared each time so
the MDX genuinely recompiles:

| Build | Cache | Render phase | Twoslash | Wall clock |
| --- | --- | --- | --- | --- |
| Cold | 0/14 hits | 8.1 s | 7.8 s | 11.3 s |
| Warm | **14/14 hits** | **0.2 s** | **0.0 s** | **2.3 s** |

The render phase drops ~40x and Twoslash disappears from it. Two correctness
checks back this up: the warm build's `dist/` is **byte-identical** to the cold
build's (`diff -r`, no differences), and building `sites/basic` — a different
type environment — correctly took a cold cache and wrote its own 32-entry
generation while `sites/multi` continued to hit 14/14.

Note that the first warm measurement was misleading and had to be discarded:
with Rspack's build cache intact the MDX never recompiles, so the render phase
does not run at all and the Twoslash cache reports `0/0 hits`. A wall-clock
improvement there measures Rspack's cache, not this one.

## Known Limitations

- **No live render-phase ticker.** The process-model question is answered, so
  one is now buildable: the render pass runs in this module instance, and the
  metric registry is readable live. It was not built here because the phase-3
  gate is attribution, not progress reporting. The `Effect.scoped` block hosting
  the existing heartbeat still ends when `config()` returns, so a render-phase
  ticker needs its own lifetime rather than that fiber.
- **`with-api` `shikiMs` is an upper bound, not an exact cost.**
  `remark-with-api.ts` calls the standalone async `codeToHast` from `shiki`,
  which resolves a lazily-created singleton highlighter and is therefore
  genuinely async — the span has to cross an await, so concurrently-rendered
  blocks on the same page can land inside it. `twoslashMs` is unaffected
  (measured inside the synchronous `preprocess` hook). Cross-linking used to be
  folded into this span too, overstating the Shiki share on top of the
  interleaving; it is now captured after `renderMs` and falls into the derived
  `otherMs`, matching the split the generated-page path makes.

  Making `shikiMs` exact here would mean rendering through the scope's shared
  highlighter (a synchronous call, as in `remark-api-codeblocks.ts`), but that
  highlighter only exists for documented scopes — a `with-api` fence on a page
  outside any package's route has no registry entry, and would stop rendering.
  So the bound stays, deliberately.
- **Fixture-scale data.** `sites/multi` has 14 Twoslash blocks. The per-block
  cost and the component split are consistent with the effected/website
  evidence, but the conclusion has not been re-measured at 22-API scale.
- **Undimensioned totals are process-wide**, per the registry-scoping limit
  above.

## File Locations

| File | Purpose |
| --- | --- |
| `src/observability/metric-report.ts` | `seriesFor` generic breakdown reader; `codeBlockReport` over `Metric.snapshot`, `codeBlockReportFrom`, `formatCodeBlockReport` |
| `src/observability/sinks/render-sink.ts` | Sample-shaped per-file and slowest-block data, `wallMs`, `writeRenderPhaseJson` |
| `src/observability/sinks/metrics-sink.ts` | Dimensional recording via `Metric.withAttributes` + `updateUnsafe` |
| `src/layers/build-metrics.ts` | `MetricStore`, `makeMetricStore`, `CodeBlockAttributes`, summed-ms counters |
| `src/remark-api-codeblocks.ts` | `CodeBlockProcessed` emit site for generated blocks; sync-scoped spans |
| `src/remark-with-api.ts` | `CodeBlockProcessed` emit site for user-authored fences |
| `src/twoslash-timing-wrapper.ts` | Wraps the transformer's `preprocess` hook for per-block Twoslash timing |
| `src/observability/events.ts` | `CodeBlockProcessed` shape, `CodeBlockComponent`, `TwoslashCacheLoaded`/`TwoslashCacheSaved` |
| `src/twoslash-cache.ts` | `twoslashEnvHash`, `makeTwoslashCache`, encode/decode |
| `src/services/TwoslashCacheService.ts` | Load/save contract for a stored generation |
| `src/layers/TwoslashCacheServiceLive.ts` | XDG sqlite-backed persistence via `@effected/store` `Cache` |

## Related Documentation

- **Roadmap and the phase-3 gate:** `roadmap-1.0.md`
- **The EventBus/sink/metrics substrate this extends:** `performance-observability.md`
- **The evidence that motivated the phase, and the `.api-docs/build/` directory:** `build-progress-and-issues.md`
- **The combined-VFS limitation fix (b) would retire:** `type-loading-vfs.md`
- **Where the generated code blocks come from:** `page-generation-system.md`
