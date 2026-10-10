---
type: Module
title: api-docs agent plugin
description: "The private pnpm workspace @tsdoctor/ai-plugins: one pluginfinity source built into a Claude Code plugin and a GitHub Copilot plugin (skills, an agent, a SessionStart hook, a Claude-only monitor) for RSPress API documentation, not the RSPress plugin."
kind: plugin
resource: ../../plugin
tags: [dx, testing, release]
sources:
  - id: plugin-claude-md
    resource: ../../plugin/CLAUDE.md
  - id: pluginfinity-config
    resource: ../../plugin/pluginfinity.config.ts
  - id: plugin-pkg
    resource: ../../plugin/package.json
  - id: changeset-config
    resource: ../../.changeset/config.json
  - id: workspace-yaml
    resource: ../../pnpm-workspace.yaml
generated:
  by: okfit/claude-code
  at: 2026-10-10T00:55:39Z
  body_sha256: 351a02726fe3332b786b9c78beb66b6db5d80968eb681ff28166edc1dcabd266
status: draft
---

# api-docs agent plugin

`plugin/` is the **api-docs agent plugin**: the pnpm workspace
`@tsdoctor/ai-plugins`, private and never published to npm[^plugin-pkg],
listed in `pnpm-workspace.yaml` as `plugin`[^workspace-yaml]. One
[pluginfinity](https://github.com/spencerbeggs/pluginfinity) source,
`plugin/pluginfinity.config.ts`, is built into two host plugins named
`api-docs`: a Claude Code plugin under `plugin/builds/claude/` and a GitHub
Copilot plugin under `plugin/builds/copilot/`[^pluginfinity-config]. Its
name is deliberately confusable with the publishable RSPress adapter:
`rspress-plugin-api-extractor` is a different thing entirely, living in
`platforms/rspress/`. See
[`../glossary/plugin-vs-platforms.md`](../glossary/plugin-vs-platforms.md)
for the distinction this repository draws between the two.

## What it ships

- **Model-invoked skills** (`skills/<skill>/SKILL.md`), one `SKILL.md` gate
  plus essentials, with a `references/` folder loaded on demand:
  - `twoslash` — the `with-api` code-fence contract, Twoslash notation,
    generated-example transforms.
  - `plugin-config` — `rspress-plugin-api-extractor`'s own configuration,
    theming, and `.api.json` model plumbing.
  - `doc-writer` — editorial craft: page skeletons, the review rubric, the
    sync workflow, cross-linking discipline.
  - `rspress-core` — package-agnostic RSPress 2.x craft: routing/nav,
    components, frontmatter, theming, i18n/multiVersion.
- **Two user-invoked skills** (`disable-model-invocation: true`), the
  former slash commands, on both hosts[^plugin-claude-md]:
  `/api-docs:review [path]` loads `doc-writer` and applies its review rubric,
  escalating to the agent for large sites; `/api-docs:sync [path]`
  dispatches the agent's sync workflow after an API/model change.
- **An agent**, `agents/rspress-docs.md`, force-loading the four craft
  skills via frontmatter `skills:` and running an orient → match → write →
  validate → report workflow. It never edits package source, TSDoc comments,
  or the generated `api/` tree — those surface as findings instead.
- **A `SessionStart` hook**, `hooks/session-start/announce.sh`, declared in
  the config with a ten-second timeout[^pluginfinity-config]. It adds one
  line of context naming the `api-docs:rspress-docs` agent and the skills.
  One script serves both hosts: it sources the pluginfinity hook library,
  which the build places under each host's `lib/`, and answers with
  `hook_context`; without `jq` the library makes it a silent no-op.
- **A background monitor**, `monitors/watch-issues.mjs`, declared in the
  config as `doc-build-issues` and built for Claude Code only. It polls
  `**/.api-docs/build/issues.json` (excluding `node_modules`) and prints one
  notification per site once its issue count settles at a non-zero value,
  deduplicated by notify-once-per-settled-count. The pure step,
  `diagnose(current, prev, minStablePolls)`, is exported and covered by
  `plugin/__test__/watch-issues.bats`.

## Builds are generated and committed

The manifests, `hooks.json` and `monitors.json` exist only in `builds/`,
written by `pluginfinity build` from the config; no source file holds
them[^plugin-claude-md]. Turbo runs that build through the workspace's
`build:dev` and `build:prod` scripts. `builds/` is committed and never
hand-edited: `pnpm plugin:check` (`pluginfinity build --check` plus a
`git diff` over `plugin/builds`) fails when the builds lag the source, and
the release workflow runs it as its on-build gate.

## Versioning

The plugin versions on its own changeset line as `@tsdoctor/ai-plugins`,
not in lockstep with `rspress-plugin-api-extractor`. `plugin/package.json`'s
`version` is every manifest's version, and `.changeset/config.json` lists
the two built manifests as the package's `versionFiles`[^changeset-config].
See [`../decisions/agent-plugin-own-release-line.md`](../decisions/agent-plugin-own-release-line.md).

## Testing

Covered by `bats`, not Vitest: `pnpm test:bats` runs
`bats --recursive plugin/__test__` against both builds. Test files live at
`plugin/__test__/*.bats` (`session-start-announce.bats`,
`watch-issues.bats`), with hook envelopes under `plugin/__test__/fixtures/`.

## Loading it

`pnpm claude` runs Claude Code with `--plugin-dir plugin/builds/claude`;
`pnpm copilot` runs the Copilot CLI with `--plugin-dir
plugin/builds/copilot`. Both load the committed build, so rebuild after
editing the source.

## Related concepts

- [`../glossary/plugin-vs-platforms.md`](../glossary/plugin-vs-platforms.md)
- [`../decisions/agent-plugin-own-release-line.md`](../decisions/agent-plugin-own-release-line.md)
- [`workspace.md`](workspace.md) — the pnpm workspace this plugin is now a
  member of.

[^plugin-claude-md]: `plugin/CLAUDE.md`
[^pluginfinity-config]: `plugin/pluginfinity.config.ts`
[^plugin-pkg]: `plugin/package.json`
[^changeset-config]: `.changeset/config.json`
[^workspace-yaml]: `pnpm-workspace.yaml`
