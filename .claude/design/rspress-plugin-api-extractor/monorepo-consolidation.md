---
status: current
module: rspress-plugin-api-extractor
category: meta
created: 2026-08-24
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/roadmap-1.0.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
---

# Monorepo consolidation

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [What moved](#what-moved)
- [Versioning and release tooling](#versioning-and-release-tooling)
- [Deprecation of the old packages](#deprecation-of-the-old-packages)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

This is the executed record of phase 1 of the roadmap: moving the plugin's two external support libraries into this monorepo under the `@tsdoctor` org with no behaviour change. It is historical — every decision it records has since been built on — and is kept so the origin of the workspace layout, the version lines and the deprecated npm names stays legible. For the architecture as it stands, see `tsdoctor-package-architecture.md`.

## Current state

The workspace globs are `modules/*`, `packages/*`, `platforms/*` and `sites/*`: core libraries under `packages/`, framework adapters under `platforms/`. `plugin/` at the repo root is the api-docs Claude Code plugin, not a pnpm workspace. The `.changeset/config.json` `repo` field names `spencerbeggs/tsdoctor`.

## What moved

- **`type-registry-effect`** (the Effect v4 line of the type registry) moved in verbatim as `packages/registry` and was renamed `@tsdoctor/registry`, its peer closure preserved exactly because the peer rules exist for Effect-version resolution safety and the move changed the repo, not the resolution model. One deviation from the source repo: the dev dependency on `typescript` is a direct classic-compiler range rather than the source's catalog-plus-alias machinery, matching what the plugin workspace already used.
- **`api-extractor-llms`** seeded `packages/model` as `@tsdoctor/model` verbatim, with its template peers dropped in favour of plain dependencies on `@microsoft/api-extractor-model` and `@microsoft/tsdoc`. The plugin's four delegation shims were kept with only their import specifiers repointed, so the no-behaviour-change gate stayed intact; their collapse into direct usage was phase 2's work, once the model API redesign was decided.
- **The plugin workspace** moved from `package/` to `platforms/rspress/` by `git mv`, history preserved — a user decision during execution that also pre-allocated the home for the VitePress adapter.

Two identity strings were deliberately left unchanged during the move because renaming them is observable (cache invalidation, tag identity): the registry's `Context.Service` tag ids and the plugin's XDG cache namespace. Both were renamed in phase 2 to `"@tsdoctor/registry/..."` and `"tsdoctor"`, accepting the one-time cold refetch.

The gate held: full monorepo build, typecheck and the combined test suites green with the two libraries' suites running as workspace projects.

## Versioning and release tooling

Both packages started fresh at 0.x — a user decision overriding a plan to continue the registry's 2.x line — because the new name is a new package, and a fresh line keeps the org's semver coherent. Both release from this monorepo through the `@savvy-web/changesets` flow, publishing to npm only (the former GitHub Packages target and the per-registry rename transform are gone), tagged `<package>@<version>`; historical release tags were migrated to that format and the bare-semver tags deleted.

## Deprecation of the old packages

At the first release from this repo, `type-registry-effect` and `api-extractor-llms` were `npm deprecate`d with pointers at their successors and both GitHub repos archived as historical provenance. The owner was the only known consumer of both, so no migration guide beyond the deprecation message was needed.

## Rationale

- **Why move at all:** a change to `@effected/*` used to need two release hops to reach the plugin; in-repo development eliminates them while workspace boundaries preserve the isolated test surfaces.
- **Why seed the model rather than move the old package as-is:** the plugin was its only consumer and already wrapped it in shims that existed only for a historical repo boundary.
- **Why restart at 0.x:** the old packages were deprecated only after the first release, so the cutover stayed unambiguous.
- **Why keep the identity strings during the move:** the phase's gate forbade observable behaviour change; the rename window was the next phase.

## Related documentation

- **Umbrella roadmap:** `roadmap-1.0.md`
- **Target package architecture:** `tsdoctor-package-architecture.md`
- **The registry's integration surface in the plugin:** `type-loading-vfs.md`
