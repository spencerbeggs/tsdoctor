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
  - rspress-plugin-api-extractor/effect-service-layer.md
  - rspress-plugin-api-extractor/configuration-system.md
  - rspress-plugin-api-extractor/build-tooling.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/llms-integration.md
---

# Plugin lifecycle

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Hook execution order](#hook-execution-order)
- [The doc generation program](#the-doc-generation-program)
- [Build program stages](#build-program-stages)
- [Runtime management](#runtime-management)
- [Artifact directories](#artifact-directories)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

`src/plugin.ts` is the RSPress adapter: the `ApiExtractorPlugin` factory decodes options, builds the two `ManagedRuntime`s and returns an `RspressPlugin` whose `config()` hook runs the whole doc generation program before RSPress scans routes. `afterBuild` logs the summary, writes the production artifacts, runs the llms.txt post-processing and disposes the runtime.

## Current state

| Concern | Where it lives |
| --- | --- |
| Factory, hooks, runtime disposal | `src/plugin.ts` |
| Per-API orchestration | `src/build-program.ts` (`generateApiDocs`) |
| The pipeline stages | `src/build-stages.ts` |
| Render-pass access to Twoslash environments | `src/twoslash-access.ts` |
| Artifact paths | `src/plugin.ts` (snapshot DB), `src/schemas/observability.ts` (trace path) |

## Hook execution order

```text
1. ApiExtractorPlugin(rawOptions)  -- factory
   - Decode options via Effect Schema
   - classifyApiConfig -> isInert
   - makeAppLayers(...) once; ManagedRuntime.make for both stacks
   - installSyncEmitter(emitterRuntime)

2. config(config, utils, isProd)  -- BEFORE route scanning
   - Pre-create output directories
   - Run the Effect program (skipped when inert):
     VfsRegistry.clear(), clearTypeRoutes(), clearTwoslashAccess()
     ConfigService.resolve() -> ReadonlyArray<ResolvedApiConfig>
     installTwoslashAccess(yield* TwoslashEnvironments)
     generateApiDocs() per API config, concurrently
     heartbeat forked when isProd
   - Register remark plugins (remarkWithApi, remarkApiCodeblocks)
   - Add the runtime to builderConfig.source.include
   - LLMs resolve.alias, scope and globalUIComponents injection (skipped when inert)
   - On failure: best-effort issues.json write (isProd only), then rethrow

3. beforeBuild()  -- intentionally empty

4. afterBuild(config, isProd)
   - Build summary and render-phase report (first build only)
   - issues.json and render-phase.json (isProd, first build only)
   - LLMs post-processing
   - Dispose the runtime in production
```

Everything that depends on an API model is gated on the plugin not being inert; the RSPress-facing wiring that must exist regardless (remark plugins, `source.include`) still runs. See `configuration-system.md` for the inert path and `llms-integration.md` for the LLMs wiring.

The plugin consumes the real `isProd` flag RSPress passes to `config` to gate the heartbeat fork and the artifact writes (`build-progress-and-issues.md`).

## The doc generation program

`config()` runs generation as one scoped Effect program on the main runtime: resolve the API configs through `ConfigService`, install the Twoslash access holder, then `Effect.forEach` over the configs calling `generateApiDocs(apiConfig, fileContextMap)` at a small fixed concurrency. See `src/plugin.ts` for the program.

`installTwoslashAccess` is wired here beside the other seams rather than inside `ConfigService.layer`: config resolution should compute a value, not mutate module state as a side effect. The holder exists because the remark plugins run during RSPress's render pass outside any fiber — `type-loading-vfs.md` explains why a runtime-bound accessor is not an option.

## Build program stages

`generateApiDocs` in `src/build-program.ts` orchestrates one API:

1. **`prepareWorkItems`** — `@tsdoctor/pages` computes work items, the cross-link route map, uncategorized items and route collisions; the adapter's wrapper in `build-stages.ts` reports them as events and throws on a collision.
2. **`buildPipelineForApi`** — the Stream pipeline that builds pages and writes files.
3. **`writeMetadata`** — the root `_meta.json`, the index page and each category's `_meta.json`.
4. **`cleanupAndCommit`** — batch snapshot upsert, stale and orphan deletion, empty-directory sweep.

The stages themselves are documented in `page-generation-system.md`.

## Runtime management

The main `ManagedRuntime` is created once at plugin initialization and shared across all hooks. Production builds dispose it in `afterBuild`, which runs the scope finalizers (the SQLite WAL checkpoint, the highlighter release). In dev mode the runtime stays alive for HMR rebuilds — disposing it would destroy the DB connection and break the next build.

## Artifact directories

All on-disk artifacts live under `<cwd>/.api-docs/`, split by lifecycle:

- `snapshot/api-docs.db` — the incremental-build database, the one artifact a production site may choose to commit for build idempotency (`snapshot-tracking-system.md`). `plugin.ts` creates the directory at factory time, unconditionally, because SQLite does not create intermediate directories and a stray sync emitter can force the runtime to build even on the inert path.
- `build/` — per-build observability output regenerated every run: `issues.json`, `render-phase.json` and the opt-in `trace-<buildId>.jsonl`.

This repo gitignores the whole `.api-docs/` directory; `build-progress-and-issues.md` records the split a consumer site uses to commit only the snapshot DB.

## Rationale

- **Why generation runs in `config()`:** RSPress scans routes before `beforeBuild`, so generated pages must exist before the hook that sounds like the right one. Cold starts broke when generation lived there.
- **Why `beforeBuild` is kept but empty:** it documents the decision at the point a future reader would otherwise "fix" it.
- **Why the runtime survives dev rebuilds:** the snapshot database connection and the highlighter are runtime-lifetime resources; recreating them per HMR rebuild leaked a WASM highlighter instance each time before the highlighter became a scoped service.

## Related documentation

- **Build architecture overview:** `build-architecture.md`
- **Effect service layer:** `effect-service-layer.md`
- **Configuration system (including the inert path):** `configuration-system.md`
- **Page generation stages:** `page-generation-system.md`
- **Heartbeat and the `issues.json` artifact:** `build-progress-and-issues.md`
- **LLMs wiring in `config()` and `afterBuild`:** `llms-integration.md`
