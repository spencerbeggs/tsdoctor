---
type: Interface
title: Vendored reference repos under .repos/
description: Sparse, shallow, read-only git submodules pinned to the installed version of each upstream dependency.
kind: config
resource: ../../.repos/config.json
tags: [dx, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-20T01:38:38Z
  body_sha256: d9d316e3261941175d3e639934043ffc0e67082c458821dd43762a413a31b7bd
sources:
  - id: repos-config
    resource: ../../.repos/config.json
  - id: gitmodules
    resource: ../../.gitmodules
---

# Vendored reference repos under `.repos/`

Six upstream projects are vendored as sparse, shallow git submodules under
`.repos/`, each pinned to the version this repo actually installs, so a
question about framework or engine behavior has an authoritative source to
read instead of training-data memory.[^gitmodules][^repos-config]

## The contract

- **Six submodules, declared in `.gitmodules`**: `rspress`, `twoslash`,
  `rsbuild`, `effect`, `vitepress`, `shiki`. Each entry is `shallow = true`
  with no `branch` — the checked-out commit is pinned explicitly, not
  tracked to a branch tip.[^gitmodules]
- **`.repos/config.json` is the orientation layer** on top of the bare
  submodule pointer: for each repo it records `url`, the pinned `ref`
  (a tag such as `v2.0.17` or `effect@4.0.0-rc.116`), `purpose` (why this
  repo is vendored and what version it tracks), `sparse` (the paths checked
  out), and an `orientation` block (`layout`, `keyPaths`, `startHere`).
  `effect`'s entry additionally carries a `notes[]` array recording a
  re-pin caveat about where v4 pre-release tags actually live.[^repos-config]
- **Populate on demand.** A freshly cloned repo does not have submodule
  content checked out; run `git submodule update --init .repos/<name>` for
  the one needed.
- **`.repos/**` is read-only.** A write under this tree is denied by a repo
  hook; the sanctioned mutation path is the `repos_manage` tool (or its
  `/silk:repos` skill), never a direct edit or `git` command inside the
  checkout.
- **Each entry's `ref` tracks the installed dependency version, not
  upstream `main`.** When the corresponding package in `pnpm-lock.yaml` is
  bumped, the vendored ref is expected to be re-pinned to match — this is
  the re-pin rule the `repin-vendored-repo` runbook covers.

## Per-repo authority and orientation

| Submodule | Pinned ref | Sparse paths | `startHere` |
| --- | --- | --- | --- |
| `rspress` | `v2.0.17` | `packages/core/src`, `website/docs/en` | `packages/core/src/index.ts` |
| `twoslash` | `v0.3.9` | `packages/twoslash/src`, `docs` | `packages/twoslash/src/index.ts` |
| `rsbuild` | `v2.1.5` | `packages/core/src`, `website/docs/en` | `packages/core/src/index.ts` |
| `effect` | `effect@4.0.0-rc.116` | `packages/effect/src`, `migration` | `packages/effect/src/index.ts` |
| `vitepress` | `v2.0.0-alpha.19` | `src/node`, `src/client`, `src/shared`, `docs/en` | `src/node/siteConfig.ts` |
| `shiki` | `v4.4.3` | `packages/twoslash`, `packages/shiki`, `packages/vitepress-twoslash` | `packages/twoslash/src/index.ts` |

Full `keyPaths` orientation for each repo lives in `.repos/config.json`
itself — this table is the index, not a substitute for reading the file.[^repos-config]

[^gitmodules]: `.gitmodules`
[^repos-config]: `.repos/config.json`

See also [repin-vendored-repo runbook](../runbooks/repin-vendored-repo.md).
