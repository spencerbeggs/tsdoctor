---
status: draft
module: rspress-plugin-api-extractor
category: meta
created: 2026-08-24
updated: 2026-08-24
last-synced: 2026-08-24
completeness: 70
related:
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/monorepo-consolidation.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/llms-integration.md
dependencies: []
---

# Road to 1.0.0

> **Forward-looking document.** This doc records PLANNED work, not the current implementation. Nothing described here exists yet unless explicitly marked done — **phase 1 is done** (executed on `feat/tsdoctor-phase-1`, pending release; see `monorepo-consolidation.md`). For the current architecture, see `build-architecture.md`. Decisions listed under each phase were settled in the 2026-08-24 planning session and should be treated as settled unless a section explicitly labels them open.

## Table of Contents

- [Overview](#overview)
- [Current State](#current-state)
- [The 1.0 Definition](#the-10-definition)
- [Phases](#phases)
  - [Phase 1 — Consolidation](#phase-1--consolidation)
  - [Phase 2 — Carve the Core](#phase-2--carve-the-core)
  - [Phase 3 — Instrumentation, then Scoping and Performance](#phase-3--instrumentation-then-scoping-and-performance)
  - [Phase 4 — SEO Layer](#phase-4--seo-layer)
  - [Phase 5 — VitePress Adapter and Doc IR](#phase-5--vitepress-adapter-and-doc-ir)
  - [Phase 6 — 1.0](#phase-6--10)
- [Deferred Design Docs](#deferred-design-docs)
- [Rationale](#rationale)
- [Related Documentation](#related-documentation)

## Overview

This is the umbrella roadmap for taking `rspress-plugin-api-extractor` to 1.0.0 while consolidating its two external support libraries into this monorepo under the new `@tsdoctor` npm org (registered by the owner; the namespace was clear — no `@tsdoctor/*` packages published, bare `tsdoctor` unclaimed — and the in-repo consolidation of both libraries has now been executed as phase 1). The long-term goal is to generalize from an RSPress-specific plugin into a shared toolkit for static TypeScript documentation sites — VitePress 2.x for certain, possibly Docusaurus 3.x later — with LLM-first documentation (llms.txt, clean programmatic docs for agents) and proper SEO for human and agent crawlers as core missions. The fundamental contract: "give us an api.json and we transform it into static docs."

The target package architecture (what each `@tsdoctor/*` package contains and where its code comes from) is detailed in `tsdoctor-package-architecture.md`. The phase 1 migration mechanics are detailed in `monorepo-consolidation.md`.

## Current State

As of 2026-08-24, **phase 1 has been executed** on branch `feat/tsdoctor-phase-1` (pending release):

- The `@tsdoctor` npm org is registered, and the npm/CI-CD release pipeline is prepared to release `rspress-plugin-api-extractor` and the new `@tsdoctor/*` packages from this repo. No packages are published under the org yet — the first release carrying the consolidation has not happened.
- `@tsdoctor/registry` exists at `packages/registry` (the former sibling-repo `type-registry-effect@2.3.5`, moved in verbatim and renamed; fresh 0.x version line, first release 0.1.0 pending), consumed by the plugin via `workspace:*` in six files (see `monorepo-consolidation.md`).
- `@tsdoctor/model` exists at `packages/model` (seeded verbatim from the sibling-repo `api-extractor-llms@0.2.0`, same public API; fresh 0.x line, first release 0.1.0 pending); the plugin's four thin shims documented in `build-architecture.md` under "Shared Library Delegation" were kept, with only their import specifiers repointed — the full shim collapse rides the open model-API-shape decision.
- The workspace-layout open question was resolved: the plugin workspace moved from `package/` to `platforms/rspress/` (core libraries under `packages/`, framework adapters under `platforms/`).
- The phase 1 gate held: full monorepo build green (26 Turbo tasks), typecheck green, 1,236 tests / 0 failures (the plugin's ~1,033 plus the two libraries' suites).
- The plugin itself is pre-1.0 and RSPress-specific; the bundle "spec" is an informal three-file folder convention (see phase 2).

## The 1.0 Definition

**Settled decision:** core `@tsdoctor/*` packages do not reach 1.0 until a working VitePress adapter alpha proves the seams. A second live consumer is the only honest test that the core/adapter boundary is drawn correctly. `rspress-plugin-api-extractor@1.0.0` ships on the 1.0 core. Docusaurus support is explicitly post-1.0.

## Phases

Each phase has a gate that must hold before the next phase starts. Phases are ordered by dependency, not by calendar.

### Phase 1 — Consolidation

**EXECUTED** (branch `feat/tsdoctor-phase-1`, 2026-08-24; release and old-package deprecations pending). Moved development into this monorepo with **no behavior change**. Full executed record in `monorepo-consolidation.md`.

- Org registration: **done**. Release infrastructure: **prepared** — the next release from this repo releases `rspress-plugin-api-extractor` and the new `@tsdoctor/*` packages together.
- `type-registry-effect`'s workspace moved in as `packages/registry`, renamed `@tsdoctor/registry` (a fresh 0.x line — first release 0.1.0 — succeeding `type-registry-effect@2.3.5`): **done**.
- `api-extractor-llms`'s contents seeded `packages/model` (`@tsdoctor/model`, fresh 0.x line — first release 0.1.0): **done** — with one plan deviation: the four plugin shims (`loader.ts`, `model-loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`) were NOT collapsed into direct usage; only their import specifiers changed. The collapse is deferred to the open model-API-shape decision.
- Workspace layout resolved: the plugin workspace moved from `package/` to `platforms/rspress/`; globs are now `modules/*`, `packages/*`, `platforms/*`, `sites/*`.
- Deprecate both old npm packages with pointers to the new names: **pending**, at/after the first release.
- **@effected surface:** the registry's existing `@effected/semver` / `store` / `tsconfig-json` / `xdg` peers moved with it unchanged (`@effected/*` is the mandated foundation throughout — see "Foundation: @effected" in `tsdoctor-package-architecture.md`).
- **Gate: HELD** — full monorepo build green (26 Turbo tasks), typecheck green, 1,236 tests / 0 failures (the plugin's ~1,033 plus the two libraries' suites now running as workspace projects).

### Phase 2 — Carve the Core

Extract the remaining framework-neutral concerns into their own packages, making the plugin a consumer of four core packages (`@tsdoctor/model`, `@tsdoctor/registry`, `@tsdoctor/bundle`, `@tsdoctor/snapshot`).

- `@tsdoctor/bundle`: formalize the bundle spec with a versioned manifest. Today the "spec" is an informal three-file folder (`<name>.api.json`, `package.json`, `tsconfig.json` — see `sites/basic/lib/models/kitchensink/`) emitted by `@savvy-web/bundler` via `meta.localPaths` and discovered by the plugin's `fromDir`/`fromParentDir` config helpers; a release variant is also published as GitHub release assets (e.g. `*.npm.meta.tgz` on the vitest-agent repo releases) with source maps added. The package ships local-dir, npm-tarball, and GitHub-release fetchers built on `@effected/github`.
- `@tsdoctor/snapshot`: reposition the SQLite snapshot system (`snapshot-tracking-system.md`) as the durable per-page metadata store, ahead of phase 4 writing OG/SEO results into it.
- Migrate `multi-entry-resolver.ts`, `route-collisions.ts`, and `synthetic-bases.ts` from the plugin into `@tsdoctor/model`.
- **@effected surface:** `github` / `npm` / `package-json` / `tsconfig-json` / `store` (plus an open evaluation of `store`'s SQLite Store replacing snapshot's hand-wired SQL stack) — per the dependency map in `tsdoctor-package-architecture.md`.
- **Gate:** the plugin builds and tests green against the four extracted packages; the bundle manifest shape decision (open in `tsdoctor-package-architecture.md`) is resolved and recorded in the deferred `bundle-spec.md`.

### Phase 3 — Instrumentation, then Scoping and Performance

**Settled decision: instrument first, decide after.** The phase starts by extending the EventBus/metrics system (`performance-observability.md`) to attribute render-phase time per scope and per code block — the existing evidence (below) shows where the time goes in aggregate but not which scopes or blocks dominate.

Evidence already recorded in `build-progress-and-issues.md`: on the effected/website consumer site (22 APIs), the plugin's own doc generation completed in ~2s while RSPress's render pass took 3m20s with 184/184 code blocks slow (>500ms) — Twoslash type-checking during the render phase is the dominant cost.

Candidate fixes, recorded as **hypotheses pending evidence, not commitments**:

- (a) A persisted Twoslash result cache keyed on (code hash, VFS/tsconfig hash).
- (b) Per-scope TypeScript environments instead of one combined VFS. Note that (b) is also the `with-api` scoping **correctness** fix — each leaf path gets the config of the bundle it documents — and retires the documented "first API's tsconfig wins" limitation (`type-loading-vfs.md`). It likely happens regardless of the perf data; the evidence decides its priority, not its existence.

**Gate:** per-scope, per-code-block attribution is live and has produced data; fix priority is decided from that data and recorded in the deferred `render-phase-instrumentation.md`.

### Phase 4 — SEO Layer

- JSON-LD structured data: a schema.org `SoftwareSourceCode` / `TechArticle` / `APIReference` mapping derived from `package.json` + `api.json`, **computed in `@tsdoctor/model`**, injected by the adapter.
- OG image pipeline (satori + resvg, or bundle-supplied assets), with results persisted in the snapshot DB (`@tsdoctor/snapshot`).
- Author and license attribution surfaces.
- **@effected surface:** `spdx` / `package-json` supply the JSON-LD inputs (license expressions, repository/maintainer metadata).
- **Gate:** structured data validates against schema.org tooling on a real consumer site; details recorded in the deferred `structured-data-and-og.md`.

### Phase 5 — VitePress Adapter and Doc IR

**Settled decision: the doc IR is extracted here, not designed up front.** `@tsdoctor/pages` — the framework-neutral page-generation IR (typed doc blocks + mdast prose) — is carved out only in this phase, alongside the VitePress adapter, so the abstraction is shaped by two live consumers rather than speculation.

- `@tsdoctor/pages` dogfoods `@effected/markdown`, which likely grows MDX serialization capability from this work.
- **@effected surface:** `markdown` as the IR substrate, plus the MDX dogfood loop — MDX node support is not in the kit today and is the flagged `/silk:dogfood` expansion (see "Kit Expansion via Dogfood" in `tsdoctor-package-architecture.md`).
- The VitePress adapter leans on native `@shikijs/vitepress-twoslash` where sensible instead of porting the RSPress remark pipeline.
- **Gate:** a working VitePress adapter **alpha** renders a real API doc site from the same bundles the RSPress plugin consumes. This gate is the 1.0 gate for the core.

### Phase 6 — 1.0

- Stabilize APIs, write user docs, finalize deprecations.
- `@tsdoctor/*` core packages go 1.0; `rspress-plugin-api-extractor@1.0.0` ships on them.
- Docusaurus is post-1.0.
- TS7/api-extractor is explicitly **off the critical path**: the bundle spec is the firewall — `api.json` is the input contract regardless of which TypeScript produces it. The pnpm-plugin patch idea for api-extractor is a side spike only, never a phase dependency.

## Deferred Design Docs

These docs are intentionally NOT written yet; each is authored in the phase that produces the evidence or the second consumer that shapes it:

| Doc | Written in | Covers |
| --- | --- | --- |
| `bundle-spec.md` | Phase 2 | The versioned bundle manifest and fetcher contracts |
| `render-phase-instrumentation.md` | Phase 3 | Per-scope/per-block attribution design and the measured data |
| `structured-data-and-og.md` | Phase 4 | JSON-LD mapping and OG image pipeline |
| `doc-ir-and-pages.md` | Phase 5 | The `@tsdoctor/pages` IR, shaped by the RSPress + VitePress consumers |

Also idea-stage and deliberately unscheduled (no phase, no gate): `@tsdoctor/cli`, a scaffolding `tsdoctor` binary — see "Future Packages (Idea-Stage Stubs)" in `tsdoctor-package-architecture.md`.

## Rationale

- **Why consolidate:** release cascade pain. A change to `@effected/*` previously required releasing `type-registry-effect`, then bumping and releasing here — two release hops for one change. Moving development into this monorepo eliminates them. The package split's original benefit (isolated test surfaces, forced-clean APIs) is preserved by workspace boundaries instead of repo boundaries.
- **Why the VitePress-alpha 1.0 gate:** a 1.0 promise on seams only one consumer has exercised is a guess. The alpha is the cheapest honest proof that the adapter contract holds.
- **Why the doc IR waits for phase 5:** an abstraction extracted from two live consumers is shaped by real needs; one designed up front for a hypothetical second consumer is shaped by speculation and calcifies wrong.
- **Why instrument before optimizing:** the aggregate evidence says Twoslash-in-render dominates, but the two candidate fixes have very different costs and the data to rank them does not exist yet.
- **Why TS7 is off the critical path:** the bundle spec decouples doc generation from the toolchain that produced the `api.json`, so api-extractor's TS7 story cannot block 1.0.

## Related Documentation

- **Target package architecture:** `tsdoctor-package-architecture.md`
- **Phase 1 executed record:** `monorepo-consolidation.md`
- **Current plugin architecture & shared-library delegation:** `build-architecture.md`
- **Render-phase performance evidence:** `build-progress-and-issues.md`
- **EventBus/metrics system to extend in phase 3:** `performance-observability.md`
- **Combined-VFS limitation retired by phase 3 fix (b):** `type-loading-vfs.md`
- **LLM-first documentation mission:** `llms-integration.md`
- **Snapshot system repositioned in phase 2:** `snapshot-tracking-system.md`
