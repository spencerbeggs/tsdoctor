# platforms/rspress/CLAUDE.services.md

Deep dive on the adapter's Effect service layer, the two runtimes and the
observability event bus. Loaded from `platforms/rspress/CLAUDE.md`.

## Effect Service Layer

The plugin runs on **Effect v4** (`effect@4.0.0-rc.109`, pinned via `catalog:effect`). `plugin.ts` is a thin RSPress adapter (~615 lines) that wires **two** `ManagedRuntime`s (see below) over a composed `Layer` stack:

- `ConfigServiceLive` — a zero-argument module-level **`const`**, not a
  factory. `resolve()` returns `ReadonlyArray<ResolvedApiConfig>`; the
  16-field `ResolvedBuildContext` it used to return is **deleted**. Keep it a
  `const`: layers memoize by reference, so a factory called twice mints two
  `ConfigService`s.
- `PluginConfig` — `Layer.succeed` over the decoded `PluginOptions`. A
  service, not a Reference, because "which APIs?" has no safe default.
- `HighlighterServiceLive(themes)` — the build's one Shiki highlighter,
  acquired/released at runtime lifetime. Still a factory (takes themes), so
  bind its result to a `const` before merging.
- `TwoslashEnvironmentsLive` — per-compiler-config Twoslash environments and
  transformers, replacing the old `TwoslashManager` singleton
- `OgServiceLive` — Open Graph image resolution with a typed `OgImageError`
- `SnapshotServiceLive` — from `@tsdoctor/snapshot`; SQLite via
  `@effected/store`'s `Store.layerSqlite` (migrations applied at layer
  construction, WAL checkpoint via `checkpointOnClose`)
- `TypeRegistryServiceLive` — external package type loading; edge-composes the
  `@tsdoctor/registry` stack itself (the library ships no platform layer)
- `TwoslashCacheServiceLive` — persists Twoslash results between builds in an
  XDG sqlite `@effected/store` Cache; a hit skips the type-check entirely, which
  is ~97% of render-phase code-block time (`render-phase-instrumentation.md`)
- `EventBus` layer (from `buildEventBus`) — synchronous fan-out event bus
  wiring console, metrics, issues, render, and optional JSONL trace sinks
- `NodeFileSystem.layer` (`@effect/platform-node`) — Node implementation of the
  core `effect` FileSystem service

`PathDerivationService` is **deleted** — import the pure functions from
`path-derivation.ts` directly. Both cache-backed layers acquire their stack
at layer construction (never `Effect.provide` inside a method body — v4 forks
a child `MemoMap` and rebuilds) and both `Layer.catchCause` down to a cache
miss: an unreachable cache must never fail a build. They share one platform
and XDG root, `layers/xdg.ts` — do not re-declare the namespace literal.

## Two runtimes, and per-build References

Per-build values live as `Context.Reference`s in `src/BuildEnv.ts`: `BuildId`,
`Thresholds`, `PageConcurrency`, `SuppressExampleErrors`. A Reference carries
a default, so use one only where the default is conservative, never where it
would be silently wrong.

There are **two** `ManagedRuntime`s and they must not be merged. The main
runtime's layer opens two SQLite databases at construction, so it is
**asynchronous to build** — and `runSync` builds a layer before running, so
sync emitters on it die with `AsyncFiberError` during RSPress's render pass.
The sync-island emitters therefore run on a second runtime over
`Layer.succeed`-only layers. `metricStore.layer` is shared **by reference**
between the two; break that and the build summary silently reads all zeros.

Write v4 idioms: declare service tags as
`Context.Service<Self, Shape>()("id")`; use `Schema.Literals`/`Schema.Union`/
`Schema.Record` with array args, `Schema.withDecodingDefault(Effect.succeed(v))`
for defaults, `typeof X.Type`/`typeof X.Encoded` for extraction,
`Metric.histogram(name, { boundaries })` + `Metric.update`, `Effect.result`
(not `Effect.either`) and `Effect.catch` (not `Effect.catchAll`).

Doc generation runs as a `Stream` pipeline in `build-stages.ts`:
`Stream.fromIterable -> Stream.mapEffect(generateSinglePage) ->
Stream.mapEffect(writeSingleFile) -> Stream.runFold`

## Observability

The plugin emits structured `PluginEvent` values through a **synchronous
fan-out EventBus** (`src/observability/EventBus.ts`) rather than writing
directly to the console or incrementing metrics inline.

`buildEventBus(obs)` (`layers/ObservabilityLive.ts`) composes five sinks:

- **Console sink** — human-readable one-liners (or JSON at `logLevel: "debug"`),
  filtered by the configured level
- **Metrics sink** — translates events to `BuildMetrics` counters/histograms
  against the build's own `MetricStore`; tags scope/component/phase/TS-code
  where a breakdown is worth querying, so `metric-report.ts` can read it back
  from `Metric.snapshot` without a bespoke aggregator
- **Issues sink** — accumulates diagnostic events; written to
  `.api-docs/build/issues.json` on production builds
- **Render sink** — sample-shaped render-phase data (per file, slowest blocks)
  that is unbounded-cardinality and so does not belong in the metric registry;
  written to `.api-docs/build/render-phase.json` on production builds
- **Trace sink** (opt-in) — full-fidelity JSONL under `.api-docs/build/`;
  `minLevel: "trace"`, independent of console level

Remark visitors, Shiki's `preprocess` hook, Prettier callbacks and the page
stages run outside any Effect fiber. They share **one** bridge,
`src/observability/sync-emitter.ts` (`emitSync`, `syncBuildId`,
`syncSlowCodeBlockMs`), installed once by `plugin.ts` via
`installSyncEmitter(emitterRuntime)` against the sync-buildable runtime. The
seven per-module `setXEventEmitter` seams are gone — do not reintroduce one.
`EventContext.buildId` is optional and filled centrally by `emit`; never pass
`""`. The render pass reaches `TwoslashEnvironments` through the same shape of
module-level holder, `src/twoslash-access.ts`, installed from inside a fiber.

OpenTelemetry spans (`Effect.withSpan`) exist in the span substrate
(`src/observability/spans.ts`) but no OTLP exporter is wired. This is a dormant
seam for future integration.

See `performance-observability.md` and `error-observability.md` in the design
docs for the full architecture.
