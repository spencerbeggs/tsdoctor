---
type: Decision
status: stable
title: One layer-construction call produces both ManagedRuntimes
description: makeAppLayers returns { app, emitter } from a single call so metrics.layer and the BuildEnv references are shared by reference; the emitter stack stays synchronously buildable for the sync-island bridge.
tags: [architecture, observability]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 25271fb34792fa492154135a668941f29136eba1b67f0d95754d796e14660f4b
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# One layer-construction call produces both `ManagedRuntime`s

## Context

The RSPress adapter runs two `ManagedRuntime`s: a main one for the build
program and a second, synchronously buildable one for code that runs
outside any Effect fiber — remark visitors, Shiki's `preprocess` hook,
Prettier callbacks, the page-generation reporting wrapper — collectively
the sync-island bridge (`platforms/rspress/src/observability/sync-emitter.ts`[^1]).
The main runtime's layer opens two SQLite databases at construction time
(the snapshot store and the Twoslash result cache), which makes it
asynchronous to build. `ManagedRuntime#runSync` builds a runtime's layer
before running anything, so calling it against the main runtime from a
synchronous callback fails with `AsyncFiberError`[^1] — invisible to unit
tests, because nothing exercises the real render pass where a remark
plugin invokes it. Both runtimes also need to share state by reference: a
split `Metric.MetricRegistry` reports every count as zero from whichever
half did not receive the writes, and a split `BuildId` mislabels every
event the sync island emits with the wrong build.

## Decision

`makeAppLayers(input)` in `platforms/rspress/src/layers/AppLayer.ts`[^2]
takes one `MetricStore` input and returns both stacks from a single call:
`{ app, emitter }`. `app` is `ConfigService.layer` over a tiered merge of
platform, observability, core and build-scoped layers, including
`SnapshotService.layer(dbPath)` and `TwoslashCacheService.layer` — the two
members that acquire their stack at construction and therefore make `app`
asynchronous. `emitter` is `mergeAll(ObservabilityLayer, BuildEnvLayer)`,
built entirely from `Layer.succeed`, and is therefore synchronously
buildable with `runSync`. `platforms/rspress/src/BuildEnv.ts`[^3] holds
the per-build `Context.Reference`s both stacks read — `BuildId`,
`Thresholds`, `PageConcurrency`, `SuppressExampleErrors` — each carrying a
default, reserved for values where the default is merely conservative
rather than silently wrong; `PluginConfig` stays a `Context.Service`
instead, because there is no sensible default for "which APIs is this
site documenting" and forgetting to provide it must fail loudly rather
than succeed with an empty answer.

## Alternatives rejected

- **Build the two `ManagedRuntime`s from two separate calls, each
  constructing its own `MetricStore` and `BuildEnv` values.** Rejected:
  the shared-by-reference invariant between the runtimes cannot be
  enforced by a comment telling two call sites to pass matching inputs;
  making it the type of one call — one `MetricStore` in, both stacks out
  — makes constructing them from different inputs structurally
  impossible.
- **Merge the two runtimes back into one.** Rejected: an event emitter
  has no business forcing a database open, and the split states that as
  an invariant rather than an accident. Moving the sync-island service to
  the main runtime reintroduces the `AsyncFiberError` failure mode; the
  layer that opens SQLite databases cannot also be the layer a sync
  callback builds.
- **Give every per-build value a `Context.Reference` default, including
  `PluginConfig`.** Rejected: a `Context.Reference` succeeds quietly with
  its default on a wiring mistake, which is correct for a conservative
  default like page concurrency but would be silently wrong for "which
  API is this site documenting" — that case must fail as a loud
  "service not provided."

## Consequences

- A future change that needs the two runtimes to diverge — different
  metric registries, different build ids — cannot be expressed as two
  arguments to `makeAppLayers`; it requires deliberately breaking the
  one-call contract, which is the friction the decision is designed to
  produce.
- Every sync-island call site reads its per-build values once, at
  `installSyncEmitter` time, rather than per emit, because an emit can
  happen once per code block on a large site and re-reading a
  `Context.Reference` per emit would be wasted work at that frequency.
- `AppLayers.app`'s error channel is not `never`: `SnapshotService.layer`
  can fail with `StoreError | StoreMigrationError`, surfacing when the
  `ManagedRuntime` first builds, so a corrupt snapshot database stops the
  build loudly rather than degrading like the two cache layers (see
  [caches-degrade-snapshot-store-fails.md](caches-degrade-snapshot-store-fails.md)).

[^1]: [platforms/rspress/src/observability/sync-emitter.ts](../../platforms/rspress/src/observability/sync-emitter.ts)
[^2]: [platforms/rspress/src/layers/AppLayer.ts](../../platforms/rspress/src/layers/AppLayer.ts)
[^3]: [platforms/rspress/src/BuildEnv.ts](../../platforms/rspress/src/BuildEnv.ts)
