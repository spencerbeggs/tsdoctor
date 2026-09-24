---
type: Glossary
title: Sync island
description: A sync island is code that runs outside any Effect fiber — remark visitors, Shiki's preprocess hook, Prettier callbacks, the prepareWorkItems reporting wrapper — and reaches the event bus only through platforms/rspress/src/observability/sync-emitter.ts against the synchronously buildable emitter runtime; it is not Effect's own notion of a "sync" effect.
tags: [architecture, observability]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 9b47d95350beb4c7ed4e3758cdff26e79be601b537b04557aff7cdc50a70b342
status: stable
---

# Sync island

## What this repository means

A **sync island** is a piece of the RSPress adapter that RSPress or a
third-party library invokes synchronously, outside any Effect fiber, so
it cannot `yield*` into an Effect program at all: remark visitors, Shiki's
`preprocess` hook, Prettier's format callback, and the reporting wrapper
around `prepareWorkItems`. Each used to carry its own copy of a seam back
to the observability layer — a module-level `emitEvent`, a module-level
`currentBuildId`, a growing `setXEventEmitter(fn, buildId, ...)` — and the
copies decayed independently as callers added parameters[^1].

The one bridge now is `platforms/rspress/src/observability/sync-emitter.ts`[^1]:
`installSyncEmitter(runtime)` is called once, at plugin factory time,
against a runtime built specifically to be **synchronously buildable** —
`Layer.succeed`-only members, no service whose construction opens a
database. From inside a sync island, `emitSync(event)`, `syncBuildId()`
and `syncSlowCodeBlockMs()` read from that runtime's already-built
`Context.Reference`s (`BuildId`, `Thresholds`) rather than threading them
in as parameters.

## Where the wider meaning differs

Effect itself uses "synchronous" for effects that resolve without
suspending (`Effect.runSync`-safe programs, `Effect.sync`,
`Effect.succeed`). That usage describes an *effect's* execution shape and
still runs inside the Effect runtime. A "sync island" is the opposite
kind of boundary: code that is not inside any Effect fiber at all, called
by a host (RSPress's MDX loader, Shiki's transformer pipeline, Prettier)
that has no notion of Effect and would not await one if it returned it.
The "island" half of the name is deliberate — it is surrounded on both
sides by fiber-based code but is not itself part of it.

## Why this earns a concept

The main `ManagedRuntime`'s layer opens two SQLite databases at
construction (the snapshot store, the Twoslash cache), which makes it
asynchronous to build; calling `runtime.runSync` from a sync island
against *that* runtime dies with `AsyncFiberError` — from inside a remark
plugin, during RSPress's own render pass, invisible to every unit test
because unit tests do not invoke RSPress's MDX compilation. The name
marks the trap: any code identified as a sync island must go through the
one bridge and the emitter-only runtime, never the main runtime, and
never grow a second bespoke setter.

[^1]: [platforms/rspress/src/observability/sync-emitter.ts](../../platforms/rspress/src/observability/sync-emitter.ts)

See also: [the two-runtimes decision](../decisions/two-managed-runtimes.md),
[observability events, not logs](../conventions/observability-events-not-logs.md).
