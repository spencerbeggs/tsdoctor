---
type: Runbook
title: Re-pin a vendored reference repo after a dependency bump
description: When a pinned dependency (effect, @rspress/core, vitepress, shiki, twoslash, @rsbuild/core) is bumped in this monorepo, re-pin its matching .repos/ submodule to the new tag so the vendored source stays the authority for the version actually installed.
resource: ../../.repos/config.json
tags: [dx, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: d630825b8a7998cea40fbdd3110ad875b8eb66518fa1123bcd17444d918663e8
status: stable
---

# Re-pin a vendored reference repo after a dependency bump

## Trigger

A dependency this repo vendors a reference copy of under `.repos/` is
bumped — `effect`, `@rspress/core`, `vitepress`, `shiki`/`@shikijs/*`,
`twoslash`, or `@rsbuild/core` — whether by a changeset-driven upgrade, a
manual `package.json` edit, or a config-dependency catalog bump.
`.repos/config.json`[^1] records one `ref` per submodule; a bump that
does not re-pin the submodule leaves the vendored source describing a
different version than the one actually installed and running.

## Steps

1. Read the installed version of the bumped dependency (its
   `package.json` `version`, or the resolved `catalog:` pin in
   `pnpm-workspace.yaml`/the config-dependency catalog).
2. Use the `repos_inspect` MCP tool (or `/silk:repos`) to confirm which
   `.repos/` submodule pins that dependency and what its current `ref`
   is.
3. Re-pin the submodule with `repos_manage` — never a hand edit under
   `.repos/**`; a repo hook denies direct writes there. `repos_manage`
   updates the submodule's checked-out ref and is the only sanctioned
   path.
4. Update the matching entry's `ref` field in `.repos/config.json`[^1] to
   the new tag, keeping `purpose` and `sparse` as they are unless the new
   version's directory layout moved.
5. Run `git submodule update --init .repos/<name>` so the working tree
   matches the new `ref`.
6. Refresh the `orientation` block's `keyPaths` / `startHere` notes for
   that submodule if the new version reorganized the files those paths
   point at.

## Observable end state

- `repos_inspect` reports no drift between the installed dependency
  version and the submodule's pinned `ref`.
- `.repos/config.json`'s `ref` for that submodule matches the version
  resolved in `node_modules` (or the catalog pin) exactly.

[^1]: [.repos/config.json](../../.repos/config.json)
