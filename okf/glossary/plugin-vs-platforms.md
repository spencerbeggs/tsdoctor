---
type: Glossary
title: Plugin, the plugin, and platforms/
description: The repo-root plugin/ directory is the api-docs Claude Code plugin, not a pnpm workspace and not either RSPress or VitePress adapter; "the plugin" in RSPress-adapter conversation means platforms/rspress/, published as rspress-plugin-api-extractor.
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: cf7a83dd98fb29f299474fce0776430e41518902e8edaaadb33b5039ae4e46db
---

# "Plugin" versus "the plugin" versus `platforms/`

## What this repository means

Three things in this tree answer to "plugin", and none of them are
interchangeable:

- **`plugin/`** at the repo root is the **api-docs Claude Code plugin**:
  skills, the `rspress-docs` agent, commands, hooks and monitors[^1]. It
  is not a pnpm workspace — it is excluded from the `packages:` globs in
  `pnpm-workspace.yaml`[^2] (`modules/*`, `packages/*`, `platforms/*`,
  `sites/*`) — and it is not built by Turbo; it is loaded with
  `pnpm claude` and tested with `bats plugin/__test__`, not Vitest.
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
with a second, unrelated meaning — a Claude Code plugin, a completely
different kind of extension (skills and agents for an AI coding tool, not
a hook into a JS build). The repo happens to contain one of each, at the
same directory depth, with the shorter name (`plugin/`) belonging to the
*non*-npm one.

## Why this earns a concept

Reading "the plugin" as `plugin/` when a design doc or teammate means
`platforms/rspress/` sends a reader into the wrong workspace entirely —
bats tests instead of Vitest, skills instead of Effect services, no
`package.json` published to npm. `pnpm --filter` compounds the trap: it
matches the **package name**
(`rspress-plugin-api-extractor` / `vitepress-plugin-api-extractor`), not
the folder, so `pnpm --filter platforms/rspress` fails silently in ways
that look like a typo rather than a naming-convention mismatch — see the
[pnpm-filter-by-package-name convention](../conventions/pnpm-filter-by-package-name.md).

[^1]: [plugin/CLAUDE.md](../../plugin/CLAUDE.md)
[^2]: [pnpm-workspace.yaml](../../pnpm-workspace.yaml)
[^3]: [platforms/rspress/package.json](../../platforms/rspress/package.json)

See also: [the api-docs Claude Code plugin module](../modules/api-docs-claude-plugin.md),
[the RSPress adapter module](../modules/rspress-plugin-api-extractor.md).
