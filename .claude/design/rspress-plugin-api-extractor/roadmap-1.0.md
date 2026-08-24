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
  - rspress-plugin-api-extractor/bundle-spec.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/llms-integration.md
dependencies: []
---

# Road to 1.0.0

> **Forward-looking document.** This doc records PLANNED work, not the current implementation. Nothing described here exists yet unless explicitly marked done — **phase 1 is complete and released** (merged via PR #163 and shipped to npm on 2026-08-24; see `monorepo-consolidation.md`). For the current architecture, see `build-architecture.md`. Decisions listed under each phase were settled in the 2026-08-24 planning session and should be treated as settled unless a section explicitly labels them open.

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

As of 2026-08-24, **phase 1 is complete and released** (executed on `feat/tsdoctor-phase-1`, merged to `main` via PR #163):

- The `@tsdoctor` npm org is registered and the first releases under it have shipped from this repo to npm and GitHub Releases: `@tsdoctor/registry@0.1.0`, `@tsdoctor/model@0.1.0` and `rspress-plugin-api-extractor@0.8.9`, tagged in the `<package>@<version>` format.
- The old npm packages `type-registry-effect` and `api-extractor-llms` are deprecated with pointers to their successors, and their GitHub repos are archived.
- `@tsdoctor/registry` exists at `packages/registry` (the former sibling-repo `type-registry-effect@2.3.5`, moved in verbatim and renamed; fresh 0.x version line, released at 0.1.0), consumed by the plugin via `workspace:*` in six files (see `monorepo-consolidation.md`).
- `@tsdoctor/model` exists at `packages/model` (seeded verbatim from the sibling-repo `api-extractor-llms@0.2.0`, same public API; fresh 0.x line, released at 0.1.0); the plugin's four thin shims were initially kept with only their import specifiers repointed — the model-API-shape decision was then resolved (redesign) and the shim collapse **executed in phase 2** (see "Core Package Consumption" in `build-architecture.md`).
- The workspace-layout open question was resolved: the plugin workspace moved from `package/` to `platforms/rspress/` (core libraries under `packages/`, framework adapters under `platforms/`).
- The phase 1 gate held: full monorepo build green (26 Turbo tasks), typecheck green, 1,236 tests / 0 failures (the plugin's ~1,033 plus the two libraries' suites).
- **Phase 2 is code complete** (landed on `feat/tsdoctor-phase-2`, 2026-08-24, releases pending): `@tsdoctor/bundle` and `@tsdoctor/snapshot` exist, the model was redesigned to Effect v4 modules with the shims collapsed, the identity renames executed, and `gray-matter` replaced — see the phase 2 section below.
- The plugin itself is pre-1.0 and RSPress-specific; the bundle spec is now formalized in `bundle-spec.md` (the informal three-file folder convention is superseded).

## The 1.0 Definition

**Settled decision:** core `@tsdoctor/*` packages do not reach 1.0 until a working VitePress adapter alpha proves the seams. A second live consumer is the only honest test that the core/adapter boundary is drawn correctly. `rspress-plugin-api-extractor@1.0.0` ships on the 1.0 core. Docusaurus support is explicitly post-1.0.

## Phases

Each phase has a gate that must hold before the next phase starts. Phases are ordered by dependency, not by calendar.

### Phase 1 — Consolidation

**COMPLETE** (executed on branch `feat/tsdoctor-phase-1`, merged via PR #163 and released 2026-08-24). Moved development into this monorepo with **no behavior change**. Full executed record in `monorepo-consolidation.md`.

- Org registration: **done**. Release: **done** — the first release from this repo shipped `rspress-plugin-api-extractor@0.8.9`, `@tsdoctor/registry@0.1.0` and `@tsdoctor/model@0.1.0` together to npm and GitHub Releases.
- `type-registry-effect`'s workspace moved in as `packages/registry`, renamed `@tsdoctor/registry` (a fresh 0.x line — first release 0.1.0 — succeeding `type-registry-effect@2.3.5`): **done**.
- `api-extractor-llms`'s contents seeded `packages/model` (`@tsdoctor/model`, fresh 0.x line — first release 0.1.0): **done** — with one plan deviation: the four plugin shims (`loader.ts`, `model-loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`) were NOT collapsed into direct usage; only their import specifiers changed. The collapse is deferred to the open model-API-shape decision.
- Workspace layout resolved: the plugin workspace moved from `package/` to `platforms/rspress/`; globs are now `modules/*`, `packages/*`, `platforms/*`, `sites/*`.
- Deprecate both old npm packages with pointers to the new names: **done** — `type-registry-effect` and `api-extractor-llms` are deprecated on npm and their GitHub repos archived.
- **@effected surface:** the registry's existing `@effected/semver` / `store` / `tsconfig-json` / `xdg` peers moved with it unchanged (`@effected/*` is the mandated foundation throughout — see "Foundation: @effected" in `tsdoctor-package-architecture.md`).
- **Gate: HELD** — full monorepo build green (26 Turbo tasks), typecheck green, 1,236 tests / 0 failures (the plugin's ~1,033 plus the two libraries' suites now running as workspace projects).

### Phase 2 — Carve the Core

**CODE COMPLETE** (landed on branch `feat/tsdoctor-phase-2`, 2026-08-24; releases pending via changesets). Extracted the remaining framework-neutral concerns into their own packages, making the plugin a consumer of four core packages (`@tsdoctor/model`, `@tsdoctor/registry`, `@tsdoctor/bundle`, `@tsdoctor/snapshot`).

- `@tsdoctor/bundle`: **done** — exists at `packages/bundle` with the versioned sidecar manifest (`tsdoctor.json`; the manifest-shape decision resolved 2026-08-24), the six-tier resolver with provenance, layer-0-only discovery, and the local-dir / npm-tarball / GitHub-release fetchers. The previously informal three-file folder convention and the `*.npm.meta.tgz` release variant are now formalized; full spec in `bundle-spec.md`. The plugin's `fromDir`/`fromParentDir` helpers delegate to `discoverBundle` (adapter keeps its stricter package.json requirement and baseRoute/config assembly).
- `@tsdoctor/model` API redesign: **done** — redesigned as idiomatic Effect v4 namespace modules (`Model`/`Tsdoc`/`ApiItems`/`EntryPoints`/`Routes`/`SyntheticBases`/`Signature`/`Render`/`CrossLinker`/`StructuredData`-stub; see `tsdoctor-package-architecture.md`). All four plugin shims collapsed into direct usage, and the identity renames executed: registry tag ids are `"@tsdoctor/registry/..."` and the plugin XDG cache namespace is `"tsdoctor"` (the accepted one-time on-disk cache invalidation — cold refetch).
- `@tsdoctor/snapshot`: **done** — the SQLite snapshot system extracted to `packages/snapshot` and rebuilt on `@effected/store`'s `Store.layerSqlite`, positioned as the durable per-page metadata store ahead of phase 4 writing OG/SEO results into it (`snapshot-tracking-system.md`).
- Migrate `multi-entry-resolver.ts`, `route-collisions.ts`, and `synthetic-bases.ts` from the plugin into `@tsdoctor/model`: **done** — now the `EntryPoints`, `Routes` and `SyntheticBases` modules.
- Replace the plugin's `gray-matter` dependency with kit-native frontmatter handling: **done** — `platforms/rspress/src/frontmatter.ts` implements a gray-matter-parity split/join over `@effected/yaml` (YAML 1.2 parse, double-quoted scalar emission for js-yaml 1.1 consumers, hash-stable, characterization-tested); `gray-matter` is gone from the plugin manifest.
- **@effected surface:** `github` / `glob` / `npm` / `package-json` / `tsconfig-json` / `walker` / `store` / `yaml` — per the dependency map in `tsdoctor-package-architecture.md`. The `store` evaluation resolved (2026-08-24): **adopt**, executed in `@tsdoctor/snapshot` (see the port details and migration-ledger caveat in `tsdoctor-package-architecture.md`).
- **Gate: code criteria MET** — the plugin builds and tests green against the four extracted packages (suite 1,314 passing of 1,315; typecheck 23/23). The decision precondition was met ahead of schedule (manifest shape resolved during phase-2 planning; `bundle-spec.md` written). Remaining to close the phase: the changesets release.

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

Each of these docs is authored in the phase that produces the evidence or the second consumer that shapes it; docs not yet marked written do not exist yet:

| Doc | Written in | Covers |
| --- | --- | --- |
| `bundle-spec.md` | Phase 2 — **written** (2026-08-24, during phase-2 planning) | The versioned bundle manifest and fetcher contracts |
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
- **Bundle spec (phase 2, written):** `bundle-spec.md`
- **Phase 1 executed record:** `monorepo-consolidation.md`
- **Current plugin architecture & shared-library delegation:** `build-architecture.md`
- **Render-phase performance evidence:** `build-progress-and-issues.md`
- **EventBus/metrics system to extend in phase 3:** `performance-observability.md`
- **Combined-VFS limitation retired by phase 3 fix (b):** `type-loading-vfs.md`
- **LLM-first documentation mission:** `llms-integration.md`
- **Snapshot system repositioned in phase 2:** `snapshot-tracking-system.md`
