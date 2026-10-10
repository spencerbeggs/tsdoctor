---
type: Glossary
title: Plugin, the plugin, and platforms/
description: The repo-root plugin/ directory is the api-docs agent plugin (the private workspace @tsdoctor/ai-plugins, built for Claude Code and GitHub Copilot), not either RSPress or VitePress adapter; "the plugin" in RSPress-adapter conversation means platforms/rspress/, published as rspress-plugin-api-extractor.
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-10-10T00:56:05Z
  body_sha256: ed4306ba6d953c5ba5a3c7e4f5e30ea00a7dfa71b2e9f7deb6406bd5a7c13655
status: draft
---

# "Plugin" versus "the plugin" versus `platforms/`

## What this repository means

Three things in this tree answer to "plugin", and none of them are
interchangeable:

- **`plugin/`** at the repo root is the **api-docs agent plugin**:
  skills, the `rspress-docs` agent, a SessionStart hook and a monitor[^1].
  It is the private pnpm workspace `@tsdoctor/ai-plugins`, listed as
  `plugin` in `pnpm-workspace.yaml`[^2] beside `modules/*`, `packages/*`,
  `platforms/*` and `sites/*`, but it is never published to npm. Turbo
  runs `pluginfinity build` over it to produce a Claude Code plugin and a
  GitHub Copilot plugin under `plugin/builds/`; it is loaded with
  `pnpm claude` or `pnpm copilot` and tested with `pnpm test:bats`, not
  Vitest.
- **"The plugin"**, in the context of RSPress documentation generation,
  means `platforms/rspress/`: the npm package
  `rspress-plugin-api-extractor`[^3], the RSPress adapter over the eight
  `@tsdoctor/*` core packages.
- **`platforms/vitepress/`** is the second adapter, `vitepress-plugin-api-extractor`,
  markdown-only and Vue-component-free.

## Where the wider meaning differs

In most JavaScript tooling conversation "a plugin" is whatever a build
tool or framework loads as an extension point (an Rspack plugin, an
RSPress plugin, a Vite plugin). Here that generic sense collides head-on
with a second, unrelated meaning — an agent plugin for Claude Code and
GitHub Copilot, a completely different kind of extension (skills and
agents for an AI coding tool, not a hook into a JS build). The repo happens to contain one of each, at the
same directory depth, with the shorter name (`plugin/`) belonging to the
*non*-npm one.

## Why this earns a concept

Reading "the plugin" as `plugin/` when a design doc or teammate means
`platforms/rspress/` sends a reader into the wrong workspace entirely —
bats tests instead of Vitest, skills instead of Effect services, a
`package.json` that never reaches npm. `pnpm --filter` compounds the trap: it
matches the **package name**
(`rspress-plugin-api-extractor` / `vitepress-plugin-api-extractor`), not
the folder, so `pnpm --filter platforms/rspress` fails silently in ways
that look like a typo rather than a naming-convention mismatch — see the
[pnpm-filter-by-package-name convention](../conventions/pnpm-filter-by-package-name.md).

[^1]: [plugin/CLAUDE.md](../../plugin/CLAUDE.md)
[^2]: [pnpm-workspace.yaml](../../pnpm-workspace.yaml)
[^3]: [platforms/rspress/package.json](../../platforms/rspress/package.json)

See also: [the api-docs agent plugin module](../modules/api-docs-agent-plugin.md),
[the agent plugin's own release line](../decisions/agent-plugin-own-release-line.md),
[the RSPress adapter module](../modules/rspress-plugin-api-extractor.md).
