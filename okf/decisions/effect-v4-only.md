---
type: Decision
status: stable
title: Effect v4 only
description: The whole monorepo runs on Effect v4 exclusively, pinned through the catalog:effect pnpm catalog, with no v3-shaped code anywhere.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 69f208422541945e8b6de229e721adc61072cc5cafb91b799034fd72f1ae3b6f
tags: [compat, architecture]
sources:
  - id: workspace
    resource: ../../pnpm-workspace.yaml
  - id: repos-config
    resource: ../../.repos/config.json
  - id: root-claude
    resource: ../../CLAUDE.md
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# The repository runs on Effect v4 only

## Context

Effect v4 is a ground-up redesign, not an incremental release on v3: modules such as `@effect/platform`'s `FileSystem` and `@effect/sql` merged into the `effect` core package itself (as the top-level `FileSystem` module and `effect/unstable/sql` respectively), and construction idioms for services, schemas, and error handling changed. A codebase, or even a single module, that mixes v3-shaped code with v4-shaped code invites peer-resolution hazards and produces call sites that type-check individually but disagree about which API generation they belong to.

## Decision

The entire monorepo runs on Effect v4 exclusively, pinned to `effect@4.0.0-rc.*` through the `catalog:effect` pnpm catalog. That catalog, along with `catalog:effect:peers`, `catalog:effected`, and `catalog:effected:peers`, is supplied by the `@effected/pnpm-plugin-effect` config dependency declared under `configDependencies` in `../../pnpm-workspace.yaml`, loaded before the workspace resolves rather than hand-pinned per package. `@effect/platform` and `@effect/sql` no longer exist as separate v3 packages in this tree; `@effect/platform-node` remains because the node-platform bindings were not absorbed into core. No module in the codebase should carry v3-era framing (a v3 import path, a v3 construction idiom) even where the v4 replacement is superficially similar. The vendored, sparse-checkout copy at `../../.repos/effect` (pinned per `../../.repos/config.json`'s `effect` entry) is the settled authority for what exists in the installed version and its exact signature.

Concrete idiom consequences that follow from the v4-only line: services are declared as `Context.Service<Self, Shape>()("id")`; schema unions and literal sets are written `Schema.Union([a, b])` and `Schema.Literals([...])`; error-channel inspection goes through `Effect.result` yielding a `Result` and recovery through `Effect.catch`; `Schema.mutable` is restricted to array schemas; `Data.TaggedError` and `Data.taggedEnum` are unchanged from v3 and used as before.

## Alternatives rejected

- **Stay on v3 until v4 reaches a stable release.** Would have blocked adoption of the `@effected/*` ecosystem this repo depends on throughout (`../../CLAUDE.md`'s `@effected` distribution section), which targets v4 exclusively, and would have deferred the FileSystem/sql consolidation indefinitely.
- **A mixed v3/v4 dependency graph**, with some workspaces on v3 and others on v4. Effect's peer-dependency resolution treats the two major lines as incompatible; a mixed graph invites pnpm to bind a package against whichever version happens to resolve first, producing failures that surface far from their cause.

## Consequences

- Every `@effected/*` dependency in this repo is declared as `catalog:effected` (`catalog:effected:peers` under `peerDependencies`), never hand-pinned to a specific version range, because the config-dependency plugin is what keeps the whole `@effected` graph — and the `effect` version it targets — moving together.
- Reasoning about Effect from training data or from memory of the v3 API is unreliable by construction: names, signatures, and whole modules have moved. The vendored `.repos/effect` source and a runtime probe against the installed rc are the two sources of truth; nothing else is.
- A future major bump of `effect` (past the current rc line to a stable 4.0.0, or beyond) is an upstream-driven event carried through the same `@effected/pnpm-plugin-effect` config dependency, not a manual per-package version edit.
