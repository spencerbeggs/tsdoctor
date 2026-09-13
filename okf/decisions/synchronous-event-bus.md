---
type: Decision
status: draft
title: The build event bus fans out synchronously, in-process
description: EventBus.emit fans out inline to every sink so build-end summaries and metrics read exact counts, and one sync-island bridge module reaches it from outside any Effect fiber.
tags: [architecture, observability]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 335f21d3574f8a9804f3679e8607b9d131b7f95a2359f70bd03fcda22b1c8ab0
---

# The build event bus fans out synchronously, in-process

## Context

A production build emits diagnostic and lifecycle events throughout doc
generation — model loading, page generation, Twoslash diagnostics,
snapshot decisions — and several downstream consumers need to read the
same events: a human-readable console line, a `Metric` counter, the
`issues.json` artifact, and an opt-in JSONL trace. `logBuildSummary` reads
`Metric.snapshot` at the end of `afterBuild` to print the build summary,
so whatever emits events must have finished updating every counter by the
time that read happens. Several modules that need to emit — remark
visitors, Shiki's `preprocess` hook, Prettier callbacks — run entirely
outside any Effect fiber, so no `Effect.gen` context is available at the
emit site.

## Decision

`EventBus.emit` (`platforms/rspress/src/observability/EventBus.ts:22`) fans
out to every registered sink inline and synchronously: by the time the
emitting fiber resumes, every sink has finished processing the event. This
is what lets `logBuildSummary` read exact, final counts. `wantsLevel`
(`EventBus.ts:68`) is computed from the highest-rank `minLevel` among only
the sinks that actually serialize a payload (`capturesPayload === true`,
`EventBus.ts:19`) — the trace sink always, the console sink only in JSON
mode — so a caller can check whether it is worth building an expensive
payload without being forced to build one just to bump a counter; fan-out
itself ignores that flag, since the metrics sink (`minLevel: "trace"`)
must see everything regardless.

`emit` fills `ctx.buildId` from the `BuildId` `Context.Reference`
(`platforms/rspress/src/BuildEnv.ts`) whenever the caller left it empty,
which is why no ordinary emit site threads a build id by hand
(`EventBus.ts:41-58`). Each build also gets its own `MetricStore`
(`platforms/rspress/src/layers/build-metrics.ts:64`), returned as both a
`layer` (what Effect programs read through) and a `context` (what the
metrics sink writes through) from one `makeMetricStore()` call, so the two
forms are wired from the same registry by construction rather than by
convention. The metrics sink writes through `metric.updateUnsafe(input,
context)` against that explicit context rather than a bare `Effect.runSync
(Metric.update(...))`, because the sink itself runs outside any fiber and
a bare update would resolve the `MetricRegistry` Reference's default and
silently write to a different registry than the one the summary reads.

Every module that must emit from outside a fiber goes through one bridge,
`platforms/rspress/src/observability/sync-emitter.ts`
(`installSyncEmitter`, `emitSync`, `syncBuildId`), rather than each
call site building or capturing its own runtime reference.

## Alternatives rejected

- **An async `PubSub` fan-out.** Rejected because it can leave events
  in-flight when the summary is read at `afterBuild`, producing counts that
  do not match what the console showed during the run.
- **A logger instead of typed sinks.** One emitted event needs to become a
  human-readable line, a metric increment, a machine-readable artifact
  entry, and a trace record; a logger naturally serves only the first of
  those, and bolting the other three onto log output reintroduces
  string-parsing at each consumer.
- **Let each of the sync-island call sites hold its own runtime reference.**
  This shipped first and produced seven near-identical, slowly diverging
  copies of the same seam (one parameter at a time); collapsing them to one
  bridge module removed the divergence rather than trying to keep seven
  copies in sync by discipline.

## Consequences

- A sink that wants a build-wide answer (the summary, the issues artifact)
  can rely on every event from that build having already been processed by
  the time it reads.
- Any future consumer that needs to read events off-fiber must go through
  `sync-emitter.ts`, not invent its own holder — the one-bridge property is
  what keeps the seam from re-diverging.
- The per-build `MetricStore` isolates dimensioned (attributed) metrics
  cleanly across builds in one process, but an attribute-free metric
  resolves its registry entry once and caches it on the metric object, so
  undimensioned totals remain process-wide rather than per-build — a
  limitation the metric-store design accepts rather than hides.
