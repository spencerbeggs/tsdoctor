---
status: current
module: rspress-plugin-api-extractor
category: meta
created: 2026-08-24
updated: 2026-08-24
last-synced: 2026-08-24
completeness: 90
related:
  - rspress-plugin-api-extractor/roadmap-1.0.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
dependencies: []
---

# Monorepo Consolidation (Phase 1)

> **Executed and released.** Phase 1 was executed on branch `feat/tsdoctor-phase-1`, merged to `main` via PR #163 and released (all 2026-08-24); this document records what actually happened, including the deviations from the original plan. The npm release shipped (`@tsdoctor/registry@0.1.0`, `@tsdoctor/model@0.1.0`, `rspress-plugin-api-extractor@0.8.9`) and the old packages are deprecated with their repos archived — phase 1 is fully closed out. Phasing and gates are governed by `roadmap-1.0.md`; the target package architecture is in `tsdoctor-package-architecture.md`.

## Table of Contents

- [Overview](#overview)
- [Executed Workspace Layout](#executed-workspace-layout)
- [Registry Migration (Executed)](#registry-migration-executed)
- [Model Migration (Executed)](#model-migration-executed)
- [Plugin Dependency Swap](#plugin-dependency-swap)
- [Gate Verification](#gate-verification)
- [Versioning](#versioning)
- [Deprecation of the Old Packages (Executed)](#deprecation-of-the-old-packages-executed)
- [Release Tooling](#release-tooling)
- [Deliberately Unchanged (Phase 1 No-Behavior-Change Gate)](#deliberately-unchanged-phase-1-no-behavior-change-gate)
- [Resolved Questions](#resolved-questions)
- [Rationale](#rationale)
- [Related Documentation](#related-documentation)

## Overview

Phase 1 moved the two external support libraries into this monorepo under the `@tsdoctor` org with **no behavior change**: `type-registry-effect` moved in and was renamed `@tsdoctor/registry`; `api-extractor-llms`'s contents seeded a new `@tsdoctor/model`. The existing test suite was the safety net proving nothing changed — the gate held (see [Gate Verification](#gate-verification)). Along the way the workspace-layout open question was resolved by the user: the plugin workspace moved from `package/` to `platforms/rspress/`.

Also fixed in the same branch: `.changeset/config.json`'s `repo` field was still `spencerbeggs/rspress-plugin-api-extractor` and now reads `spencerbeggs/tsdoctor`.

## Executed Workspace Layout

The `pnpm-workspace.yaml` globs are now `modules/*`, `packages/*`, `platforms/*`, `sites/*` (the bare `package` glob is gone):

```text
packages/                 → core @tsdoctor/* libraries
  registry/   → @tsdoctor/registry  (moved from ../type-registry-effect/package)
  model/      → @tsdoctor/model     (seeded from ../api-extractor-llms)
platforms/                → framework adapters
  rspress/    → rspress-plugin-api-extractor  (git mv from package/, history preserved)
plugin/                   → the api-docs Claude Code plugin (unchanged, not a pnpm workspace)
```

The old `package/` vs `packages/` naming confusion no longer exists: core libraries live under `packages/`, framework adapters under `platforms/` — the future phase-5 VitePress adapter will be `platforms/vitepress/`.

## Registry Migration (Executed)

The `type-registry-effect@2.3.5` sibling-repo workspace (`../type-registry-effect/package`) moved in **verbatim** as `packages/registry`: `src/`, `__test__/`, `types/`, `docs/`, `README.md`, `savvy.build.ts`, `tsconfig.json`, `tsdoc.json`, `turbo.json`. The CHANGELOG was deliberately not carried over.

Manifest changes: renamed to `@tsdoctor/registry`, version `0.0.0` (the pre-release baseline; the first release lands at 0.1.0 via a minor changeset), `repository.directory` set to `packages/registry`, `publishConfig` targets **npm only**. The peer closure was preserved exactly — `effect` / `@effect/platform-node` via `catalog:effect:peers`, `@effected/*` via `catalog:effected:peers`, `@typescript/vfs` and `typescript` as optional peers. The flat module layout and public API are unchanged.

**One deviation from the source repo:** the devDependency `typescript` is a direct `^6.0.3` (the classic compiler) instead of the source repo's `catalog:build` (7.x/tsgo) plus a `typescript-classic` npm alias plus a vitest `resolve.alias`. This monorepo's plugin workspace already uses the direct-6.x pattern, so the alias machinery was dropped.

The six consuming files in the plugin now import from `@tsdoctor/registry`: `platforms/rspress/src/api-extracted-package.ts`, `platforms/rspress/src/twoslash-transformer.ts`, `platforms/rspress/src/layers/TypeRegistryServiceLive.ts`, `platforms/rspress/src/vfs-registry.ts`, `platforms/rspress/src/layers/ConfigServiceLive.ts`, `platforms/rspress/src/services/TypeRegistryService.ts`.

## Model Migration (Executed)

`packages/model` (`@tsdoctor/model`, version `0.0.0` — the pre-release baseline; the first release lands at 0.1.0 via a minor changeset) was seeded **verbatim** from `api-extractor-llms@0.2.0`: the 7 src files (`cross-linker.ts`, `formatter.ts`, `index.ts`, `model-loader.ts`, `render.ts`, `tsdoc.ts`, `types.ts`), the tests (including e2e/integration/fixtures/snapshots) and `types/global.d.ts`. The public API is unchanged.

Its manifest drops the old repo's template peers — `@types/node`, `@typescript/native-preview` and `typescript` were silkPeers boilerplate; the library imports only `@microsoft/api-extractor-model`, `@microsoft/tsdoc` and node builtins, which are now plain dependencies.

**Deviation from the original plan:** the four plugin shims (`platforms/rspress/src/loader.ts`, `model-loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`) were **NOT dissolved**. They keep their plugin-local logic per the delegation table in `build-architecture.md`; only their import specifiers changed from `api-extractor-llms` to `@tsdoctor/model`. The full shim collapse is deferred to the open model-API-shape decision (`tsdoctor-package-architecture.md`) — collapsing them during the move would have violated the no-behavior-change gate.

## Plugin Dependency Swap

`rspress-plugin-api-extractor` now depends on `@tsdoctor/registry: workspace:*` and `@tsdoctor/model: workspace:*` (previously npm ranges on the old names). In total, 6 registry-consuming src files, the 4 model shims and 2 test files had import specifiers updated. The workspace link resolves to each package's `dist/dev/pkg` (`publishConfig.linkDirectory`), so Turbo's `^build:dev` ordering builds the libraries before the plugin.

## Gate Verification

The phase 1 gate — the existing test suite proves no behavior change — **held**:

- Full monorepo build green (26 Turbo tasks).
- Typecheck green.
- Full test suite: **1,236 tests / 0 failures** — the plugin's ~1,033 plus the two libraries' suites, now discovered as workspace projects by the vitest-agent plugin.
- The registry's e2e jsdelivr test remains env-gated (`TS_VFS_E2E=1`), as in the source repo.

## Versioning

**User decision during execution, overriding the original plan** (the plan called for `@tsdoctor/registry@3.0.0`, a major-on-rename): both new packages start fresh at 0.x.

- `@tsdoctor/registry` restarts at **0.x** — its manifest sat at `0.0.0` pre-release and the first release landed at **0.1.0** via a minor changeset. The version line does not continue `type-registry-effect@2.3.5`; the new org gets a coherent fresh semver line.
- `@tsdoctor/model` likewise moved from `0.0.0` to its first release at **0.1.0** via a minor changeset — a new package whose API may be redesigned (the open decision in `tsdoctor-package-architecture.md`).

## Deprecation of the Old Packages (Executed)

Done at the first release (2026-08-24): `type-registry-effect` and `api-extractor-llms` are `npm deprecate`d, each with a pointer at its successor (`@tsdoctor/registry` / `@tsdoctor/model`), and both GitHub repos are archived — they remain only as historical provenance. The owner is the only known consumer of both, so this was low-ceremony — no migration guide beyond the deprecation message and a README note.

## Release Tooling

Both new packages release from this monorepo via the existing `@savvy-web/changesets` flow, matching how `platforms/rspress/` publishes today. Every publishable workspace's `publishConfig.targets` is `{ npm: true }` — publishing targets npm only; the former GitHub Packages target (and the plugin's per-registry package-rename `transform`) is gone. The npm and CI/CD systems were prepared ahead of the move, and the first release from this repo **shipped on 2026-08-24**: `rspress-plugin-api-extractor@0.8.9`, `@tsdoctor/registry@0.1.0` and `@tsdoctor/model@0.1.0` released together to npm and GitHub Releases, tagged in the new `<package>@<version>` format. Historical release tags were migrated to the `rspress-plugin-api-extractor@<version>` format during phase 1 and the old bare-semver tags deleted, so the tag namespace is uniform across the org's packages.

## Deliberately Unchanged (Phase 1 No-Behavior-Change Gate)

Two identity strings were deliberately NOT renamed during the move; both are flagged for the phase-2 / model-API-shape decision window:

- The registry library's `Context.Service` tag id strings remain `"type-registry-effect/..."` (e.g. `"type-registry-effect/TypeCache"`).
- The plugin's XDG cache namespace remains `AppDirs.layer({ namespace: "type-registry-effect" })` in `TypeRegistryServiceLive.ts`, so existing on-disk caches stay shared across the rename.

**Post-phase-1 note (2026-08-24):** the decision has since been made AND executed — phase 2 renamed both identity strings to tsdoctor-native identities (`"@tsdoctor/registry/..."` tag ids; XDG namespace `"tsdoctor"`), accepting the one-time cache invalidation (see `tsdoctor-package-architecture.md` and `roadmap-1.0.md`).

## Resolved Questions

- **Workspace layout — RESOLVED by the user during execution.** The plugin workspace did not stay at `package/` and did not move under `packages/`; it moved to `platforms/rspress/` (git mv, history preserved). Core libraries live under `packages/`, framework adapters under `platforms/` — a two-namespace split that also pre-allocates the home for the phase-5 VitePress adapter (`platforms/vitepress/`). The original deferral rationale (path churn during a "nothing changed" phase) was outweighed by doing the churn once, while every path reference was already being touched.

## Rationale

- **Why move at all:** release cascade pain — a change to `@effected/*` previously required releasing `type-registry-effect`, then bumping and releasing here. In-repo development eliminates the two hops; workspace boundaries preserve the isolated test surfaces and forced-clean APIs the separate repos provided.
- **Why seed `@tsdoctor/model` rather than move `api-extractor-llms` as-is:** the plugin is its only consumer and already wraps it in four shims; keeping the old package name would preserve an indirection that exists only for historical repo boundaries. The shim collapse itself was deferred (not dropped) so the move stayed behavior-neutral.
- **Why the registry keeps its peer closure:** the peer rules exist for Effect-version resolution safety (a nested `effect` copy strands artifacts at import), and the move changed the repo, not the resolution model.
- **Why restart at 0.x, not 3.0.0:** the new name is a new package, not a continuation of the old version line — a fresh 0.x line keeps the @tsdoctor org's semver coherent, and the old packages are deprecated only after the first release so the cutover stays unambiguous.
- **Why the tag ids and XDG namespace kept their old strings:** renaming them is observable behavior (cache invalidation, tag identity), which the phase 1 gate forbids; the rename window is phase 2.

## Related Documentation

- **Umbrella roadmap and the phase 1 gate:** `roadmap-1.0.md`
- **Target package architecture and the model-API open decision:** `tsdoctor-package-architecture.md`
- **The four shims and delegation boundaries (kept, imports repointed):** `build-architecture.md`
- **The registry integration surface in the plugin:** `type-loading-vfs.md`
