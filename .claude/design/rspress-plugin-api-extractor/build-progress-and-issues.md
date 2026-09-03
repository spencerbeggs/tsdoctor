---
status: current
module: rspress-plugin-api-extractor
category: observability
created: 2026-07-22
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/error-observability.md
  - rspress-plugin-api-extractor/render-phase-instrumentation.md
  - rspress-plugin-api-extractor/plugin-lifecycle.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
---

# Build progress heartbeat and issues artifact

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [The .api-docs directory](#the-api-docs-directory)
- [Progress heartbeat](#progress-heartbeat)
- [Issues artifact](#issues-artifact)
- [Monitor](#monitor)
- [Known limitations](#known-limitations)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

On a large multi-API site the production build can run for minutes inside `config()` with no console output between `BuildStarted` and `BuildCompleted`, which reads as a hang. Separately, code-block diagnostics used to be rendered only to the console, with no durable record an agent could read to locate and fix broken examples. Both gaps are closed on the existing event bus: a production-only heartbeat fiber emits a periodic `BuildProgress` event, and the issues sink accumulates diagnostic events into `.api-docs/build/issues.json`, which a background monitor in the api-docs Claude Code plugin surfaces. Both are gated on the real `isProd` flag RSPress passes to `config()`, not a `NODE_ENV` heuristic.

## Current state

| Concern | Where it lives |
| --- | --- |
| Heartbeat fiber, `BuildProgress` builder, `formatProgress` | `src/observability/heartbeat.ts` |
| Phase `Ref`, heartbeat fork, issues writes (`afterBuild` and the fatal-path `catch`) | `src/plugin.ts` |
| `Issue`, `IssuesSnapshot`, `eventToIssue`, `makeIssuesSink`, `writeIssuesJson` | `src/observability/sinks/issues-sink.ts` |
| `progressInterval` and `tracePath` resolution | `src/schemas/observability.ts` |
| The monitor | `plugin/monitors/watch-issues.mjs`, registered in `plugin/monitors/monitors.json` as `doc-build-issues` |

## The .api-docs directory

`<cwd>/.api-docs/` holds every on-disk artifact, split by whether the file is worth persisting:

```text
.api-docs/
├── snapshot/
│   ├── api-docs.db          # the incremental-build DB (snapshot-tracking-system.md)
│   └── api-docs.db-wal/-shm # SQLite sidecars, checkpointed away on clean shutdown
└── build/
    ├── issues.json          # prod builds only, overwritten each build
    ├── render-phase.json    # prod builds only (render-phase-instrumentation.md)
    └── trace-<buildId>.jsonl
```

`snapshot/` holds the one artifact a production site may commit for CI/local idempotency. `build/` is regenerated every run. The plugin creates `snapshot/` at factory time — SQLite does not create intermediate directories — and does so unconditionally, so an inert plugin leaves an empty directory (`snapshot-tracking-system.md`). The trace path is derived eagerly from `cwd`, which unlike RSPress's `outDir` is known at factory time.

This repo gitignores the whole `.api-docs/` directory. A consumer site that wants DB idempotency instead gitignores `.api-docs/build/` plus the `*.db-wal` / `*.db-shm` sidecars and commits `.api-docs/snapshot/`; after a clean production shutdown the directory settles to just `api-docs.db`.

## Progress heartbeat

`config()` holds a `Ref<ProgressPhase>` (`resolve` → `generate` → `done`) it flips around `ConfigService.resolve()` and the per-API `Effect.forEach`. When `isProd` and `progressIntervalMs` is set, `runHeartbeat` is forked with `Effect.forkScoped` inside the same scoped block as the build program and loops sleep-first: wait the interval, read the phase and the current metric snapshot, emit `BuildProgress`, repeat. A build that finishes before the first interval emits nothing — the self-suppression for small sites — and scope close on success or failure interrupts the fiber, so there is never a tick after the completion line.

Each tick reads five counters (`vfsFiles`, `externalPackagesTotal`, `apisCompleted`, `pagesGenerated`, `codeblockTotal`) and diffs against the previous tick for a phase-appropriate delta — the "still moving" signal a stalled build shows as `(+0)`. The resolve phase reports the moving `vfsFiles` count rather than `N/M models`, because the model-load loop runs unbounded with no clean per-model completion signal; the generate phase has a real denominator, `apisCompleted / apisTotal`, backed by the `ApiDocsCompleted` event `plugin.ts` emits per finished API. `formatProgress` renders one line per phase:

```text
API docs · resolving types · 11 files · 4 pkgs · 10s (+6 files)
API docs · 9/18 APIs · 402 pages · 918 blocks · 30s (+171 pages)
```

`observability.progressInterval` accepts seconds or `false`, resolving to `progressIntervalMs` (default ten seconds; `false` or `0` disables). The heartbeat never runs in dev builds and never on the inert path.

## Issues artifact

`makeIssuesSink()` is always registered; only the write is production-gated. `eventToIssue(event)` maps the curated subset to a typed `Issue` and its bucket:

| Event | Bucket | `source` | `code` |
| --- | --- | --- | --- |
| `TwoslashDiagnostic`, `TwoslashCheckFailed` | `warnings` | `twoslash` | `TS<code>` |
| `PrettierError` | `warnings` | `prettier` | `prettier` |
| `ShikiError` | `warnings` | `shiki` | `shiki` |
| `ConfigValidationWarning` | `warnings` | `config` | `config-validation` |
| `RouteCollisionDetected` | `errors` | `routing` | `route-collision` |
| `ModelLoadFailed` | `errors` | `model` | `model-load-failed` |
| `BuildFailed` | `errors` | `build` | `build-failed` |

Every other tag is not collected. The `suppressed` bucket is schema-reserved and always empty: no event distinguishes a diagnostic silenced by `suppressExampleErrors` / `@noErrors` from one that surfaced.

`writeIssuesJson` serializes an `IssuesSnapshot` matching `@savvy-web/bundler`'s `issues.json` shape field for field (`generatedAt`, `package`, `target`, `warnings[]`, `errors[]`, `suppressed[]`, each entry `source` / `level` / `text` / `code` / `file` / `line` / `column`) so tooling is shared; the optional `api` field is this artifact's one addition, carrying per-scope attribution a multi-API site needs.

Two write paths in `plugin.ts`, both `isProd`-gated and both skipped when inert: `afterBuild` on the first build (the normal path) and the `config()` `catch` block, best-effort, because `afterBuild` never runs on a fatal `config()` failure and a `RouteCollisionDetected` or `ModelLoadFailed` emitted just before the throw would otherwise never reach disk. That write is wrapped so it can never mask the original error. Three configuration failures — a bad `package.json`, an `externalPackages` conflict, a malformed tsconfig — reach the artifact as typed `ConfigValidationError`s rather than escaping as defects (`configuration-system.md`).

## Monitor

`plugin/monitors/watch-issues.mjs` polls `**/.api-docs/build/issues.json` (excluding `node_modules`) every two seconds and prints one notification per site once its issue count settles at a non-zero value: a self-scheduling poll loop so ticks never overlap, a stable-streak counter per file so a count still changing build to build is held back (tunable via `API_DOCS_MONITOR_STABLE_POLLS`; `--once` mode uses 0) and notify-once dedup keyed on the settled count. The pure `diagnose(current, prev, minStablePolls)` step is exported and covered by `plugin/__test__/watch-issues.bats`. It counts every entry across `warnings` and `errors` and points at the fix path (read the artifact, dispatch the `rspress-docs` agent for the affected package). Its glob never overlaps the silk monitor's `**/dist/{dev,prod}/issues.json`.

## Known limitations

**The heartbeat does not cover the phase where Twoslash dominates.** On a large consumer site the `config()` doc-generation phase completes in seconds while RSPress's own `node_md` render pass — which invokes the remark plugins and therefore Twoslash — runs for minutes. That pass runs after `config()` returns, once the scoped block hosting the heartbeat has been torn down. `CodeBlockProcessed` events are still emitted during it, so the metrics sink sees everything, but nothing ticks live to the console. A render-phase ticker is buildable — the process-model and denominator questions are answered in `render-phase-instrumentation.md` — but needs its own lifetime rather than the heartbeat fiber's.

## Rationale

- **Why ride the event bus:** the heartbeat and the artifact are two more consumers of events the build already emits; a new logging path would be a second vocabulary.
- **Why sleep-first:** a build shorter than the interval is exactly the build that does not need progress lines, and sleeping first suppresses them without a threshold.
- **Why the fatal-path write:** the errors most worth persisting are the ones that stop the build before `afterBuild`.
- **Why the bundler's artifact shape:** one monitor grammar and one fix loop across both artifacts.

## Related documentation

- **The event bus and sinks:** `performance-observability.md`
- **The Twoslash and Prettier events the artifact collects:** `error-observability.md`
- **`render-phase.json` and the render-phase questions:** `render-phase-instrumentation.md`
- **The hooks that fork the heartbeat and write the artifacts:** `plugin-lifecycle.md`
- **The snapshot DB under `.api-docs/snapshot/`:** `snapshot-tracking-system.md`
