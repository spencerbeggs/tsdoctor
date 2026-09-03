---
status: current
module: rspress-plugin-api-extractor
category: performance
created: 2026-08-25
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/vitepress-adapter.md
  - rspress-plugin-api-extractor/page-generation-system.md
---

# Render-phase instrumentation

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [The render pass](#the-render-pass)
- [Measuring correctly](#measuring-correctly)
- [Dimensional metrics](#dimensional-metrics)
- [The artifact](#the-artifact)
- [What the data showed](#what-the-data-showed)
- [The Twoslash result cache](#the-twoslash-result-cache)
- [Known limitations](#known-limitations)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

Render-phase code-block time is attributed per scope, per component and per block through dimensional Effect metrics and a sample-shaped render sink, and written to `.api-docs/build/render-phase.json` on production builds. The attribution answered the question it was built for — Twoslash accounts for nearly all render-phase code-block time, concentrated in the minority of blocks that carry examples — and the answer produced the persisted Twoslash result cache, which makes repeat builds over an unchanged API nearly free.

## Current state

| Concern | Where it lives |
| --- | --- |
| `CodeBlockProcessed` emit sites with sync-scoped spans | `src/remark-api-codeblocks.ts` (generated blocks), `src/remark-with-api.ts` (user fences) |
| Per-block Twoslash timing | `src/twoslash-timing-wrapper.ts` |
| Dimensional recording | `src/observability/sinks/metrics-sink.ts`, `CodeBlockAttributes` in `src/layers/build-metrics.ts` |
| `seriesFor`, `codeBlockReport`, `formatCodeBlockReport` | `src/observability/metric-report.ts` |
| Per-file and slowest-block samples, `writeRenderPhaseJson` | `src/observability/sinks/render-sink.ts` |
| Cache keying, codec and in-memory `TwoslashTypesCache` | `packages/vfs/src/TwoslashCache.ts` |
| RSPress persistence | `src/services/TwoslashCacheService.ts` |
| VitePress persistence | `platforms/vitepress/src/TwoslashCache.ts` |
| The environments that own the `typesCache`-carrying transformers | `src/services/TwoslashEnvironments.ts` |

## The render pass

Two facts about RSPress (vendored at `.repos/rspress`) shape everything here. The MDX loader runs on the main Node process — the cross-compiler cache in RSPress's MDX processor is a module-level `Map` that can only work if the `web` and `node` compilations share one module instance — so the event bus works unchanged during the render pass and a main-process observer sees live counters; the obstacle to a render-phase ticker is the `Effect.scoped` lifetime that ends when `config()` returns, not the process model. And the `node_md` environment, built when `config.llms` is set, excludes the plugin's remark plugins entirely, while `web` and `node` share one MDX compile, so each page's code blocks are rendered once per production build.

The code-block denominator is knowable at generation time: `PageGenerated` carries a `codeblockCount` counted from the `<ApiSignature|ApiMember|ApiExample>` elements the emitter produces, complete even on an incremental build because every page is generated before the snapshot comparison decides whether to write it.

## Measuring correctly

**The Twoslash/Shiki split.** `@shikijs/twoslash`'s transformer runs the entire type-check inside its `preprocess` hook; the other hooks only decorate. `createTwoslashTimingWrapper` wraps `preprocess` fresh per block, closing over that block's accumulator (blocks on a page render concurrently, so a shared accumulator would race), delegating to the shared transformer so the environment cache is still reused and spreading the remaining hooks so Shiki's `WeakMap` keyed on `this.meta` still lines up. `twoslashMs` is time inside the hook; `shikiMs` is the render call minus it.

**Spans must not cross an `await`.** `unist-util-visit` is synchronous and starts every block's async IIFE on a page before any resumes from its first `await`; `codeToHast` is itself synchronous, so it completes for every block during the visit pass and each continuation runs only after the whole page's batch. A span measured across the `await` reports the page's batch window, not the block's cost — every slow block on a page reporting the same duration is the signature. `remark-api-codeblocks.ts` therefore measures only synchronous spans (the render call, then the cross-linking) and adds them.

**The additivity cross-check.** The render sink records `wallMs`, the window from the first code-block event to the last. Summed per-block spans may legitimately exceed it by up to one block's duration (the window opens at the first event, emitted after that block's work is done); a summed total that is a multiple of the window means the await-crossing bug is back.

## Dimensional metrics

Effect v4 metrics carry attributes, and a registry entry is keyed by name plus attribute set, so each combination accumulates its own series. Code-block measurements are recorded twice by the metrics sink: once undimensioned (the build-wide totals the summary reads) and once tagged with `{ scope, component, twoslash }`. `Metric.snapshot` yields the breakdown and `metric-report.ts` only groups and formats it. Three further dimensions follow the same pattern: `phase.time.ms` by `phase`, `twoslash.diagnostics` by `code` and `scope`, `files.total` by `scope` and `status`, plus `shiki.errors` by `scope`. `seriesFor(snapshots, id)` breaks any counter down by its attributes, so adding a dimension costs a tag at the emit site and nothing in the reporting layer.

**Bounded dimensions are metrics; unbounded ones are samples.** Scope, component and whether Twoslash ran are bounded. File paths are not — one series per page would grow the registry with the site — so per-file totals and the slowest blocks stay sample-shaped in `render-sink.ts`, the slowest list capped. That cardinality line is the rule for anything added later.

**Registry scoping and its limit.** Each build gets its own `MetricStore` (`performance-observability.md`). The isolation covers metrics recorded with attributes, which resolve against the calling context every time. It does not cover undimensioned ones: Effect resolves an attribute-free metric's registry entry once and caches it on the metric object, so module-level constants keep pointing at whichever registry touched them first. Consequently the dimensioned report isolates cleanly and is asserted exactly, while the undimensioned totals remain process-wide — a second build in one process (dev HMR) sees cumulative totals, and the metrics-sink tests assert deltas.

## The artifact

Production builds write `<cwd>/.api-docs/build/render-phase.json` beside `issues.json`: `overall` / `byScope` / `byComponent` / `series` from the registry, `wallMs` / `byFile` / `slowest` from the render sink. Nothing is written when no code block was processed. The console summary appends one line per scope after the aggregate code-block line, with block count, total, Twoslash share and how many blocks were type-checked.

## What the data showed

Measured on the two-API `sites/multi` fixture: `ApiExample` blocks — roughly a tenth of all blocks — carried almost all render-phase time, all of it Twoslash; `ApiSignature` and `ApiMember` blocks, which are never type-checked on RSPress, cost about a millisecond each. Every block flagged slow was a Twoslash block. `sites/effect`, whose fixture has no `@example` TSDoc, confirmed that cost tracks Twoslash blocks exactly. The per-block cost was consistent with the multi-minute render pass observed on a large consumer site.

Two conclusions follow and are settled. A persisted Twoslash result cache is the performance work, because it targets nearly all of the measured cost. Per-scope TypeScript environments are not a performance fix — splitting one shared environment reduces environment-cache sharing — and shipped on correctness grounds instead, retiring the "first API's tsconfig wins" limitation (`type-loading-vfs.md`).

## The Twoslash result cache

`@shikijs/twoslash` exposes a `TwoslashTypesCache` extension point passed as the transformer's `typesCache`, and calls its `read` / `write` around the whole `twoslasher()` invocation, so a hit skips the type-check entirely. The hooks are synchronous, so persistence is load-once before the render phase (in `registerTypeEnvironments`, once the VFS is final) and save-once after it (in `afterBuild`); every lookup in between is an in-memory map hit.

The neutral half — the keying scheme, the generation codec and `makeTwoslashCache` — lives in `@tsdoctor/vfs` so both adapters share one XDG store (`~/.cache/tsdoctor/twoslash.sqlite`, a sqlite-backed `@effected/store` `Cache`) and one keying scheme; a site built by either adapter warms the other. The stored value is the Twoslash `nodes` and `code` plus an optional `meta.extension`, plain JSON, stored per generation as one gzipped blob. XDG rather than the repo because the contents are regenerable and content-addressed.

**Soundness.** A result depends on the code, the compiler options, the declarations it is checked against and the compiler. The per-entry key carries the code, its language and the compiler options; `twoslashEnvHash` carries the VFS and the TypeScript version. The TypeScript version is load-bearing: `lib.d.ts` and inference change between releases, so without it a warm cache would serve the previous compiler's hovers until the API's own declarations happened to change. One input is deliberately not derived into a key — the `@shikijs/twoslash` / `twoslash` renderer version, which determines the shape of the stored nodes; `TWOSLASH_CACHE_FORMAT` is the manual lever for that, bumped when those packages are upgraded.

That soundness buys coarse invalidation: repeat builds over an unchanged API are nearly free (CI re-runs, prose-only edits, theme and config changes), and the build right after an API item changes gets nothing, because the generation key covers the whole VFS. Every failure path degrades to a cache miss (`effect-service-layer.md`). Measured on `sites/multi` with Rspack's cache cleared so the MDX genuinely recompiles, a warm build's render phase dropped by more than an order of magnitude with output byte-identical to the cold build's — and a measurement taken with Rspack's cache intact is misleading, because then the MDX never recompiles and the Twoslash cache reports no lookups at all.

## Known limitations

- **No live render-phase ticker.** Buildable now that the process model is known, but it needs its own lifetime (`build-progress-and-issues.md`).
- **`with-api` `shikiMs` is an upper bound.** `remark-with-api.ts` calls the standalone async `codeToHast`, which resolves a lazily created highlighter and must cross an `await`, so concurrently rendered blocks on the same page can land inside the span. `twoslashMs` is unaffected. Rendering through the scope's shared highlighter would make it exact but that highlighter exists only for documented scopes, and a `with-api` fence outside any package's route would stop rendering.
- **Fixture-scale data.** The conclusion has not been re-measured at large-site scale.
- **Undimensioned totals are process-wide**, per the registry-scoping limit.

## Rationale

- **Why instrument before optimizing:** the first two measurement attempts were both wrong — a batch-window span and a mislabeled Twoslash/Shiki split — in ways that would have sent the effort at the wrong target.
- **Why attributes rather than a sink per question:** every new breakdown would otherwise cost a sink; a tag at the emit site costs nothing in the reporting layer.
- **Why the cache lives in `@tsdoctor/vfs`:** its only framework-flavoured edge is the `TwoslashTypesCache` interface, which both adapters consume, and it is keyed on the VFS hash the package already owns.

## Related documentation

- **The event bus and metric registry:** `performance-observability.md`
- **The `.api-docs/build/` directory and the heartbeat gap:** `build-progress-and-issues.md`
- **The shared VFS the cache is keyed on and the per-scope environments:** `type-loading-vfs.md`
- **The second consumer of the cache:** `vitepress-adapter.md`
- **Where the generated code blocks come from:** `page-generation-system.md`
