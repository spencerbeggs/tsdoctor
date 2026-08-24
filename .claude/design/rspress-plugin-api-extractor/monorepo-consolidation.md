---
status: draft
module: rspress-plugin-api-extractor
category: meta
created: 2026-08-24
updated: 2026-08-24
last-synced: never
completeness: 70
related:
  - rspress-plugin-api-extractor/roadmap-1.0.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
dependencies: []
---

# Monorepo Consolidation (Phase 1)

> **Forward-looking document.** This records the PLANNED phase 1 migration, not work that has happened. The only completed step is the `@tsdoctor` org registration. Phasing and gates are governed by `roadmap-1.0.md`; the target package architecture is in `tsdoctor-package-architecture.md`.

## Table of Contents

- [Overview](#overview)
- [Current State](#current-state)
- [Target Workspace Layout](#target-workspace-layout)
- [Registry Migration](#registry-migration)
- [Model Migration](#model-migration)
- [Versioning](#versioning)
- [Deprecation of the Old Packages](#deprecation-of-the-old-packages)
- [Release Tooling](#release-tooling)
- [Non-Goals for Phase 1](#non-goals-for-phase-1)
- [Open Questions](#open-questions)
- [Rationale](#rationale)
- [Related Documentation](#related-documentation)

## Overview

Phase 1 moves the two external support libraries into this monorepo under the `@tsdoctor` org with **no behavior change**: `type-registry-effect` moves in and is renamed `@tsdoctor/registry`; `api-extractor-llms` is dissolved and its contents seed a new `@tsdoctor/model`. The existing ~1,033-test suite is the safety net proving nothing changed.

## Current State

- The `@tsdoctor` npm org is registered; the namespace is clear (no `@tsdoctor/*` packages exist, bare `tsdoctor` is unclaimed). The npm and CI/CD systems are prepared for the consolidation: the next release from this repo will release both `rspress-plugin-api-extractor` and `@tsdoctor/registry` (and any other new `@tsdoctor/*` modules), so phase 1's release prerequisite is satisfied.
- The source repository has been renamed to `https://github.com/spencerbeggs/tsdoctor` (from `spencerbeggs/rspress-plugin-api-extractor`; GitHub redirects the old URL). The git origin and all tracked `package.json` repository/homepage fields are already updated. The rename affects repo identity only — the npm package names keep the strategy in this doc (`rspress-plugin-api-extractor` keeps its npm name; the libraries publish under `@tsdoctor/*`).
- `../type-registry-effect` is a sibling repo: single-package workspace at `package/`, published as `type-registry-effect@2.3.5`, ~2,550 LOC excluding tests, already Effect v4. Modules: TypeRegistry, TypeCache, TypeResolver, PackageFetcher, PackageSpec, RegistryEvent, TsEnvironment, Vfs, VirtualPackage, internal/.
- `../api-extractor-llms` is a sibling repo: 629 LOC across 7 files (`cross-linker.ts`, `formatter.ts`, `index.ts`, `model-loader.ts`, `render.ts`, `tsdoc.ts`, `types.ts`). This plugin is its only consumer, via four thin shims (`package/src/loader.ts`, `package/src/model-loader.ts`, `package/src/formatter.ts`, `package/src/markdown/cross-linker.ts`); the delegation boundaries are documented in `build-architecture.md` ("Shared Library Delegation").
- This monorepo's workspace globs are `package`, `modules/*`, `sites/*` (`pnpm-workspace.yaml`).

## Target Workspace Layout

Add a `packages/*` glob to `pnpm-workspace.yaml` and create two new workspaces:

```text
packages/
  registry/   → @tsdoctor/registry   (moved from ../type-registry-effect/package)
  model/      → @tsdoctor/model      (seeded from ../api-extractor-llms + four plugin shims)
```

**Naming caution:** `package/` (singular) is the existing plugin workspace and `plugin/` is the Claude Code plugin, so `packages/` becomes a third, confusingly similar namespace. Whether the plugin workspace should also move under `packages/` (e.g. `packages/rspress/`) is recorded as an [open question](#open-questions), not decided here.

## Registry Migration

1. Move `../type-registry-effect/package` source and tests into `packages/registry`.
2. Rename the package to `@tsdoctor/registry`; keep the flat module layout and public API unchanged.
3. Keep the peer closure exactly as it is today — required peers: `effect`, `@effect/platform-node`, `@effected/store`, `@effected/semver`; optional peers: `@effected/xdg`, `@effected/tsconfig-json`, `@typescript/vfs`, `typescript`. The peer-vs-dependency rules (everything that peers on `effect` must stay a peer; optional peers stay behind lazy `import()`) migrate with the code.
4. Update the six consuming files in the plugin to import from `@tsdoctor/registry`: `package/src/api-extracted-package.ts`, `package/src/twoslash-transformer.ts`, `package/src/layers/TypeRegistryServiceLive.ts`, `package/src/vfs-registry.ts`, `package/src/layers/ConfigServiceLive.ts`, `package/src/services/TypeRegistryService.ts`.
5. Verify with the existing test suites — the registry's own tests move with it, and the plugin's suite exercises the integration.

## Model Migration

1. Create `packages/model` (`@tsdoctor/model`) seeded from the 7 `api-extractor-llms` source files.
2. Absorb the four plugin shims: the shim logic that is genuinely plugin-local (per `build-architecture.md`'s delegation table) stays in the plugin; the delegating shells collapse into direct imports of `@tsdoctor/model`.
3. `api-extractor-llms` the npm package is dissolved — nothing publishes under that name from this repo.
4. Verify with the existing plugin test suite; the shim tests become tests against the new package's API.

## Versioning

- `@tsdoctor/registry` starts at **3.0.0** — the rename is a breaking change from `type-registry-effect@2.3.5`.
- `@tsdoctor/model` starts at **0.x** — it is a new package whose API may be redesigned (the open decision in `tsdoctor-package-architecture.md`).

## Deprecation of the Old Packages

`npm deprecate` on `type-registry-effect@2` and `api-extractor-llms`, each with a pointer at its successor (`@tsdoctor/registry` / `@tsdoctor/model`). The owner is the only known consumer of both, so this is low-ceremony — no migration guide beyond the deprecation message and a README note is planned.

## Release Tooling

Both new packages release from this monorepo via the existing `@savvy-web/changesets` flow — GitHub Packages + npm with provenance — matching how `package/` publishes today. No new release infrastructure is needed, and none remains to set up: the npm and CI/CD systems are already **prepared** — the next release from this repo releases both `rspress-plugin-api-extractor` and `@tsdoctor/registry`, and any other new `@tsdoctor/*` modules, as they land. The multi-package release path is ready, not future work.

## Non-Goals for Phase 1

Explicitly out of scope; doing any of these in phase 1 would invalidate the "test suite proves no behavior change" gate:

- **No behavior change** of any kind.
- **No API redesign** — the `@tsdoctor/model` shape question stays open (see `tsdoctor-package-architecture.md`); phase 1 moves code, it does not reshape it. If the redesign lean is confirmed, it lands as the decision resolves, not as a silent part of the move.
- **No bundle or snapshot extraction** — `@tsdoctor/bundle` and `@tsdoctor/snapshot` are phase 2 (`roadmap-1.0.md`).

## Open Questions

- **Workspace layout:** should the plugin workspace (`package/`) also move under `packages/` so the repo has one package namespace instead of three (`package/`, `plugin/`, `packages/`)? Deferred — it churns every path reference in CI, docs, and design docs for a purely cosmetic gain during a phase whose gate is "nothing changed"; revisit once phase 1 lands.

## Rationale

- **Why move at all:** release cascade pain — a change to `@effected/*` currently requires releasing `type-registry-effect`, then bumping and releasing here. In-repo development eliminates the two hops; workspace boundaries preserve the isolated test surfaces and forced-clean APIs the separate repos provided.
- **Why dissolve `api-extractor-llms` instead of moving it:** the plugin is its only consumer and already wraps it in four shims; keeping the package shape would preserve an indirection layer that exists only for historical repo boundaries. Seeding `@tsdoctor/model` and collapsing the shims removes the indirection at the same cost as a move.
- **Why the registry keeps its peer closure:** the peer rules exist for Effect-version resolution safety (a nested `effect` copy strands artifacts at import), and the move changes the repo, not the resolution model.
- **Why 3.0.0, not 2.x:** the npm rename is inherently breaking for the one known consumer; a clean major on the new name makes the cutover unambiguous.

## Related Documentation

- **Umbrella roadmap and the phase 1 gate:** `roadmap-1.0.md`
- **Target package architecture and the model-API open decision:** `tsdoctor-package-architecture.md`
- **The four shims and delegation boundaries being absorbed:** `build-architecture.md`
- **The registry integration surface in the plugin:** `type-loading-vfs.md`
