---
type: Convention
title: Report through events, not logs or direct metrics
description: Every build diagnostic is a typed PluginEvent through the event bus, never a console.log or a direct metric increment.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 4e312ed02271b672c826784a0005995e9ae3cb5d6da8f6dcf9b7561695b4f45f
stale_after: 2026-12-12T00:00:00Z
tags: [observability, dx]
sources:
  - id: events
    resource: ../../platforms/rspress/src/observability/events.ts
  - id: event-bus
    resource: ../../platforms/rspress/src/observability/EventBus.ts
  - id: sync-emitter
    resource: ../../platforms/rspress/src/observability/sync-emitter.ts
  - id: metrics-sink
    resource: ../../platforms/rspress/src/observability/sinks/metrics-sink.ts
  - id: render-sink
    resource: ../../platforms/rspress/src/observability/sinks/render-sink.ts
---

# Report through events, not logs or direct metrics

Report every build-time diagnostic as a `PluginEvent` variant through the
event bus (`platforms/rspress/src/observability/events.ts`, emitted via
`EventBus.emit` / `emitSync`), never as a direct `Metric.update` call at the
call site and never as a bare `console.log`. One emit fans out to the
console sink, the metrics sink, the issues sink and the trace sink at once;
an increment or a log line feeds only one of those.

## Rules

- **Delete a variant that has no emit site.** A taxonomy entry the code
  cannot produce is a promise the trace and the `issues.json` artifact
  cannot keep — do not keep a `PluginEvent` case "for later".
- **Never pass `buildId` at an emit site.** `EventBus.emit` fills
  `ctx.buildId` from the `BuildId` `Context.Reference` whenever the caller
  left it empty; a caller that sets a non-empty value keeps it, so tests can
  still override it, but ordinary emit sites should not.
- **From synchronous, fiber-less code, reach the bus only through
  `observability/sync-emitter.ts`** (`emitSync`, `syncBuildId`,
  `syncSlowCodeBlockMs`) — never build a second `emit`-plus-`currentBuildId`
  seam. Remark visitors, Shiki's `preprocess` hook and Prettier callbacks all
  run outside any Effect fiber and must go through this one bridge.
- **The runtime handed to `installSyncEmitter` must be synchronously
  buildable.** `runSync` builds the runtime's layer before running anything;
  a runtime whose layer opens a database (the main runtime) fails with
  `AsyncFiberError` at the first emit, invisible to unit tests because it
  only fires during RSPress's render pass.
- **Bounded dimensions are metric attributes; unbounded ones are render-sink
  samples.** Scope, component name, whether Twoslash ran, phase name and a
  TS diagnostic code are bounded and belong on a `Metric.withAttributes`
  copy in `metrics-sink.ts`. File paths are unbounded — one series per page
  would grow the metrics registry with the site — so per-file totals and the
  slowest blocks stay sample-shaped in `render-sink.ts` instead.
- **Code-block errors (Twoslash, Prettier, Shiki) are non-fatal.** They
  degrade the affected block and continue the build; they must never throw
  out of the reporting path.
- **`Effect.log*` is not a reporting channel.** It is gated by the summary
  logger (`Logger.layer` plus the resolved minimum log level) for residual
  framework-level logging only, not for anything a maintainer needs to act
  on — that always goes through a `PluginEvent`.

## Why

The same event must feed a human-readable console line, a counter or
histogram, a durable `issues.json` entry and an opt-in full-fidelity trace.
A `console.log` or an inline metric increment satisfies exactly one of those
consumers and leaves the other three blind to that diagnostic. The
sync-island bridge exists because several call sites — Shiki's synchronous
`preprocess`, remark's synchronous visitors — run entirely outside any
Effect fiber; before it existed, seven modules each carried a byte-identical
copy of "a module-level emit function plus a module-level build id," and the
copies had already started drifting one parameter at a time. Splitting
bounded from unbounded dimensions keeps the metrics registry from growing
without bound on a large multi-page site while still answering "which file
was slowest."

## How to check

- `grep -n "console\.\(log\|warn\|error\)" platforms/rspress/src/**/*.ts`
  outside `console-sink.ts` should turn up nothing from a reporting path.
- Every `PluginEvent` case in `events.ts` has at least one emit site — search
  for the variant's constructor name across `platforms/rspress/src/`.
- A sync-island call site imports only from
  `observability/sync-emitter.ts`, never constructs its own module-level
  emit/build-id pair.
- A newly added dimension: if its cardinality scales with the number of
  pages or files in a site, it belongs in `render-sink.ts`; if it is drawn
  from a small closed set (scope names, component names, TS codes), it
  belongs as a `Metric.withAttributes` tag in `metrics-sink.ts`.
