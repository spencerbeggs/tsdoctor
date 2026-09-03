---
status: current
module: rspress-plugin-api-extractor
category: observability
created: 2026-01-15
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
---

# Error observability

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Error event variants](#error-event-variants)
- [Twoslash error flow](#twoslash-error-flow)
- [Prettier error flow](#prettier-error-flow)
- [Metrics and the summary](#metrics-and-the-summary)
- [Persisted to issues.json](#persisted-to-issuesjson)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

Twoslash, Prettier and Shiki errors during code-block processing are reported as `PluginEvent` variants through the event bus, not as direct metric increments. Each error event fans out synchronously: the console sink logs a `warn` line, the metrics sink increments the relevant counter, the issues sink records it for `issues.json` and the trace sink, when enabled, writes the full payload. Errors are non-fatal — the build continues and the affected block renders without Twoslash enhancements.

## Current state

| Concern | Where it lives |
| --- | --- |
| The error variants | `src/observability/events.ts` |
| Twoslash emit site | `handleTwoslashError` in `src/twoslash-transformer.ts` |
| Prettier emit site | `src/prettier-formatter.ts` |
| Event-to-counter mapping | `src/observability/sinks/metrics-sink.ts` |
| Console rendering | `src/observability/sinks/console-sink.ts` |
| The summary line | `logBuildSummary` in `src/layers/observability.ts` |

## Error event variants

| Variant | Level | Purpose |
| --- | --- | --- |
| `TwoslashDiagnostic` | `warn` | A TypeScript diagnostic from Twoslash: file, position, TS code, message, snippet |
| `TwoslashCheckFailed` | `trace` | An environment snapshot emitted alongside every diagnostic — the VFS key list and the compiler options as JSON — for offline reproduction |
| `PrettierError` | `warn` | A formatting failure: file and reason |
| `ShikiError` | `warn` | A highlighting failure |

## Twoslash error flow

The Twoslash transformer runs inside a synchronous Shiki callback, outside any fiber, and reaches the bus through the sync-island bridge (`emitSync` / `syncBuildId`, `performance-observability.md`). When the compiler reports an error, `handleTwoslashError` extracts the `TS` code from the message and emits a `TwoslashDiagnostic` followed by a `TwoslashCheckFailed` carrying the VFS keys and compiler-options snapshot. `TwoslashCheckFailed` reaches no counter; it is captured by the console sink at `trace` level and by the JSONL trace.

## Prettier error flow

`prettier-formatter.ts` emits a `PrettierError` from its `catch` block through the same bridge and falls back to unformatted code. In the IR pipeline the failure surfaces through `buildPage`'s `onExampleFormatError` hook, which is where `generateSinglePage` emits the event (`page-generation-system.md`).

## Metrics and the summary

`TwoslashDiagnostic` increments `twoslashDiagnostics` and `twoslashErrors` (currently once per diagnostic each; the distinction is reserved for per-block aggregation), plus a copy tagged with the TS code and scope. `PrettierError` increments `prettierErrors`; `ShikiError` increments `shikiErrors` plus a scope-tagged copy. `logBuildSummary` prints one error line — `N error(s) in code blocks (x Twoslash, y Prettier)` — and nothing when both counters are zero.

## Persisted to issues.json

Every variant above is also collected by the issues sink and written to `<cwd>/.api-docs/build/issues.json` on production builds, alongside `RouteCollisionDetected` and `ModelLoadFailed` as `errors` and typed configuration failures as `ConfigValidationWarning`s. Schema, bucket mapping and the monitor that reads the artifact are in `build-progress-and-issues.md`.

## Rationale

- **Why events rather than metric increments at the site:** one emit feeds the console, a counter, the artifact and the trace; an increment feeds one.
- **Why non-fatal:** examples are documentation, not a test suite; a type error in one example must not stop the site from building, and the artifact is where an agent goes to fix it.
- **Why the environment snapshot is `trace`:** it is large and only useful for reproduction; it should never reach a normal console.

## Related documentation

- **The event bus and sinks:** `performance-observability.md`
- **The `issues.json` artifact these events feed:** `build-progress-and-issues.md`
- **The Twoslash environments the transformer runs under:** `type-loading-vfs.md`
