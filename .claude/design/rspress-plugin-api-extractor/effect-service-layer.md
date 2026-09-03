---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-09-03
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/plugin-lifecycle.md
  - rspress-plugin-api-extractor/configuration-system.md
  - rspress-plugin-api-extractor/build-tooling.md
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
---

# Effect service layer

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Service pattern](#service-pattern)
- [The tiered layer stack](#the-tiered-layer-stack)
- [Two runtimes](#two-runtimes)
- [Per-build references](#per-build-references)
- [Services and their layers](#services-and-their-layers)
- [Test doubles](#test-doubles)
- [Layer acquisition and degradation](#layer-acquisition-and-degradation)
- [Effect v4 and the dependency closure](#effect-v4-and-the-dependency-closure)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

The plugin runs on Effect v4 (`effect@4.0.0-rc.109`, pinned through the `catalog:effect` catalog) and uses the Context/Layer/Service pattern for dependency injection. Every service owns its layer as a static on its class, the whole stack is composed in one place and two `ManagedRuntime`s are built from it — a main one for the build program and a synchronously buildable one for the sync-island event emitters.

## Current state

| Concern | Where it lives |
| --- | --- |
| Service tags, shapes, live layers and test doubles | `src/services/*.ts` (inventory in `platforms/rspress/CLAUDE.services.md`) |
| Stack composition | `src/layers/AppLayer.ts` (`makeAppLayers`) |
| Per-build `Context.Reference`s | `src/BuildEnv.ts` |
| Shared platform and XDG root for the cache-backed layers | `src/layers/xdg.ts` |
| Observability tier (event bus, sinks, logger gate) | `src/layers/observability.ts`, `src/layers/build-metrics.ts` |
| Snapshot service | `@tsdoctor/snapshot` (`packages/snapshot/src/SnapshotService.ts`) |

## Service pattern

A service is `class X extends Context.Service<X, XShape>()("rspress-plugin-api-extractor/X")` with its live layer as a static on the class (`X.layer`), matching the pattern the core packages follow. There are no separate `*ServiceLive.ts` modules; `src/layers/` holds composition, the config-resolution implementation and the shared platform and observability pieces.

A static initializer runs while the module body is still evaluating, so a static that names a `const` declared further down — or a binding imported from a module that imports this one back — throws at import time while typechecking clean. The only symptom is vitest reporting "0 tests passed" with exit code 0. Use `Layer.suspend(() => …)` for a layer composition or `Effect.suspend(() => make())` for an effect body whenever a service's static names something defined after it (`TypeRegistryService.layer`, `TwoslashCacheService.layer`, `ConfigService.layer` and `OgService.layer` all do).

## The tiered layer stack

`makeAppLayers(input)` in `src/layers/AppLayer.ts` returns both runtime stacks from a single call:

```text
plugin.ts
  |
  +-> makeAppLayers({ options, obs, buildId, dbPath, pageConcurrency,
  |                   eventBus, metrics })  ->  { app, emitter }
  |
  |     PlatformLayer      NodeFileSystem.layer (+ layers/xdg.ts PlatformLive
  |     |                  where a service needs FileSystem/Path locally)
  |     ObservabilityLayer eventBus sinks, metrics.layer, the summary logger gate
  |     |
  |     CoreLayer          TypeRegistryService, TwoslashCacheService,
  |     |                  SnapshotService.layer(dbPath), OgService
  |     |                  (own a resource; need only the platform)
  |     BuildLayer         PluginConfig, HighlighterService.layer(themes),
  |     |                  TwoslashEnvironments, BuildEnvLayer
  |     |                  (scoped to this build's configuration)
  |     app     = ConfigService.layer over mergeAll(BuildLayer, CoreLayer,
  |                 ObservabilityLayer, NodeFileSystem.layer)
  |     emitter = mergeAll(ObservabilityLayer, BuildEnvLayer)
  |
  +-> ManagedRuntime.make(appLayers.app)
  +-> ManagedRuntime.make(appLayers.emitter)
```

The tiers are ordered by what they may reach: the platform knows nothing about this plugin, core services know the platform and build-scoped services know both. A flat merge tells you what the build contains but not what depends on what.

Returning both stacks from one call is the point. The two runtimes must share `metrics.layer` and the `BuildEnv` references by reference, and both halves fail silently when they do not: a split metric registry reports every count as zero and a split `BuildId` mislabels every event a sync island emits. One call with one `MetricStore` input makes constructing them from different inputs structurally impossible.

`AppLayers.app`'s error channel is not `never`. `SnapshotService.layer` can fail with `StoreError | StoreMigrationError` when its database cannot be opened or migrated, and that surfaces when the `ManagedRuntime` first builds. A corrupt snapshot DB should stop the build loudly, unlike the two cache layers, which degrade.

## Two runtimes

The main runtime's layer opens two SQLite databases at construction — the snapshot store and the Twoslash result cache — because both cache-backed layers acquire their stack at layer-construction time. That makes `appLayers.app` asynchronous to build, and `runtime.runSync` builds a runtime's layer before running anything, so a sync emit from a remark plugin during RSPress's render pass would die with `AsyncFiberError` — invisible to every unit test.

The sync-island emitters (`observability/sync-emitter.ts`) therefore run on `appLayers.emitter`, whose every member is `Layer.succeed` and therefore synchronously buildable. The split also states an invariant worth keeping: an event emitter has no business forcing a database open. Do not merge the runtimes back into one.

## Per-build references

`src/BuildEnv.ts` holds the values that used to travel by hand as constructor arguments:

| Reference | Default | Read by |
| --- | --- | --- |
| `BuildId` | `""` | `EventBus.emit` (fills `ctx.buildId`), `sync-emitter.ts` |
| `Thresholds` | the `ResolvedObservability` defaults | `withPhase` (`observability/spans.ts`) |
| `PageConcurrency` | `1` (`plugin.ts` provides `os.cpus().length`) | `build-program.ts` |
| `SuppressExampleErrors` | `true` | `build-program.ts` |

A `Context.Reference` carries a default, so a wiring mistake succeeds quietly with the default rather than failing. That is why the decoded plugin options are a `Context.Service` (`services/PluginConfig.ts`) and not a Reference — there is no sensible default for "which APIs is this site documenting", so forgetting to provide it must be a loud "service not provided" — and why the Shiki themes are a layer argument to `HighlighterService.layer` rather than a Reference. Use a Reference only where the default is merely conservative, never where it would be silently wrong.

## Services and their layers

| Service | Module | Layer | Key dependencies |
| --- | --- | --- | --- |
| `ConfigService` | `services/ConfigService.ts` | `ConfigService.layer` | `TypeRegistryService`, `PluginConfig` |
| `PluginConfig` | `services/PluginConfig.ts` | `Layer.succeed` in `AppLayer.ts` | none |
| `HighlighterService` | `services/HighlighterService.ts` | `HighlighterService.layer(themes)` | none (`Effect.acquireRelease` over `createHighlighter`) |
| `TwoslashEnvironments` | `services/TwoslashEnvironments.ts` | `TwoslashEnvironments.layer` | none |
| `OgService` | `services/OgService.ts` | `OgService.layer` | `FileSystem`, `Path` |
| `TwoslashCacheService` | `services/TwoslashCacheService.ts` | `TwoslashCacheService.layer` | `@effected/store` `Cache`, `layers/xdg.ts` |
| `TypeRegistryService` | `services/TypeRegistryService.ts` | `TypeRegistryService.layer` | `@tsdoctor/registry`, `@effected/store`, `layers/xdg.ts` |
| `SnapshotService` | `@tsdoctor/snapshot` | `SnapshotService.layer(dbPath)` | `@effected/store` (`Store.layerSqlite`) |
| `EventBus` | `observability/EventBus.ts` | `buildEventBus` (`layers/observability.ts`) | the synchronous fan-out sinks |

`ConfigService.layer` is a zero-argument static, not a layer-returning factory. Layers memoize by reference, so a factory called twice mints two layers, the second capturing its own `TypeRegistry`; a plain static turns "call it twice" into a type error. `HighlighterService.layer(themes)` and `SnapshotService.layer(dbPath)` remain factories, which is why `AppLayer.ts` binds each result to a `const` before merging — a second call would acquire a second highlighter or open the database twice.

Both cache-backed layers share one platform and XDG root, `src/layers/xdg.ts` (`TSDOCTOR_NAMESPACE`, `PlatformLive`, `AppDirsLive`). Two distinct layer references build twice, and a drifted namespace literal is permanent and silent: the caches move directory, every lookup misses and a build that should hit a warm Twoslash cache goes cold forever with nothing in the output to notice. The VitePress adapter's `src/Registry.ts` spells the same namespace, so the hazard spans two packages (`tsdoctor-package-architecture.md`).

## Test doubles

`ConfigService`, `OgService`, `TwoslashCacheService`, `TypeRegistryService` and `SnapshotService` each ship `makeTest(overrides)` and `layerTest(overrides)` beside their live layer. Each member defaults to the shape a build takes when nothing is configured — every snapshot lookup misses, every spec resolves unchanged, the Twoslash cache is cold — so a test overrides only the member it exercises.

Two members deliberately have no default and throw naming themselves: `ConfigService.resolve` and `OgService.resolveImage`. Their natural defaults (an empty array, `Option.none`) are indistinguishable from a real answer — an empty array is exactly what an inert plugin produces — so a test that forgot to stub them would assert against a build that generated nothing and pass.

## Layer acquisition and degradation

`TypeRegistryService.layer` and `TwoslashCacheService.layer` acquire their stacks once at `ManagedRuntime` construction rather than inside each method body. In Effect v4 `provideLayer` is a `scopedWith` over `buildWithScope` that forks a child `MemoMap` whose parent never built the layer, so per-method provision built and tore down the registry stack and the Twoslash cache twice per build.

Both cache-backed layers must degrade to a cache miss rather than fail — an unreachable or corrupt cache must not break a build that would otherwise succeed. Degrading is `@effected/store`'s `Cache.degrading`, not a hand-written `Layer.catchCause`: `catchCause` absorbs every cause, interruption included, so a fiber being interrupted during shutdown was handed a working degraded cache and carried on. Degrading at the `Cache` also means the ordinary implementation over an always-missing cache is the degraded behaviour, so there is no second implementation to keep in step. `TypeRegistryService` keeps a hand-written catch because its construction can fail outside the cache (no HOME for XDG, an unwritable metadata DB), and that catch re-raises interruption, rebuilding the cause from `Cause.interruptors` so the recorded interruptor is the original fiber.

`CacheShape.degraded` is surfaced on `TwoslashCacheServiceShape`. A degraded cache and a genuinely cold one behave identically at every lookup, so without the flag the build summary reports an unusable cache as merely cold.

`SnapshotService.layer` is the deliberate counter-example: its failure stays in the channel and stops the build (`snapshot-tracking-system.md`).

## Effect v4 and the dependency closure

Two v3 packages are gone because their contents merged into the `effect` core: `@effect/platform` (FileSystem is now the top-level `effect` `FileSystem` module) and `@effect/sql` (now `effect/unstable/sql`). `@effect/platform-node` remains as the node-platform package.

Because the per-file plugin build leaves `dependencies` external, any unclosed non-optional peer escapes to the consuming workspace, where pnpm `autoInstallPeers` can bind it unpredictably. The closure therefore lives in the plugin's `dependencies` block (only `@rspress/core`, `react` and `react-dom` remain peers): `ioredis` (a non-optional peer of `@effect/platform-node`), the full `@effected/*` surface the seven `@tsdoctor/*` workspaces ride on (each declared as `catalog:effected`) and the seven core workspaces themselves. Do not prune closure entries as "unused" — some are imported directly (`services/TypeRegistryService.ts`, `sync-node-fs.ts`, `twoslash-transformer.ts`) and the rest exist to keep the graph closed. See `platforms/rspress/package.json` for the current list.

`mdast-util-from-markdown` is a dev dependency only: `twoslash-transformer.ts` parses through `@effected/markdown`'s `Markdown.parseResult` with `dialect: "commonmark"` (the kit defaults to GFM, and adopting GFM would be a product change). `mdast-util-to-hast` stays a runtime dependency because `@effected/markdown` puts markdown-to-HTML permanently out of scope.

Call-site idioms that recur throughout the source:

| Concern | v4 form |
| --- | --- |
| Service tags | `Context.Service<Self, Shape>()("id")` |
| Schema literals, unions, records | `Schema.Literals([...])`, `Schema.Union([a, b])`, `Schema.Record(key, value)` |
| Schema defaults | `X.pipe(Schema.withDecodingDefault(Effect.succeed(v)))` |
| Schema type extraction | `typeof X.Type` / `typeof X.Encoded` |
| Metrics | `Metric.histogram(name, { boundaries })`; `Metric.update(m, n)` |
| Error channel inspection | `Effect.result` yielding a `Result` |
| Error recovery | `Effect.catch` |

`Schema.mutable` is restricted to array schemas in v4. `Data.TaggedError` and `Data.taggedEnum` are unchanged, so `errors.ts` and `observability/events.ts` use them as before.

## Rationale

- **Why services own their layers:** one place to read a service's contract and its construction, and the same shape the core packages use, so a reader moving between workspaces meets one pattern.
- **Why both runtime stacks come from one call:** the shared-by-reference invariant between them cannot be enforced by a comment; making it the type of the call is what makes the split runtimes safe.
- **Why the caches degrade and the snapshot store does not:** a cache miss costs time, while a silently regenerated snapshot corrupts incremental correctness. The failure posture follows what the loss would cost.
- **Why references only for conservative defaults:** a Reference can reach code that no parameter can (module-level layers with no build to name), which is exactly what makes a silently wrong default dangerous.

## Related documentation

- **Build architecture overview:** `build-architecture.md`
- **Plugin lifecycle:** `plugin-lifecycle.md`
- **Configuration system:** `configuration-system.md`
- **Observability substrate the emitter runtime serves:** `performance-observability.md`
- **Snapshot service:** `snapshot-tracking-system.md`
- **Type registry service:** `type-loading-vfs.md`
