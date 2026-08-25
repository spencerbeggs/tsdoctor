# platforms/rspress/CLAUDE.services.md

Deep dive on the adapter's Effect service layer, the two runtimes and the
observability event bus. Loaded from `platforms/rspress/CLAUDE.md`.

## Effect Service Layer

The plugin runs on **Effect v4** (`effect@4.0.0-rc.109`, pinned via `catalog:effect`). `plugin.ts` is a thin RSPress adapter (~570 lines); it no longer composes the layer stack itself. `makeAppLayers(input)` (`src/layers/AppLayer.ts`) returns **both** stacks — `app` (the main runtime's) and `emitter` (the sync-island one's) — from one call, deliberately: the two-runtime invariants (one `metrics.layer`, one `BuildEnv` reference set, shared by reference) are then impossible to violate by construction rather than merely discouraged by comment. It is a factory: call it once and bind the result to a `const`.

`makeAppLayers` tiers the stack by what each tier may reach — platform, then core services that need only the platform, then build-scoped services:

- `ConfigService.layer` — config resolution over `PluginConfig` + the RSPress
  config; `resolve()` returns `ReadonlyArray<ResolvedApiConfig>` (the 16-field
  `ResolvedBuildContext` is deleted). Zero-argument, so "call it twice" is a
  type error. Implementation: `makeConfigService` in
  `layers/config-resolution.ts`.
- `PluginConfig` — `Layer.succeed` over the decoded `PluginOptions`. A service,
  not a Reference, because "which APIs?" has no safe default.
- `HighlighterService.layer(themes)` — the build's one Shiki highlighter,
  acquired/released at runtime lifetime. A factory (takes themes), so bind its
  result to a `const` before merging.
- `TwoslashEnvironments.layer` — per-compiler-config Twoslash environments and
  transformers, replacing the old `TwoslashManager` singleton
- `OgService.layer` — Open Graph image resolution with a typed `OgImageError`;
  needs `FileSystem`/`Path`, so it is provided `PlatformLive` locally
- `SnapshotService.layer(dbPath)` — from `@tsdoctor/snapshot`; SQLite via
  `@effected/store`'s `Store.layerSqlite` (migrations applied at layer
  construction, WAL checkpoint via `checkpointOnClose`). Its error channel is
  NOT erased: a corrupt snapshot DB should stop the build loudly.
- `TypeRegistryService.layer` — external package type loading; edge-composes the
  `@tsdoctor/registry` stack itself (the library ships no platform layer)
- `TwoslashCacheService.layer` — persists Twoslash results between builds in an
  XDG sqlite `@effected/store` Cache; a hit skips the type-check entirely, which
  is ~97% of render-phase code-block time (`render-phase-instrumentation.md`)
- `EventBus` layer (from `buildEventBus`) — synchronous fan-out event bus
  wiring console, metrics, issues, render, and optional JSONL trace sinks
- `NodeFileSystem.layer` (`@effect/platform-node`) — Node implementation of the
  core `effect` FileSystem service

Every service owns its layer as a **static on the service class**, matching the
core packages. The `layers/*ServiceLive.ts` modules are gone — do not add one
back; add the static instead.

**Defer any static that names a binding declared below it.** A static
initializer runs while the module body is still evaluating, so reading such a
`const` eagerly throws AT IMPORT TIME while typechecking perfectly clean — and
the only symptom is vitest reporting "0 tests passed" with exit 0. The forms in
use are `Layer.suspend(() => ...)` and `Layer.effect(this, Effect.suspend(() => make()))`.

`PathDerivationService` is **deleted** — import the pure functions from
`path-derivation.ts` directly. Both cache-backed layers acquire their stack
at layer construction (never `Effect.provide` inside a method body — v4 forks
a child `MemoMap` and rebuilds) and both `Layer.catchCause` down to a cache
miss: an unreachable cache must never fail a build. They share one platform
and XDG root, `layers/xdg.ts` — do not re-declare the namespace literal.

`ConfigService`, `OgService`, `TwoslashCacheService`, `TypeRegistryService` and
`SnapshotService` ship `makeTest(overrides)` / `layerTest(overrides)` in-memory
doubles; use them instead of hand-writing a stub (the `Mock*Layer` names in
`__test__/utils/layers.ts` are now mostly thin aliases over them).
`ConfigService.resolve` and `OgService.resolveImage` deliberately have **no
default** and throw naming themselves — their natural defaults (an empty array,
`Option.none`) are indistinguishable from a real answer, so a test that forgot
to stub them would pass against a build that documented nothing.

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

`buildEventBus(obs)` (`layers/observability.ts`) composes five sinks:

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
