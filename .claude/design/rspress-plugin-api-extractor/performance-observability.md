---
status: current
module: rspress-plugin-api-extractor
category: observability
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/error-observability.md
  - rspress-plugin-api-extractor/render-phase-instrumentation.md
  - rspress-plugin-api-extractor/effect-service-layer.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
---

# Performance observability

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Event bus](#event-bus)
- [Event taxonomy](#event-taxonomy)
- [Correlation envelope and level ladder](#correlation-envelope-and-level-ladder)
- [Sinks](#sinks)
- [Spans](#spans)
- [Build metrics](#build-metrics)
- [Build summary](#build-summary)
- [Sync-island bridge](#sync-island-bridge)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

Build observability is a synchronous fan-out `EventBus` feeding five sinks: console (human-readable or JSON, level-filtered), issues (the `issues.json` artifact), trace (opt-in full-fidelity JSONL), metrics (events to `BuildMetrics` counters and histograms, dimensioned where a breakdown is worth querying) and render (sample-shaped render-phase data). `plugin.ts` creates the bus once at factory time and tears it down at the end of `afterBuild`. The production-only heartbeat and the issues artifact ride this substrate and are documented in `build-progress-and-issues.md`; the render-phase attribution in `render-phase-instrumentation.md`.

## Current state

| Concern | Where it lives |
| --- | --- |
| `PluginEvent` tagged enum, `EventLevel`, `LEVEL_RANK`, `EventContext` | `src/observability/events.ts` |
| `EventBus` service, `emit`, `wantsLevel`, `makeRuntimeEmitter` | `src/observability/EventBus.ts` |
| The five sinks and the `EventSink` interface | `src/observability/sinks/` |
| `withPhase` spans | `src/observability/spans.ts` |
| `BuildMetrics`, `MetricStore` / `makeMetricStore` | `src/layers/build-metrics.ts` |
| `buildEventBus`, `logBuildSummary`, `makeSummaryLoggerLayer` | `src/layers/observability.ts` |
| Metric breakdown reader | `src/observability/metric-report.ts` |
| Sync-island bridge | `src/observability/sync-emitter.ts` |
| Options and their resolution | `src/schemas/observability.ts` (`resolveObservability`) |

## Event bus

The `EventBus` is not an async PubSub: `emit` fans out to every registered sink inline, so by the time the emitting fiber resumes every sink has finished, which keeps metrics exact when `logBuildSummary` reads them in `afterBuild`. `makeShape(sinks)` computes the highest-rank `minLevel` among sinks that declare `capturesPayload` — those that actually serialize the event (the trace sink always; the console sink only in JSON mode) — and `wantsLevel(level)` reports whether any such sink would admit it, so a caller is not forced to build an expensive payload just to bump a counter. Fan-out itself ignores the flag: the metrics sink at `minLevel: "trace"` sees everything. The free `emit` and `wantsLevel` functions use `Effect.serviceOption(EventBus)` and are no-ops when no bus is in context, so they require nothing.

## Event taxonomy

`PluginEvent` is a `Data.TaggedEnum` whose variants span lifecycle (`BuildStarted`, `BuildCompleted`, `BuildProgress`, `ApiDocsCompleted`, `PhaseStarted` / `PhaseCompleted`, `SlowOperation`), config resolution (`ConfigCascadeWarning`, `ConfigValidationWarning`), model loading (`ModelLoaded`, `ModelLoadFailed`), type loading and VFS (`VfsGenerated`, `ImportsPrepended`, `TypeRegistryEvent`, `TwoslashCacheLoaded` / `TwoslashCacheSaved` and kin), routing (`RouteCollisionDetected`, `ItemSkipped`), page generation and code blocks (`PageGenerated`, `CodeBlockProcessed`, `TwoslashDiagnostic`, `TwoslashCheckFailed`, `PrettierError`, `ShikiError`), write and cleanup (`FileDecision`, `StaleDeleted`, `OrphanDeleted`, `EmptyDirRemoved`) and LLMs. Every variant carries a `level`; `levelOf(event)` reads it. See `events.ts` for the full list.

**A variant with no emit site is deleted, not kept.** A taxonomy entry the code cannot produce is a promise the trace and the issues artifact cannot keep.

Known limitation: `BuildStarted.mode` is always `"prod"` regardless of whether `rspress dev` or `rspress build` is running.

## Correlation envelope and level ladder

Every event carries an `EventContext` envelope (`buildId`, `apiScope`, `packageName`, `version`, `locale`, `entryPoint`, `route`, `file`, `symbol`), every field optional. Emit sites do not pass `buildId`: `emit` fills it from the `BuildId` `Context.Reference` whenever the caller left it empty, and a caller that sets a non-empty value keeps it. A Reference reaches code that no parameter can — module-level layers with no build to name — which is why it is a Reference and not a threaded argument; a required field callers cannot reach is a field that gets faked. Sync-island sites read `syncBuildId()` instead.

Levels rank `error` (0), `warn`, `info`, `debug`, `trace` (4); a sink with `minLevel: "info"` admits ranks 0–2. `none` disables console output entirely. `verbose` is accepted as a config input and normalized to `debug` by `resolveObservability`.

## Sinks

All five implement `EventSink` (`sinks/types.ts`): a `minLevel`, a synchronous `handle` and the optional `capturesPayload` flag.

- **Console** (`console-sink.ts`) — `minLevel` is the configured `logLevel`. Human-readable mode prints `[HH:MM:SS] message` with a one-liner per variant; JSON mode (`json: true`, which `resolveObservability` derives from `logLevel === "debug"`) prints `JSON.stringify({ timestamp, ...event })` and sets `capturesPayload`.
- **Issues** (`issues-sink.ts`) — accumulates a curated subset of diagnostic events into `warnings` / `errors` / `suppressed` buckets; collection is always on, only the write is production-gated. Mapping and schema in `build-progress-and-issues.md`.
- **Trace** (`trace-sink.ts`) — `minLevel: "trace"`, `capturesPayload: true`, one synchronous `appendFileSync` per event to `<cwd>/.api-docs/build/trace-<buildId>.jsonl`. The path is resolved eagerly at factory time from `cwd`, so the sink opens (creating the directory, truncating the file) immediately. Trace and console level are independent: `logLevel: "info"` with `trace: true` still writes every event.
- **Metrics** (`metrics-sink.ts`) — `minLevel: "trace"`; writes through `metric.updateUnsafe(input, context)` with the build's `MetricStore.context`, because the sink runs outside any fiber and a bare `Effect.runSync(Metric.update(...))` would resolve the `MetricRegistry` Reference default and write to a different registry than the one the summary reads. The event-to-metric map is the `switch` in the sink; `FileDecision`, `TwoslashDiagnostic`, `PrettierError`, `ShikiError`, `CodeBlockProcessed` and `PhaseCompleted` additionally record a `Metric.withAttributes` copy tagged with bounded dimensions (`render-phase-instrumentation.md`). `externalPackagesTotal` and `apiVersionsLoaded` are not event-derived: they are `yield* Metric.update(...)` calls inside `config-resolution.ts`'s generator — inside the fiber, so they hit the build's registry. `Metric.value` cannot detect a metric escaping to the wrong registry; only `Metric.snapshot` containment can, and such a test must live in its own file because an attribute-free metric's registry hook is cached process-wide on first touch (`__test__/config-service-metrics.test.ts`).
- **Render** (`render-sink.ts`) — sample-shaped data that does not belong in the registry: per-file rollups, the slowest code blocks and the render-phase wall-clock window (`render-phase-instrumentation.md`).

## Spans

`withPhase(phase, ctx, effect)` wraps an Effect in `Effect.withSpan`, emits `PhaseStarted` and `PhaseCompleted` with the measured duration and emits `SlowOperation` when the duration exceeds the threshold for that phase. Thresholds come from the `Thresholds` `Context.Reference`, not a parameter; phase names map to threshold keys via `PHASE_THRESHOLD_KEY` in `spans.ts`. The spans are OpenTelemetry-compatible but no exporter is wired — a dormant seam.

## Build metrics

`BuildMetrics` (`layers/build-metrics.ts`) holds the `Metric.counter` and `Metric.histogram` instances; it is its own module to avoid a circular import between the metrics sink and the layer that assembles sinks, and has exactly one import path.

`makeMetricStore()` gives each build its own `Metric.MetricRegistry` rather than the process-wide default the Reference falls back to, which dev HMR rebuilds and same-process test runs would otherwise accumulate into. It returns both forms its consumers need — `layer`, which Effect programs read through, and `context`, which the metrics sink writes through — and they must be wired together: `makeAppLayers` takes the store as one input and puts `layer` into the observability tier both runtimes are built from, so wiring them from different stores is structurally impossible (`effect-service-layer.md`). The isolation has a limit documented in `render-phase-instrumentation.md`: undimensioned metrics stay process-wide.

`makeSummaryLoggerLayer(logLevel)` builds the slim Effect Logger that gates residual `Effect.log*` calls; in v4 that is `Logger.layer` plus a `References.MinimumLogLevel` value, with `LogLevel` a string union (`"Warn"`, not `"Warning"`) and the logger receiving its message as an args array.

## Build summary

`logBuildSummary` reads the metric snapshots at the end of `afterBuild` (first build only) and prints file counts, pages and external packages, phase timing, slow code blocks and Twoslash / Prettier error totals, followed by the per-scope render-phase lines. `buildEventBus(obs)` composes the sinks into a layer and returns `BuiltSinks` — the layer plus handles on the trace, issues, render and metric stores — so `afterBuild` can flush the trace, snapshot the issues and render samples and read `Metric.snapshot` through `metrics.layer`.

## Sync-island bridge

Several modules run outside any Effect fiber — remark visitors, Shiki's `preprocess` hook, Prettier callbacks, the page-generation reporting wrapper. They reach the bus through one module, `observability/sync-emitter.ts`: `installSyncEmitter(runtime)` once in `plugin.ts`, then `emitSync(event)`, `syncBuildId()` and `syncSlowCodeBlockMs()` from any sync site (`clearSyncEmitter` and `installSyncEmitterUnsafe` exist for teardown and tests). Every value the bridge exposes is a `Context.Reference` read once at install time rather than per emit, since an emit happens per code block on a large site.

The runtime handed to `installSyncEmitter` must be synchronously buildable: `runSync` builds the runtime's layer before running anything, so a runtime whose layer opens a database fails with `AsyncFiberError` at the first emit — from a remark plugin, during RSPress's render pass, invisible to unit tests. That is why `plugin.ts` builds the second, observability-only runtime (`effect-service-layer.md`). `makeRuntimeEmitter(runtime)` in `EventBus.ts` is the primitive; `sync-emitter.ts` is its one consumer. `ModelLoadFailed` does not use the bridge — model loading is Effect-typed, so `config-resolution.ts` emits it via `Effect.tapError` inside the pipeline.

## Rationale

- **Why synchronous fan-out:** the summary must read exact counts at `afterBuild`, and an async PubSub would leave in-flight events behind.
- **Why sinks rather than a logger:** the same event feeds a human line, a metric, a machine-readable artifact and a trace; a logger serves one of those.
- **Why one bridge module:** seven byte-identical copies of the seam had already started diverging one parameter at a time; the seam is forced, the duplication was not.
- **Why a per-build registry:** without it, every build in a process shares one registry and every count is cumulative.

## Related documentation

- **Heartbeat and the `issues.json` artifact:** `build-progress-and-issues.md`
- **Dimensional metrics and the render sink in full:** `render-phase-instrumentation.md`
- **How Twoslash and Prettier errors flow through the bus:** `error-observability.md`
- **The two runtimes and the metric store invariant:** `effect-service-layer.md`
- **`FileDecision` events and file-write metrics:** `snapshot-tracking-system.md`
