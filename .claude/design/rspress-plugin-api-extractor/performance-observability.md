---
status: current
module: rspress-plugin-api-extractor
category: observability
created: 2026-01-17
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 90
related:
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/error-observability.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/render-phase-instrumentation.md
dependencies: []
---

# Performance Observability System Design

## Table of Contents

- [Overview](#overview)
- [EventBus: Synchronous Fan-Out](#eventbus-synchronous-fan-out)
- [PluginEvent Taxonomy](#pluginevent-taxonomy)
- [Correlation Envelope and Level Ladder](#correlation-envelope-and-level-ladder)
- [Five Sinks](#five-sinks)
- [Progress Heartbeat](#progress-heartbeat)
- [Span Substrate](#span-substrate)
- [Build Metrics](#build-metrics)
- [Build Summary](#build-summary)
- [Sync-Island Bridge](#sync-island-bridge)
- [File Locations](#file-locations)

---

## Overview

Build observability is wired through a **synchronous fan-out EventBus** backed by five sinks: a console sink (human-readable or JSON, level-filtered), an issues sink (accumulates diagnostic events into the `.api-docs/build/issues.json` artifact, production builds only), a full-fidelity JSONL trace sink (opt-in, captures every event), a metrics sink (translates events to `BuildMetrics` counters and histograms, dimensioned where a breakdown is worth querying), and a render sink (the sample-shaped render-phase data that does not belong in the metric registry — see `render-phase-instrumentation.md`).

The entire observability module lives under `platforms/rspress/src/observability/`. The
plugin creates the bus once during initialization and tears it down at the end
of `afterBuild`. A production-only progress heartbeat and the issues artifact
are documented in full in `build-progress-and-issues.md`; this document covers
the EventBus/sink/metrics substrate they ride on.

---

## EventBus: Synchronous Fan-Out

**Location:** `platforms/rspress/src/observability/EventBus.ts`

The `EventBus` is NOT an async PubSub. `emit` fans out to every registered
sink inline — by the time the emitting fiber resumes, all sinks have finished.
This keeps metrics exact when `logBuildSummary` reads them in `afterBuild`.

```typescript
interface EventBusShape {
  readonly emit: (event: PluginEvent) => Effect.Effect<void>;
  readonly wantsLevel: (level: EventLevel) => Effect.Effect<boolean>;
}

export class EventBus extends Context.Service<EventBus, EventBusShape>()(
  "rspress-plugin-api-extractor/EventBus"
) {}
```

`makeShape(sinks)` computes `maxAdmitted` as the highest-rank `minLevel` among
sinks that declare `capturesPayload: true` — sinks that actually serialize the
event. The trace sink always sets it; the console sink sets it only in JSON
mode (`capturesPayload: json`), since human-readable rendering does not
consume a structured payload. Scalar-only sinks such as the metrics sink omit
the flag, so callers are not forced to build an expensive string/JSON payload
just to bump a counter. `wantsLevel(level)` returns `true` when
`levelRank(level) <= maxAdmitted`, and `false` when no bus is in context.

Fan-out itself is unaffected by the flag: `emit` still delivers to every sink
whose `minLevel` admits the event's rank, so the metrics sink at
`minLevel: "trace"` sees everything regardless of `wantsLevel`.

The free `emit(event)` and `wantsLevel(level)` functions use
`Effect.serviceOption(EventBus)` and are no-ops when no bus is in context,
requiring `R = never` so they are safe to call from any effect.

---

## PluginEvent Taxonomy

**Location:** `platforms/rspress/src/observability/events.ts`

`PluginEvent` is a `Data.TaggedEnum` with approximately 40 variants organized
across seven subsystems:

| Subsystem | Representative events |
| --------- | --------------------- |
| Lifecycle | `BuildStarted`, `BuildCompleted`, `BuildProgress`, `ApiDocsCompleted`, `PhaseStarted`, `PhaseCompleted`, `SlowOperation` |
| Config parse / merge | `OptionsDecoded`, `DefaultApplied`, `DeprecatedConfigUsed`, `ConfigResolved` |
| Model loading | `ModelLoaded`, `ModelLoadFailed` |
| Type loading / VFS | `VfsGenerated`, `ImportsPrepended`, `TypeRegistryEvent` |
| Multi-entry / routing | `EntryPointResolved`, `RouteCollisionDetected`, `ItemSkipped` (an item no category matched — surfaced per item from the `ApiItems.categorize` `uncategorized` result) |
| Page gen / code blocks | `PageGenerated`, `CodeBlockProcessed`, `TwoslashDiagnostic`, `TwoslashCheckFailed`, `PrettierError`, `ShikiError` |
| Write / snapshot / cleanup | `FileDecision`, `SnapshotUpdated`, `StaleFileRemoved`, `OrphanFileRemoved` |
| LLMs | `LlmsPackageFilesGenerated`, `LlmsGlobalFilesRewritten` |

`levelOf(event)` extracts `event.level`. Every variant carries a `level` field
of type `EventLevel`.

**Known limitation:** `BuildStarted.mode` is always `"prod"` regardless of
whether `rspress dev` or `rspress build` is running.

`BuildProgress` is emitted only by the production-only heartbeat fiber, not by
a build-stage emit site — see `build-progress-and-issues.md`.
`RouteCollisionDetected` is emitted through the shared sync-island bridge
(`emitSync` in `build-stages.ts`, detect-emit-throw at the route-collision
check).
`ModelLoadFailed` no longer rides a sync-island seam: the phase-2 model
redesign made loading Effect-typed (`Model.load` in `@tsdoctor/model`), so
`ConfigServiceLive` emits it via `Effect.tapError` + `Effect.orDie` on the
load pipeline — the former `setModelLoaderEventEmitter` (and the
`setLoaderEventEmitter` companion) are deleted. Both events feed the console
sink and the issues artifact — see `build-progress-and-issues.md`.

---

## Correlation Envelope and Level Ladder

### EventContext

Every event carries an `EventContext` envelope:

```typescript
interface EventContext {
  buildId?: string;
  apiScope?: string;
  packageName?: string;
  version?: string;
  locale?: string;
  entryPoint?: string;
  route?: string;
  file?: string;
  symbol?: string;
}
```

**Every field is optional, `buildId` included, and emit sites do not pass it.**
`emit` fills `ctx.buildId` from the `BuildId` `Context.Reference`
(`src/BuildEnv.ts`) whenever the caller left it empty; a caller that sets a
non-empty value keeps it, so a test can still emit with an explicit id.

Making it optional was the fix for 24 sites that wrote `ctx: { buildId: "" }` —
22 in `ConfigServiceLive`, where the real value sat three scopes up and was
simply not reached, and every site in `TypeRegistryServiceLive`, where the
layer is module-level and has no build to name. That second group is why a
Reference is the fix and a find-and-replace is not: a Reference reaches code
that no parameter can. A required field callers cannot reach is a field that
gets faked.

Sync-island sites, which have no fiber to read the Reference from, call
`syncBuildId()` (see [Sync-Island Bridge](#sync-island-bridge)).

### Level Ladder

```text
none  — no console output
error (rank 0) — fatal and non-recoverable failures
warn  (rank 1) — degraded output, recoverable errors
info  (rank 2) — per-file and phase milestones
debug (rank 3) — all events with full payloads; activates JSON console mode
trace (rank 4) — fine-grained internals (e.g. TwoslashCheckFailed env snapshots)
```

`LEVEL_RANK` maps each level to its numeric rank. A sink with `minLevel: "info"`
admits events ranked 0–2 — lower rank means higher severity and always emitted.

`verbose` is accepted as a config input value and normalized to `debug` by
`resolveObservability`; it is not a valid `EventLevel`.

---

## Five Sinks

All five implement `EventSink` (`platforms/rspress/src/observability/sinks/types.ts`):

```typescript
interface EventSink {
  readonly minLevel: EventLevel;
  readonly handle: (event: PluginEvent) => void;
  /**
   * When true, this sink serializes event payloads. Only payload-capturing
   * sinks drive the `wantsLevel` hint (see makeShape above). Scalar-only
   * sinks (metrics) omit the field.
   */
  readonly capturesPayload?: boolean;
}
```

### Console Sink

**Location:** `platforms/rspress/src/observability/sinks/console-sink.ts`

`makeConsoleSink(logLevel, opts)` produces an `EventSink` with `minLevel` set
to the configured `logLevel`. When `logLevel === "none"` the threshold is `-1`
so no event passes.

Mode is selected by the sink's `json` option, which `buildEventBus` passes through as `{ json: obs.json }`. `resolveObservability` derives that flag from the level (`json: level === "debug"`), so in practice `debug` activates JSON mode — but the sink itself is level-agnostic and can be constructed with either mode at any level:

- **Human-readable mode** (default): `[HH:MM:SS] rendered-message`. `render(event)` switches on `_tag` to produce a one-liner per variant; unknown tags fall back to the bare `_tag`.
- **JSON mode** (`json: true`): `console.log(JSON.stringify({ timestamp, ...event }))`. Also sets `capturesPayload: true`.

### Issues Sink

**Location:** `platforms/rspress/src/observability/sinks/issues-sink.ts`

`makeIssuesSink()` returns an `EventSink & { snapshot: () => IssuesSnapshot }`. It accumulates a curated subset of diagnostic events (Twoslash, Prettier, Shiki, config-validation, route-collision, model-load-failure, build-failure) into in-memory `warnings`/`errors`/`suppressed` buckets. Collection is always-on (cheap); only the write to `.api-docs/build/issues.json` is gated by production and happens in `afterBuild`. Full schema, event-to-bucket mapping and the monitor that consumes the artifact are documented in `build-progress-and-issues.md`.

### Trace Sink

**Location:** `platforms/rspress/src/observability/sinks/trace-sink.ts`

`makeTraceSink(tracePath)` returns `EventSink & { flush: () => void }`.

- `minLevel: "trace"`, `capturesPayload: true` — captures every event regardless of console level.
- The trace path is resolved eagerly at plugin-factory time — `resolveObservability` derives `<cwd>/.api-docs/build/trace-<buildId>.jsonl` from `cwd` (known at factory time, unlike the RSPress `outDir`), so `buildEventBus` always constructs the sink with a concrete path and it opens (creates the parent directory, truncates the file) immediately. The path is therefore a required argument.
- The deferred-open mode this sink once supported (construct without a path, bind one later via `setPath`) existed only for the era when the path depended on `outDir`. Nothing called it after that changed, and it has been deleted.
- Calls `appendFileSync` per event (synchronous, nothing buffered).
- `flush()` is a no-op: sync appends mean nothing is held in memory.

The trace sink and console level are **independent**. Running at
`logLevel: "info"` with `trace: true` still writes every event to the JSONL
file; the console shows only `info`-and-above messages. See `build-progress-and-issues.md`
for the `.api-docs/` directory this trace file now lives in, alongside `issues.json`.

### Metrics Sink

**Location:** `platforms/rspress/src/observability/sinks/metrics-sink.ts`

`makeMetricsSink(context)` returns an `EventSink` with `minLevel: "trace"`. It takes the build's `MetricStore.context` (see [Build Metrics](#build-metrics)) and writes through `metric.updateUnsafe(input, context)` rather than `Effect.runSync(Metric.update(...))` — the sink runs on the synchronous EventBus fan-out, outside any fiber, so a bare `runSync` would resolve the `MetricRegistry` Reference default and write to a different registry than the one `logBuildSummary` and `Metric.snapshot` read through `metrics.layer`. The fan-out itself is still synchronous, so metric counts are exact when `logBuildSummary` reads them.

| Event | Metric(s) updated |
| ----- | ----------------- |
| `FileDecision` | `filesTotal`, `filesNew` / `filesModified` / `filesUnchanged` |
| `PageGenerated` | `pagesGenerated` |
| `ApiDocsCompleted` | `apisCompleted` |
| `TwoslashDiagnostic` | `twoslashDiagnostics`, `twoslashErrors` |
| `PrettierError` | `prettierErrors` |
| `ShikiError` | `shikiErrors` |
| `CodeBlockProcessed` | `codeblockTotal`, `codeblockDuration`, `codeblockTimeMs`, `codeblockTwoslashMs`, `codeblockShikiMs`, `codeblockTwoslashTotal`, `codeblockShikiDuration` (if `shikiMs > 0`), `codeblockSlow` |
| `VfsGenerated` | `vfsFiles` |
| `ImportsPrepended` | `importsPrepended` |
| `PhaseCompleted` | `phaseDuration`, `phaseTimeMs` |
| `DefaultApplied` | `configDefaultsApplied` |

Every mapped event still updates the plain counter/histogram the summary reads for build-wide totals. `FileDecision`, `TwoslashDiagnostic`, `PrettierError`, `ShikiError`, `CodeBlockProcessed` and `PhaseCompleted` additionally record a `Metric.withAttributes` copy tagged with bounded dimensions (scope, status, component, TS code, phase) — `ShikiError` used to hit the sink's `default` branch and reach no metric at all. The dimensional recording pattern, the full attribute set per metric and the reader (`metric-report.ts`) that breaks a series down are documented in `render-phase-instrumentation.md`; this table stays the map of event to metric NAME. Any other tag not listed here hits the `default` branch and is silently ignored.

**Not event-derived:** `externalPackagesTotal` and `apiVersionsLoaded` remain
inline `Metric.update` calls in `ConfigServiceLive`. The only candidate
event (`TypeRegistryEvent{BatchComplete}`) carries a `loaded` (succeeded) count,
not a configured count — deriving it here would change the metric's semantics.
`apisCompleted`, by contrast, IS event-derived: `plugin.ts` emits an
`ApiDocsCompleted` event via `Effect.tap` on each `generateApiDocs` result
inside the `Effect.forEach` over `apiConfigs`, and the metrics sink maps it to
`apisCompleted`. The heartbeat reads that counter for the generate-phase
denominator — see `build-progress-and-issues.md`.

### Render Sink

**Location:** `platforms/rspress/src/observability/sinks/render-sink.ts`

`makeRenderSink()` returns an `EventSink & { snapshot: () => RenderPhaseSamples }` with `minLevel: "trace"`. It holds the render-phase data that is sample-shaped rather than metric-shaped: per-file rollups keyed by `ctx.file`, the slowest 25 code blocks, and the wall-clock window from the first code-block event to the last (used as a cross-check against the summed per-block spans). File paths are an unbounded dimension — one metric series per page would grow the registry with the site — which is the line between what belongs here and what belongs in the Metrics Sink above. Production builds write its snapshot to `.api-docs/build/render-phase.json`. Full mechanism, the additivity cross-check and the measured data are in `render-phase-instrumentation.md`.

---

## Progress Heartbeat

A production-only `forkScoped` fiber (`runHeartbeat`, `platforms/rspress/src/observability/heartbeat.ts`) emits a `BuildProgress` event on a timer so a long, silent build (many APIs, network fetches, hundreds of pages) does not read as hung. It rides the same EventBus as every other event — the console sink renders it via `formatProgress`, the trace sink records it, and the metrics sink ignores it. Full mechanism, configuration (`observability.progressInterval`) and rendered line format are documented in `build-progress-and-issues.md`.

The heartbeat only covers the `config()` doc-generation phase (`resolve` + `generate`) — it does not run during RSPress's own render pass, where Twoslash type-checking of code blocks is often the dominant cost on a large site. See the Known Limitations section of `build-progress-and-issues.md`.

---

## Span Substrate

**Location:** `platforms/rspress/src/observability/spans.ts`

Two helpers wrap Effects in `Effect.withSpan` and emit timing events:

### `withPhase(phase, ctx, effect)`

Emits `PhaseStarted` before and `PhaseCompleted` after. Measures wall-clock
duration. If duration exceeds the threshold for that phase, also emits
`SlowOperation`. **Thresholds are read from the `Thresholds`
`Context.Reference`, not taken as a parameter** — the value used to travel
`plugin.ts` → `ConfigServiceLive`'s fourth constructor argument → a
`ResolvedBuildContext` field → a destructure in `build-program.ts` → every call
site, while `obs.thresholds` held the same value one scope from where it
started. Phase names map to threshold keys via `PHASE_THRESHOLD_KEY`:

| Phase | Threshold key |
| ----- | ------------- |
| `"modelLoad"`, `"resolve"` | `slowApiLoad` |
| `"generate"` | `slowPageGeneration` |
| `"write"` | `slowFileOperation` |
| `"cleanup"` | `slowDbOperation` |

### `withOp(operation, ctx, effect, thresholdKey?)`

No phase events — emits `SlowOperation` only if the duration exceeds the named
threshold. Takes a **key** into `Thresholds` (default `"slowApiLoad"`) rather
than a number, and reads the value from the Reference. Used for sub-operation
timing inside a phase.

Both helpers call `Effect.withSpan`, which creates OpenTelemetry-compatible
spans in the Effect fiber context. **No OTLP exporter is wired in the live
plugin.** The spans are a dormant seam for future integration.

---

## Build Metrics

**Location:** `platforms/rspress/src/layers/build-metrics.ts`

`BuildMetrics` is extracted from `ObservabilityLive.ts` into its own module to
avoid circular imports between the metrics sink and the layer that assembles
sinks. It provides Effect `Metric.counter` and `Metric.histogram` instances.

Under Effect v4 the `MetricBoundaries` module is gone — histogram boundaries
are passed inline as an options object:

```typescript
codeblockDuration: Metric.histogram("codeblock.duration", {
  boundaries: [10, 25, 50, 100, 200, 500, 1000],
}),
```

Updates use `Metric.update(metric, n)` (v3's `Metric.increment` /
`Metric.incrementBy` are gone). The counter and histogram state shapes read by
`logBuildSummary` via `Metric.value` are unchanged.

### Metric registry isolation

`makeMetricStore()` gives each build its own `Metric.MetricRegistry` rather than relying on the process-wide default the `Context.Reference` falls back to — without it, dev-mode HMR rebuilds and same-process test runs would accumulate into one shared registry. It returns a `MetricStore` carrying both forms its two consumers need: `layer`, which Effect programs (`logBuildSummary`, `Metric.snapshot`) read through, and `context`, which the metrics sink writes through directly (see [Metrics Sink](#metrics-sink)). Both MUST be wired together — a caller that puts `metrics.layer` in the runtime but not `metrics.context` into the sink (or vice versa) silently reads and writes two different registries. The same requirement now spans **two** runtimes: `metrics.layer` is merged into the main runtime's `BaseLayer` **and** into the sync-emitter runtime, shared **by reference**, which is what keeps the sink's writes and `logBuildSummary`'s reads in one registry (see `build-architecture.md`). The isolation has a real limit — it does not cover undimensioned metrics — documented in full in `render-phase-instrumentation.md`.

### Summary logger layer

`makeSummaryLoggerLayer(logLevel)` builds the slim Effect Logger that gates
residual `Effect.log*` calls. In v4 this is
`Layer.mergeAll(Logger.layer([pluginLogger]), Layer.succeed(References.MinimumLogLevel, effectLevel))`
— `Logger.minimumLogLevel` is replaced by setting the `References.MinimumLogLevel`
reference. v4's `LogLevel` is a plain string union (`"None" | "Error" | "Warn" |
"Info" | "Debug" | ...`; note `"Warn"`, not v3's `"Warning"`), and the logger
receives its `message` as an **args array**, which `pluginLogger` joins before
formatting.

---

## Build Summary

**Location:** `platforms/rspress/src/layers/ObservabilityLive.ts`

`logBuildSummary` is an Effect program that reads all metric snapshots and logs
a human-readable summary. It is called once in `afterBuild` (skipped on HMR
rebuilds). The summary covers file counts (new/modified/unchanged), pages and
external packages, phase timing, slow code blocks, and Twoslash/Prettier error
totals.

`buildEventBus(obs)` composes sinks into a layer:

```typescript
function buildEventBus(obs: ResolvedObservability): BuiltSinks {
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
```

`obs.tracePath` is always resolved eagerly (see [Trace Sink](#trace-sink)), so there is no deferred-path parameter to thread through.

`BuiltSinks.trace` is retained at the plugin level so `afterBuild` can call
`trace.flush()` before disposing the runtime. `BuiltSinks.issues` is retained
so `afterBuild` (and the `config()` catch block, on a fatal build) can read
`issues.snapshot()` and write `.api-docs/build/issues.json` — see
`build-progress-and-issues.md`. `BuiltSinks.render` and `BuiltSinks.metrics` exist for the same reason: `afterBuild` reads `render.snapshot()` plus `Metric.snapshot` through `metrics.layer` to build the per-scope/per-block report and write `.api-docs/build/render-phase.json` — see `render-phase-instrumentation.md`. `metrics.layer` MUST be part of the `ManagedRuntime`'s layer stack, or `logBuildSummary` reads a different registry than the one the sink wrote through.

---

## Sync-Island Bridge

**Location:** `platforms/rspress/src/observability/sync-emitter.ts`

Seven modules run outside any Effect fiber — remark visitors, Shiki's
`preprocess` hook, Prettier callbacks, the page-generation stages — and each
carried its own byte-identical copy of the seam: a module-level `emitEvent`, a
module-level `currentBuildId`, and a `setXEventEmitter(fn, buildId)` for
`plugin.ts` to call. Two had already grown a third parameter for
`slowCodeBlockMs`, which is how a duplicated seam decays: the copies stop being
identical one caller at a time.

The seam is **forced**; the duplication was not. All seven collapsed into one
module:

```typescript
installSyncEmitter(runtime);              // once, in plugin.ts
emitSync(event);                          // from any sync island
syncBuildId();                            // the build id, for an EventContext
syncSlowCodeBlockMs();                    // the one config value a sync site needs
clearSyncEmitter();                       // teardown / tests
installSyncEmitterUnsafe(fn, opts?);      // @internal, for tests without a bus
```

`installSyncEmitter` takes a runtime and nothing else: every value the old
setters carried is now a `Context.Reference`, read **once** at install time
rather than per emit (an emit happens per code block on a large site, and these
values are fixed for the build). The seven `setXEventEmitter` exports and their
seven wiring calls in `plugin.ts` are deleted.

**The runtime handed to `installSyncEmitter` must be synchronously buildable.**
`runSync` builds the runtime's layer before running anything, so a runtime whose
layer opens a database fails with `AsyncFiberError` at the first emit — from a
remark plugin, during RSPress's render pass, invisible to every unit test. That
is exactly why `plugin.ts` builds a second, observability-only `ManagedRuntime`
for this; see the two-runtimes section of `build-architecture.md`.

`makeRuntimeEmitter(runtime)` still exists in `EventBus.ts` as the primitive
(`(event) => runtime.runSync(emit(event))`); `sync-emitter.ts` is the one
consumer.

`ModelLoadFailed` does not ride this bridge: model loading is Effect-typed
(`Model.load`), so `ConfigServiceLive` emits it via `Effect.tapError` inside the
pipeline. The former `setModelLoaderEventEmitter` / `setLoaderEventEmitter`
seams are deleted. See `build-progress-and-issues.md`.

---

## File Locations

| File | Purpose |
| ---- | ------- |
| `src/observability/events.ts` | `PluginEvent` taggedEnum, `EventLevel`, `LEVEL_RANK`, `EventContext`, `levelOf` |
| `src/observability/EventBus.ts` | `EventBus` tag, `makeShape`, `makeEventBusLayer`, `emit`, `wantsLevel`, `makeRuntimeEmitter` |
| `src/observability/sinks/types.ts` | `EventSink` interface |
| `src/observability/sinks/console-sink.ts` | Level-filtered console output (human-readable or JSON) |
| `src/observability/sinks/trace-sink.ts` | Full-fidelity JSONL file sink |
| `src/observability/sinks/metrics-sink.ts` | Event-to-BuildMetrics translation, dimensioned via `Metric.withAttributes` |
| `src/observability/sinks/render-sink.ts` | Sample-shaped render-phase data (per file, slowest blocks) — see `render-phase-instrumentation.md` |
| `src/observability/metric-report.ts` | `seriesFor`, `codeBlockReport` over `Metric.snapshot` — see `render-phase-instrumentation.md` |
| `src/observability/sinks/issues-sink.ts` | Issues collector sink, `eventToIssue`, `writeIssuesJson` — see `build-progress-and-issues.md` |
| `src/observability/heartbeat.ts` | Progress heartbeat fiber, `BuildProgress` event builder, `formatProgress` — see `build-progress-and-issues.md` |
| `src/observability/spans.ts` | `withPhase`, `withOp`, `PHASE_THRESHOLD_KEY` (thresholds read from the `Thresholds` Reference) |
| `src/observability/sync-emitter.ts` | The one sync-island bridge: `installSyncEmitter`, `emitSync`, `syncBuildId`, `syncSlowCodeBlockMs` |
| `src/BuildEnv.ts` | `BuildId`, `Thresholds`, `PageConcurrency`, `SuppressExampleErrors` References |
| `src/layers/build-metrics.ts` | `BuildMetrics` counters and histograms, `MetricStore`/`makeMetricStore` |
| `src/layers/ObservabilityLive.ts` | `buildEventBus`, `BuiltSinks`, `logBuildSummary` |
| `src/schemas/observability.ts` | `ObservabilityConfig`, `ResolvedObservability`, `resolveObservability` |

---

## Related Documentation

- **Build Progress & Issues Artifact:** `build-progress-and-issues.md` — the progress heartbeat (and its known coverage gap), the `.api-docs/build/issues.json` artifact and its monitor
- **Render-Phase Instrumentation:** `render-phase-instrumentation.md` — dimensional metrics and the render sink in full: measurement technique, the additivity cross-check, the `.api-docs/build/render-phase.json` artifact and the measured data
- **Error Observability:** `error-observability.md` — how Twoslash and Prettier errors flow through the bus
- **Build Architecture:** `build-architecture.md` — plugin structure and service layer
- **Snapshot Tracking System:** `snapshot-tracking-system.md` — `FileDecision` events and file-write metrics
