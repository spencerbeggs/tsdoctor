---
type: Runbook
title: Dogfood an unreleased @effected/* capability
description: Link the sibling effected checkout's local build artifacts into this monorepo via pnpm overrides so an unreleased @effected/* capability can be exercised here before it ships, then unlink cleanly once it does.
resource: ../../pnpm-workspace.yaml
tags: [dx, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: f14f76a34450012c34edea7def4fc27a6a0c151a8e1e3099a959bc0cbfd801a7
---

# Dogfood an unreleased `@effected/*` capability

## Trigger

A `@tsdoctor/*` package, an adapter, or the api-docs plugin needs a
`@effected/*` capability that does not exist yet in the released kit —
the gap is meant to be closed by expanding `@effected` through the
sibling `effected` checkout, never by reimplementing it locally.

## Steps

1. In the sibling `effected` checkout, build the packages that need the
   new capability so their production artifacts exist on disk.
2. In `pnpm-workspace.yaml`[^1], add an `overrides:` block pointing every
   tinkered `@effected/*` package **and its peers** at `file:` links into
   that checkout's built output. `@effected/*` versions in this repo are
   otherwise supplied only through the
   `@effected/pnpm-plugin-effect` config dependency's catalogs
   (`catalog:effect`, `catalog:effect:peers`, `catalog:effected`,
   `catalog:effected:peers`)[^1] — never hand-pin a version range instead
   of linking.
3. `pnpm install` so the lockfile picks up the `file:` links.
4. Iterate through the `.claude/dogfood/` mail-and-journal loop:
   `/silk:dogfood --init` to start a loop with the sibling session,
   `--send` to hand off a request/finding, `--status` / `--watch` to read
   the other side's state, `--adopt` when the sibling delivers a release
   candidate to try.
5. A repo push hook blocks while any `file:` override is linked in
   `pnpm-workspace.yaml` — this is enforced, not merely advisory; do not
   work around it.
6. Once the kit cuts a real release carrying the capability, remove the
   `overrides:` block, bump the affected `catalog:effected` /
   `catalog:effected:peers` entries to the released version and
   `pnpm install` again, then run `/silk:dogfood --exit` to close the
   loop.

## Observable end state

- `pnpm-workspace.yaml` carries no `file:` specifier anywhere in
  `overrides:` (or the block is removed entirely).
- The lockfile resolves every `@effected/*` package to a catalog-pinned,
  published version.
- The push hook no longer blocks.

[^1]: [pnpm-workspace.yaml](../../pnpm-workspace.yaml)
