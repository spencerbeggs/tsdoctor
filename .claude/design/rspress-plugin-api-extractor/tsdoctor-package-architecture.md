---
status: draft
module: rspress-plugin-api-extractor
category: architecture
created: 2026-08-24
updated: 2026-08-24
last-synced: 2026-08-24
completeness: 70
related:
  - rspress-plugin-api-extractor/roadmap-1.0.md
  - rspress-plugin-api-extractor/monorepo-consolidation.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/cross-linking-architecture.md
  - rspress-plugin-api-extractor/ssg-compatible-components.md
  - rspress-plugin-api-extractor/llms-integration.md
dependencies: []
---

# @tsdoctor Package Architecture

> **Forward-looking document.** This describes the TARGET package architecture for the `@tsdoctor` org, not the current implementation. Phase 1 has landed: `@tsdoctor/registry` and `@tsdoctor/model` now exist as workspaces under `packages/`, and the adapter lives at `platforms/rspress/`; the remaining packages are still future work. See `build-architecture.md` for what actually exists. Phasing is governed by `roadmap-1.0.md`; the phase 1 executed record is in `monorepo-consolidation.md`.

## Table of Contents

- [Overview](#overview)
- [Current State](#current-state)
- [The Layer Cake](#the-layer-cake)
  - [Future Packages (Idea-Stage Stubs)](#future-packages-idea-stage-stubs)
- [Foundation: @effected](#foundation-effected)
  - [Per-Package Dependency Map](#per-package-dependency-map)
  - [Kit Expansion via Dogfood](#kit-expansion-via-dogfood)
- [Where RSPress Coupling Actually Lives](#where-rspress-coupling-actually-lives)
- [The Adapter Contract](#the-adapter-contract)
- [Open Decisions](#open-decisions)
- [Rationale](#rationale)
- [Related Documentation](#related-documentation)

## Overview

The end state is a set of framework-neutral `@tsdoctor/*` core packages plus thin per-framework adapters. `rspress-plugin-api-extractor` keeps its npm name (name equity) but becomes the first adapter, depending on `@tsdoctor/*` for everything that is not RSPress-specific. The VitePress adapter (phase 5) is the second, and the proof that the seams are drawn correctly.

## Current State

As of 2026-08-24 phase 1 has been executed (branch `feat/tsdoctor-phase-1`, pending release — see `monorepo-consolidation.md`). Two of the packages now exist as in-repo workspaces:

- `packages/registry` — `@tsdoctor/registry` (fresh 0.x line, first release 0.1.0), the former sibling-repo `type-registry-effect@2.3.5` (~2,550 LOC, Effect v4) moved in verbatim and renamed. Consumed by the adapter via `workspace:*` in six files (listed in `monorepo-consolidation.md`).
- `packages/model` — `@tsdoctor/model` (fresh 0.x line, first release 0.1.0), seeded verbatim from the sibling-repo `api-extractor-llms@0.2.0` (629 LOC across 7 files: `cross-linker.ts`, `formatter.ts`, `index.ts`, `model-loader.ts`, `render.ts`, `tsdoc.ts`, `types.ts`), same public API. Consumed only by the adapter, still through the four thin shims (see "Shared Library Delegation" in `build-architecture.md`) — the **shim collapse is deferred** and rides the open model-API-shape decision below.
- `platforms/rspress/` — the adapter workspace (formerly `package/`): the whole plugin, including framework-neutral code slated for later extraction (multi-entry resolution, route collisions, synthetic bases, snapshot system, page generators).

`@tsdoctor/bundle`, `@tsdoctor/snapshot` and `@tsdoctor/pages` do not exist yet.

## The Layer Cake

| Package | Contents | Source today |
| --- | --- | --- |
| `@tsdoctor/model` | api.json loading, TSDoc extraction, categorization, multi-entry resolution, synthetic bases, route/cross-link model, schema.org derivation (phase 4) | **exists** (`packages/model`, seeded from `api-extractor-llms`); still to absorb plugin `loader.ts`, `model-loader.ts`, `multi-entry-resolver.ts`, `route-collisions.ts`, `synthetic-bases.ts` |
| `@tsdoctor/registry` | external type loading, VFS, Twoslash environments | **exists** (`packages/registry`, `type-registry-effect` moved in and renamed) |
| `@tsdoctor/bundle` | bundle spec + fetchers (local dir, npm tarball, GitHub release) | new; formalizes `fromDir` discovery |
| `@tsdoctor/pages` | framework-neutral doc IR rendered to markdown via mdast (**phase 5, deferred**) | page generators minus JSX emission |
| `@tsdoctor/snapshot` | SQLite incremental system + per-page metadata (OG/SEO) | `SnapshotService`, already framework-neutral |
| `rspress-plugin-api-extractor` | thin adapter: RSPress hooks, React runtime, remark plugins, llms.txt wiring | what remains of `platforms/rspress/` |

`@tsdoctor/pages` is deliberately last: per the settled decision in `roadmap-1.0.md`, the IR is extracted in phase 5 alongside the VitePress adapter so two live consumers shape it.

### Future Packages (Idea-Stage Stubs)

Recorded as ideas only — **deliberately unscheduled, no phase, no gate**:

- **`@tsdoctor/cli`** — a CLI package shipping a `tsdoctor` binary. Base use case: convenient scaffolding of repo and docs-site structures so people get up and running quickly (init a docs site, wire the plugin config, generate the bundle folder layout). Built on `effect/unstable/cli` (core's CLI framework — `@effect/cli` is dead on the v4 line), `@effected/cli` (the CLI boundary: `CliLogger` plain rendering, `CliRuntime` exit-code/failure handling), and `@effected/templates` (managed BEGIN/END sections in user-editable files). It slots naturally into the @effected foundation map below (the `cli`/`templates` rows).

## Foundation: @effected

**Standing rule (mandated):** `@effected/*` is the low-level foundation for every `@tsdoctor` subsystem. Check the kit before hand-rolling. When the kit lacks a capability, the gap is closed by EXPANDING `@effected` through dogfood loops (the `/silk:dogfood` protocol against the sibling `effected` checkout) — never by re-implementing the capability locally.

### Per-Package Dependency Map

Verified against the `@effected` package index (kit version 0.12.0-era; all kit packages published 0.x):

- **`@tsdoctor/registry`** — already consumes `@effected/semver`, `@effected/store` (`Cache`), `@effected/tsconfig-json`, and `@effected/xdg`; these are its existing peers and the phase 1 move preserved them exactly (see `monorepo-consolidation.md`).
- **`@tsdoctor/model`** — `@effected/markdown` for TSDoc prose → mdast and for building markdown programmatically (28 constructible node classes, `Markdown.stringify`, frontmatter codecs, section finders); `@effected/package-json` (typed Package model including repository/maintainers — feeds the phase 4 schema.org derivation); `@effected/spdx` (license expressions for attribution and JSON-LD; note `package-json` already delegates license validity to `spdx` — never re-validate downstream).
- **`@tsdoctor/bundle`** — `@effected/package-json` + `@effected/tsconfig-json` (the bundle's two manifest files); `@effected/github` (typed REST releases/assets for the GitHub-release fetcher); `@effected/npm` (`NpmRegistry` for the npm-tarball fetcher plus the dependency-specifier vocabulary); `@effected/semver` (version specs); `@effected/store` `Cache` + `@effected/xdg` (cached fetched artifacts, the same pattern the registry already uses); `@effected/glob` and/or `@effected/walker` for `fromDir`/`fromParentDir`-style discovery.
- **`@tsdoctor/snapshot`** — EVALUATE replacing the hand-wired `@effect/sql-sqlite-node` + Migrator stack with `@effected/store`'s SQLite Store. Recorded as an open evaluation for phase 2: does Store's model fit the relational `file_snapshots` table, or does the kit want a tabular capability grown?
- **`@tsdoctor/pages`** (phase 5) — `@effected/markdown` as the IR substrate. Division of labor by design: HTML generation belongs to the consuming framework (RSPress/VitePress) — `@effected/markdown`'s role is the TRANSITION step, emitting the correct mdast/MDX-shaped tree (and its serialization) for the framework to consume and render via the `Mdast` projection. MDX (JSX-element nodes) is not currently in its vocabulary — that is the flagged dogfood expansion, driven by the RSPress adapter's MDX serialization needs. HTML support isn't needed, not forbidden: the kit's current no-HTML posture is owner policy that could be revisited, but the architecture deliberately keeps HTML framework-side.
- **`@tsdoctor/cli`** (stub, unscheduled) — `@effected/cli` and `@effected/templates` on top of `effect/unstable/cli`, per the stub above.
- **All packages, tests** — `@effected/memfs` as the standard in-memory `FileSystem` for tests instead of hand-stubbed `layerNoop`.

### Kit Expansion via Dogfood

Candidate expansions discovered so far:

- (a) grow `@effected/markdown` to emit/serialize MDX-shaped mdast (JSX-element nodes) that RSPress consumes — phase 5, near-certain.
- (b) Possible `@effected/store` tabular/relational fit for `@tsdoctor/snapshot` — phase 2, evaluate.

The posture: gaps found while building `@tsdoctor` are signal that the kit wants the capability. They are raised through dogfood loops with `file:` overrides against the local `effected` checkout, per the `/silk:dogfood` protocol, and adopted on the next kit release wave.

## Where RSPress Coupling Actually Lives

The key architectural finding from the planning session: RSPress coupling is confined to three areas, and everything else is framework-neutral or nearly so.

1. **The runtime React components** — the SSG-MD dual-mode rendering and Twoslash tooltips (`component-development.md`, `ssg-compatible-components.md`). VitePress is Vue; none of this ports. Each adapter owns its component layer outright.
2. **The remark/HAST pipeline** — `remarkWithApi`, `remarkApiCodeblocks`, and the ShikiCrossLinker post-processing. VitePress uses markdown-it, not remark, and ships first-class Twoslash via `@shikijs/vitepress-twoslash`, so the VitePress adapter does not port this pipeline — it integrates with the native one.
3. **Lifecycle wiring** — the RSPress `config`/`afterBuild` hooks and llms.txt post-processing (`llms-integration.md`).

Everything outside those three areas — model loading and TSDoc extraction, route/cross-link computation, type registry and VFS construction, the snapshot system, page content generation minus JSX emission — belongs in core.

## The Adapter Contract

A sketch of the boundary, to be hardened by the VitePress alpha (phase 5):

**An adapter receives from core:**

- Resolved API models (loaded, categorized, multi-entry-resolved, synthetic bases applied)
- Cross-link route maps
- Generated markdown / doc IR (`@tsdoctor/pages`, once it exists)
- VFS and Twoslash environments (`@tsdoctor/registry`)
- Snapshot decisions (what changed, what to regenerate) and per-page metadata (`@tsdoctor/snapshot`)
- Derived structured data (schema.org JSON-LD, phase 4, computed in `@tsdoctor/model`)

**An adapter owns:**

- Its component layer (React for RSPress, Vue for VitePress)
- Code-block rendering integration (remark pipeline here; `@shikijs/vitepress-twoslash` there)
- Framework lifecycle wiring (hooks, dev server, build phases)
- Framework-specific SEO and llms.txt injection points

## Open Decisions

Recorded as OPEN — do not treat these as settled. Each has a stated lean.

1. **Bundle manifest shape** (decides in phase 2): a sidecar `tsdoctor.json` in the bundle folder vs a field in the bundle's `package.json`. **Lean: sidecar** — it keeps the spec's versioning independent of `package.json` and tolerates non-npm inputs (e.g. GitHub release assets).
2. **`@tsdoctor/model` API shape** (still OPEN after phase 1): freeze the current `ApiParser`-style statics, or redesign as idiomatic Effect v4 modules/services. Phase 1 punted — the seed was verbatim (`@tsdoctor/model` keeps the `api-extractor-llms` public API) and the four plugin shims were kept with only their import specifiers repointed, so the no-behavior-change gate stayed intact. The shim collapse is deferred and rides this decision. **Lean: redesign** — the package is 0.x, so the breaking window is still open, and the four shims prove the call sites are few.

## Rationale

- **Why keep the `rspress-plugin-api-extractor` name:** name equity — the package is published, searchable, and linked; the adapter role changes what is inside, not what consumers install.
- **Why the coupling analysis drives the split:** the three coupled areas (components, markdown pipeline, lifecycle) are exactly what differs between static-site frameworks; drawing the core boundary anywhere else would either leak framework types into core or force adapters to reimplement neutral logic.
- **Why `@tsdoctor/snapshot` is its own package rather than part of an adapter:** the snapshot DB becomes the durable per-page metadata store (OG images, SEO results in phase 4), which every adapter needs and no adapter should own.
- **Why `@effected/*` is mandated rather than suggested:** the consolidation exists to shorten the loop between the kit and its consumers; hand-rolling a capability the kit should own would recreate the drift the move eliminates, and the dogfood protocol makes expanding the kit cheaper than maintaining a local fork of the idea.
- **Why the open decisions stay open:** the manifest shape needs the phase 2 fetcher work to test the sidecar against real non-npm inputs, and the model API redesign is scoped by the deferred shim collapse (phase 1 kept the shims verbatim).

## Related Documentation

- **Umbrella roadmap and phase gates:** `roadmap-1.0.md`
- **Phase 1 executed record:** `monorepo-consolidation.md`
- **Current architecture and the four delegation shims:** `build-architecture.md`
- **Registry/VFS/Twoslash internals moving to `@tsdoctor/registry`:** `type-loading-vfs.md`
- **Snapshot system moving to `@tsdoctor/snapshot`:** `snapshot-tracking-system.md`
- **Page generators that seed `@tsdoctor/pages`:** `page-generation-system.md`
- **Route/cross-link model moving to `@tsdoctor/model`:** `cross-linking-architecture.md`
- **RSPress-owned component layer:** `ssg-compatible-components.md`
- **llms.txt wiring staying in the adapter:** `llms-integration.md`
