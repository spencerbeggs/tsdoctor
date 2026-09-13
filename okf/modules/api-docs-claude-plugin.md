---
type: Module
title: api-docs Claude Code plugin
description: Claude Code plugin (skills, an agent, commands, hooks, a monitor) for authoring and maintaining RSPress API documentation — not a pnpm workspace, not the RSPress plugin.
kind: plugin
resource: ../../plugin
tags: [dx, testing]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 32f290ad5ae4ef2b1e33f1843a68645dbbb17f0f092ef0a9f32c5d89022a0cfd
---

# api-docs Claude Code plugin

`plugin/` is the **api-docs Claude Code plugin**. It is not a pnpm
workspace — it is absent from `pnpm-workspace.yaml`'s globs — and it is not
built by Turbo. Its name is deliberately confusable with the publishable
RSPress adapter: `rspress-plugin-api-extractor` is a different thing
entirely, living in `platforms/rspress/`. See
[`../glossary/plugin-vs-platforms.md`](../glossary/plugin-vs-platforms.md)
for the distinction this repository draws between the two.

## What it ships

- **Skills** (`skills/<skill>/SKILL.md`), one `SKILL.md` gate plus
  essentials, with a `references/` folder loaded on demand:
  - `twoslash` — the `with-api` code-fence contract, Twoslash notation,
    generated-example transforms.
  - `plugin-config` — `rspress-plugin-api-extractor`'s own configuration,
    theming, and `.api.json` model plumbing.
  - `doc-writer` — editorial craft: page skeletons, the review rubric, the
    sync workflow, cross-linking discipline.
  - `rspress-core` — package-agnostic RSPress 2.x craft: routing/nav,
    components, frontmatter, theming, i18n/multiVersion.
- **An agent**, `agents/rspress-docs.md`, force-loading all four skills via
  frontmatter `skills:` and running an orient → match → write → validate →
  report workflow. It never edits package source, TSDoc comments, or the
  generated `api/` tree — those surface as findings instead.
- **Commands** under `commands/*.md`: `/api-docs:review [path]` (loads the
  `doc-writer` skill and applies its review rubric, escalating to the agent
  for large sites) and `/api-docs:sync [path]` (dispatches the agent's sync
  workflow after an API/model change).
- **Hooks** (`hooks/hooks.json`): a `SessionStart` hook
  (`hooks/session-start/announce.sh`) that persists
  `API_DOCS_PROJECT_DIR`, `API_DOCS_DATA_DIR` and `API_DOCS_PLUGIN_ROOT` to
  the session env. It fails open — `emit_noop`, exit `0` — when `jq` is
  missing; hooks emit through `hooks/lib/hook-output.sh`'s `emit_noop` /
  `emit_allow` / `emit_deny` / `emit_context` rather than hand-rolling
  their JSON envelope.
- **A background monitor**, `monitors/watch-issues.mjs`, registered in
  `monitors/monitors.json` as `doc-build-issues`. It polls
  `**/.api-docs/build/issues.json` (excluding `node_modules`) every two
  seconds and prints one notification per site once its issue count
  settles at a non-zero value for a configurable number of stable polls,
  deduplicated by notify-once-per-settled-count. The pure step,
  `diagnose(current, prev, minStablePolls)`, is exported and covered by
  `plugin/__test__/watch-issues.bats`.

## Testing

Covered by `bats`, not Vitest: `bats plugin/__test__` (or the root
`pnpm run test:bats`, which runs `bats --recursive plugin`). Test files
live at `plugin/__test__/*.bats`, including `session-start-announce.bats`
and `watch-issues.bats`.

## Loading it

`pnpm claude` runs `claude --plugin-dir=plugin`, loading this plugin
directly from the working tree.

## Related concepts

- [`../glossary/plugin-vs-platforms.md`](../glossary/plugin-vs-platforms.md)
- [`workspace.md`](workspace.md) — the pnpm workspace this plugin sits
  beside without belonging to.
