---
type: Decision
title: Core @effected peers follow the public .d.ts surface
description: "A core @tsdoctor/* library peers on an @effected package only when its types cross the library's public .d.ts surface; everything else is a dependency, and every platforms/* adapter declares the full closure."
supersedes: consolidate-into-one-monorepo.md
status: stable
tags: [deps, architecture, compat, release]
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-09-24T00:00:00Z
  - id: vfs-pkg
    resource: ../../packages/vfs/package.json
  - id: model-pkg
    resource: ../../packages/model/package.json
  - id: pages-pkg
    resource: ../../packages/pages/package.json
  - id: bundle-pkg
    resource: ../../packages/bundle/package.json
  - id: rspress-pkg
    resource: ../../platforms/rspress/package.json
  - id: vitepress-pkg
    resource: ../../platforms/vitepress/package.json
generated:
  by: okfit/claude-code
  at: 2026-09-24T20:28:47Z
  body_sha256: c6596f170f0da3e9fc8b8f6ca60c8c8ba1cebfe4956b25ac6da04efdf0b205b6
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# Core `@effected` peers follow the public `.d.ts` surface

## Context

The consolidation moved `@tsdoctor/registry` in with its peer-dependency
closure preserved exactly, and the other core `@tsdoctor/*` packages
followed the same habit: every `@effected/*` edge was a peer. That was a
move-time constraint, not a policy. It left an intermediate library that
depends on another core library, and every application, with `@effected`
peers nothing in their own manifest satisfied, so completeness leaned on
pnpm's `autoInstallPeers`. `pnpm peers check` reported them as missing. The
peer spellings had also drifted between `catalog:effected` and
`catalog:effected:peers`.

## Decision

The repository owner approved this policy on 2026-09-24.[^owner]

1. **A core library peers on an `@effected/*` package only when that
   package's types appear in the library's public `.d.ts` surface.** Those
   types cross the boundary, so a consumer must share one instance of the
   package with the library. Any other `@effected` edge is an ordinary
   `dependency`, still `catalog:effected`. That is safe because every
   `@effected` package itself peers on `effect`, so the single `effect`
   instance is preserved. `effect` stays a peer everywhere. The public
   surface is determined by the `@effected/...` imports in the package's
   built `dist/prod/*.d.ts`, not by what `src/` imports.
2. **Peers propagate.** A core library that depends on another core
   library also declares that library's public-surface peers as its own
   peers, and adds each one as a `devDependency` so the workspace satisfies
   it locally. `@tsdoctor/model` and `@tsdoctor/registry` carry
   `@effected/tsconfig-json` from `@tsdoctor/vfs`.[^model-pkg]
   `@tsdoctor/pages` carries `package-json` and `schema-org` from
   `@tsdoctor/seo`, and `tsconfig-json` from `@tsdoctor/model`.[^pages-pkg]
3. **Applications declare the full closure.** Every adapter under
   `platforms/*` (RSPress and VitePress alike) lists the whole `@effected`
   closure of the core packages it consumes in `dependencies`, so an
   application's install is complete without relying on
   `autoInstallPeers`.[^rspress-pkg] [^vitepress-pkg] See the
   [adapter dependency-closure convention](../conventions/rspress-dependency-closure.md).
4. **`@effected/*` peers are spelled `catalog:effected:peers`**, and
   `@effected/*` dependencies are spelled `catalog:effected`.

The resulting split, public-surface peers first, then the packages that
became internal-only dependencies:

| Package | `@effected` peers (public surface) | `@effected` dependencies (internal) |
| --- | --- | --- |
| `@tsdoctor/vfs` | `tsconfig-json` | none |
| `@tsdoctor/snapshot` | `store` | `jsonc` |
| `@tsdoctor/seo` | `package-json`, `schema-org` | `spdx` |
| `@tsdoctor/model` | `markdown`, plus `tsconfig-json` propagated from vfs | `yaml` |
| `@tsdoctor/registry` | `store`, `xdg`, plus `tsconfig-json` propagated from vfs | `semver` |
| `@tsdoctor/bundle` | `github`, `jsonc`, `npm`, `package-json`, `store`, `tsconfig-json`, `xdg` | `glob`, `walker` |
| `@tsdoctor/pages` | `markdown`, plus `package-json`, `schema-org`, `tsconfig-json` propagated | none |
| `@tsdoctor/manifest` | none (`effect` only) | none |

`@tsdoctor/bundle`'s own manifest shows the split in one file:[^bundle-pkg]
seven `catalog:effected:peers` entries, plus `glob` and `walker` under
`dependencies`. `@tsdoctor/vfs` keeps
`@effected/tsconfig-json` as a required peer, not an optional one,
because `CompilerOptions` is part of its exported types.[^vfs-pkg]

## Alternatives rejected

- **Declare the whole `@effected` closure as `dependencies` everywhere.**
  Rejected. A package whose types cross a library boundary would then be
  installed once per library. Two copies of `@effected/markdown` or
  `@effected/schema-org` break `Schema.Class` and class identity at the
  seam: an `instanceof` check fails, and a decode against one copy's schema
  rejects a value built from the other's. None of that shows up in the type
  checker.
- **Keep every `@effected` edge a peer.** Rejected. That was the move-time
  constraint from the consolidation, and it is the cause of the problem.
  Intermediate libraries and applications were left with peers that
  nothing in their manifest satisfied. It also forced a consumer to supply
  purely internal helpers such as `semver`, `spdx` or `glob`, which it never
  sees in a type.
- **Let applications rely on `autoInstallPeers`.** Rejected. The version
  pnpm binds for an unsatisfied peer is whatever resolves first in the
  consuming site. The adapter was never built or tested against that
  version.

## Consequences

- Changing a core package's public surface can change its peer list.
  Exporting a type from a new `@effected` package promotes that package
  from a dependency to a peer. The peer then propagates to every core
  library that depends on this one, and must be present in every adapter's
  closure. Re-grep the built `.d.ts` rather than guessing.
- `pnpm peers check --json` reporting zero missing, bad or conflicting
  peers across all workspaces is the observable gate for this policy.
- The consolidation's "peer-dependency closure preserved exactly" clause
  for `@tsdoctor/registry` no longer holds. `@effected/semver` is now an
  internal dependency of the registry. Only `effect`,
  `@effect/platform-node`, `store`, `xdg` and the propagated
  `tsconfig-json` remain peers. The rest of the consolidation record stands
  unchanged.

[^owner]: conversation with the repository owner
[^model-pkg]: `../../packages/model/package.json`
[^pages-pkg]: `../../packages/pages/package.json`
[^rspress-pkg]: `../../platforms/rspress/package.json`
[^vitepress-pkg]: `../../platforms/vitepress/package.json`
[^bundle-pkg]: `../../packages/bundle/package.json`
[^vfs-pkg]: `../../packages/vfs/package.json`
