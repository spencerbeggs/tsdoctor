---
type: Limitation
title: The build heartbeat misses the render phase where Twoslash dominates
description: The BuildProgress heartbeat is forked inside config()'s scoped program and torn down when config() returns, but RSPress's render pass — where Twoslash cost concentrates — runs afterward with no live ticks.
bounds: ../modules/rspress-plugin-api-extractor.md
tags: [observability, performance]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 93d169fa236e0018b4adef0549a6e8bbd18f6191b8daf6bfe84db5b9261a818f
---

# Heartbeat misses the render phase

## Trigger

A production build (`isProd`) with `observability.progressIntervalMs` set
runs on a site large enough that RSPress's own MDX render pass — which
invokes the remark plugins and therefore Twoslash — takes minutes after
`config()` has already returned. The heartbeat fiber is forked with
`Effect.forkScoped` inside the same `Effect.scoped` block that runs the doc
generation program,[^1] and that scope closes, interrupting the fiber, the
moment `config()`'s program finishes — which is well before RSPress's render
pass starts.

## Symptom

Console output goes quiet for the render-phase window: the last
`BuildProgress` tick reports `generate` phase completion, then nothing until
the build finishes, even though this is exactly the phase where Twoslash
type-checking (the dominant cost per `render-phase-instrumentation`
measurements) is running. A user watching the console reasonably reads the
silence as a hang. `CodeBlockProcessed` events are still emitted and still
reach the metrics sink during this window — the data exists — but nothing
ticks it to the console. Separately, `BuildStarted.mode` is hardcoded to
`"prod"` regardless of whether `rspress dev` or `rspress build` invoked the
hook,[^2] so the emitted event cannot distinguish the two even where it does
fire.

## Why this is acceptable

The render pass runs on RSPress's own lifecycle, outside any scope this
plugin controls, and the existing heartbeat's lifetime is deliberately the
scope of the doc-generation program — extending it would mean the heartbeat
fiber outliving the Effect program that owns its dependencies (the metric
registry, the event bus), which is a different design than "log every N
seconds." The render pass's own progress is still measurable after the fact:
`render-phase.json` and the build summary's per-scope render lines report it
once the build ends.

## What a fix would take

A render-phase ticker needs its own lifetime — RSPress's `node_md` MDX
compile runs on the main process (not a worker), so a main-process observer
can see live counters through the same event bus during that pass, but the
ticker has to be forked at a scope that outlives `config()`'s and torn down
from `afterBuild` or a later hook instead of from the `config()` scope's
close. The denominator is already knowable: `PageGenerated` carries a
`codeblockCount` counted at generation time, complete even on an incremental
build. This is buildable now that the process model is understood; it has
simply not been built.

[^1]: platforms/rspress/src/plugin.ts:330-346
[^2]: platforms/rspress/src/plugin.ts:333
