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
  - rspress-plugin-api-extractor/build-architecture.md
dependencies: []
---

# Error Observability System Design

## Table of Contents

- [Overview](#overview)
- [Error Event Variants](#error-event-variants)
- [Twoslash Error Flow](#twoslash-error-flow)
- [Prettier Error Flow](#prettier-error-flow)
- [Metrics Derived from Error Events](#metrics-derived-from-error-events)
- [Build Summary Integration](#build-summary-integration)
- [Persisted to `issues.json`](#persisted-to-issuesjson)
- [File Locations](#file-locations)

---

## Overview

Twoslash and Prettier errors that occur during code-block processing are
reported as **`PluginEvent` variants** through the EventBus, not as direct
metric increments. Error events fan out synchronously to all registered sinks:
the console sink logs a human-readable line (at `warn` level), the metrics sink
increments the relevant `BuildMetrics` counters, and — when the trace artifact
is enabled — the trace sink writes the full payload to JSONL.

Errors are **non-fatal**: the build continues and the affected code block
renders without Twoslash enhancements.

---

## Error Event Variants

Three variants in `PluginEvent` (`platforms/rspress/src/observability/events.ts`) cover
code-block errors:

| Variant | Level | Purpose |
| ------- | ----- | ------- |
| `TwoslashDiagnostic` | `"warn"` | A TypeScript diagnostic from Twoslash. Carries `file`, `line`, `col`, `code` (TS error number), `message`, `snippet`. |
| `TwoslashCheckFailed` | `"trace"` | Environment snapshot emitted alongside every `TwoslashDiagnostic`. Carries `fsMapKeys` (VFS key list) and `compilerOptions` (JSON string) for offline reproduction. |
| `PrettierError` | `"warn"` | A formatting failure from Prettier. Carries `file` and `reason`. |

`ShikiError` also exists in the taxonomy and, since phase 3, maps to
`BuildMetrics.shikiErrors` (undimensioned, plus a `{ scope }`-tagged copy).
It previously hit the sink's `default` branch and reached no metric at all.

---

## Twoslash Error Flow

The Twoslash transformer (`platforms/rspress/src/twoslash-transformer.ts`) runs inside a
synchronous Shiki callback, outside any Effect fiber. It reaches the bus through
the shared sync-island bridge — `emitSync` from
`observability/sync-emitter.ts`, which `plugin.ts` binds once via
`installSyncEmitter(emitterRuntime)`. The seven per-module `emitEvent`
variables and their `setXEventEmitter` setters are gone; see the
Sync-Island Bridge section of `performance-observability.md`.

When the Twoslash compiler reports an error, `handleTwoslashError` is called:

```typescript
private handleTwoslashError(error: unknown, _code: string, file: string): void {
  const message = error instanceof Error ? error.message : String(error);
  const match = /TS(\d+)/.exec(message);
  const tsCode = match ? Number(match[1]) : 0;

  emitSync(PluginEvent.TwoslashDiagnostic({
    ctx: { buildId: syncBuildId(), file },
    level: "warn",
    file, line: 0, col: 0, code: tsCode, message, snippet: "",
  }));

  emitSync(PluginEvent.TwoslashCheckFailed({
    ctx: { buildId: syncBuildId(), file },
    level: "trace",
    file, code: tsCode,
    fsMapKeys: this.vfsKeysSnapshot(),
    compilerOptions: JSON.stringify(this.compilerOptionsSnapshot()),
  }));
}
```

Both events are delivered synchronously via `emitSync`, which calls
`runtime.runSync(emit(event))` against the observability-only runtime. The console
sink logs the `TwoslashDiagnostic` at `warn` level; the metrics sink increments
`twoslashDiagnostics` and `twoslashErrors`; the trace sink (if active) writes
both payloads to the JSONL file, including the VFS keys and compiler options
snapshot in `TwoslashCheckFailed`.

---

## Prettier Error Flow

The Prettier formatter (`platforms/rspress/src/prettier-formatter.ts`) uses the same
bridge and emits a `PrettierError` from its `catch` block:

```typescript
emitSync(
  PE.PrettierError({ ctx: { buildId: syncBuildId() }, file: "unknown", reason: errorMsg, level: "warn" })
);
```

The console sink logs the error at `warn` level; the metrics sink increments
`prettierErrors`. Formatting falls back to unformatted code.

---

## Metrics Derived from Error Events

The metrics sink (`platforms/rspress/src/observability/sinks/metrics-sink.ts`) derives
error counters from events:

| Event | Counter incremented |
| ----- | ------------------- |
| `TwoslashDiagnostic` | `BuildMetrics.twoslashDiagnostics`, `BuildMetrics.twoslashErrors` |
| `PrettierError` | `BuildMetrics.prettierErrors` |
| `ShikiError` | `BuildMetrics.shikiErrors` (also tagged `{ scope }`) |

`twoslashDiagnostics` counts individual diagnostics. `twoslashErrors` counts
affected code blocks (currently incremented once per diagnostic, same as
`twoslashDiagnostics`; the distinction is reserved for future aggregation).

`TwoslashCheckFailed` hits the `default` branch of the metrics sink and
increments no counter — it is captured only by the console sink (at `trace`
level, i.e. only visible in debug or trace mode) and the JSONL trace.

---

## Build Summary Integration

`logBuildSummary` (`platforms/rspress/src/layers/observability.ts`) reads error
metric snapshots at the end of `afterBuild`:

```text
[15:23:47] 3 error(s) in code blocks (2 Twoslash, 1 Prettier)
```

No error line is printed when both counters are zero.

---

## Persisted to `issues.json`

Every event in this document is also collected by the fourth EventBus sink, the issues collector (`makeIssuesSink`, `src/observability/sinks/issues-sink.ts`), and written to `<cwd>/.api-docs/build/issues.json` on production builds. Route collisions and model-load failures also land in the artifact as `errors` rather than only `warnings`: `RouteCollisionDetected` uses the same sync-island bridge as Twoslash/Prettier (`emitSync` in `build-stages.ts`), while `ModelLoadFailed` — since the phase-2 model redesign made loading Effect-typed (`Model.load` from `@tsdoctor/model`) — is emitted inside the Effect pipeline via `Effect.tapError` + `Effect.orDie` in `layers/config-resolution.ts`; the former `setModelLoaderEventEmitter` seam is deleted. Three configuration failures — a bad `package.json`, an `externalPackages` conflict, a malformed tsconfig — reach the artifact for the first time as well: they used to throw from inside `Effect.promise` bodies and escape as untyped DEFECTS, which killed the build with no `issues.json` entry at all, and now fail as typed `ConfigValidationError`s. Full schema, the event-to-bucket mapping and the monitor that reads the artifact are documented in `build-progress-and-issues.md`.

---

## File Locations

| File | Purpose |
| ---- | ------- |
| `src/observability/events.ts` | `TwoslashDiagnostic`, `TwoslashCheckFailed`, `PrettierError`, `ShikiError` variants |
| `src/observability/sinks/metrics-sink.ts` | Maps error events to `BuildMetrics` counters |
| `src/observability/sinks/console-sink.ts` | Renders error events as human-readable lines |
| `src/observability/sinks/trace-sink.ts` | Captures full error payloads (incl. VFS snapshot) to JSONL |
| `src/observability/sync-emitter.ts` | The one sync-island bridge: `installSyncEmitter`, `emitSync`, `syncBuildId` |
| `src/twoslash-transformer.ts` | Emits `TwoslashDiagnostic` + `TwoslashCheckFailed` via `emitSync` |
| `src/prettier-formatter.ts` | Emits `PrettierError` via `emitSync` |
| `src/layers/build-metrics.ts` | `twoslashDiagnostics`, `twoslashErrors`, `prettierErrors` counters |
| `src/layers/observability.ts` | `logBuildSummary` reads error counters |

---

## Related Documentation

- **Performance Observability:** `performance-observability.md` — full EventBus and sink architecture
- **Build Progress & Issues Artifact:** `build-progress-and-issues.md` — the `.api-docs/build/issues.json` artifact these events feed, plus the two new emit sites for `RouteCollisionDetected`/`ModelLoadFailed`
- **Build Architecture:** `build-architecture.md` — plugin structure and service layer
