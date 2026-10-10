---
type: Decision
title: The agent plugin versions on its own release line, built for both hosts by pluginfinity
description: "plugin/ is the private workspace @tsdoctor/ai-plugins, built by pluginfinity from one source into committed Claude Code and Copilot plugins, and versioned on its own changeset line rather than in lockstep with rspress-plugin-api-extractor."
tags: [release, dx, architecture]
sources:
  - id: changeset
    resource: ../../.changeset/api-docs-plugin-pluginfinity.md
  - id: changeset-config
    resource: ../../.changeset/config.json
  - id: plugin-claude-md
    resource: ../../plugin/CLAUDE.md
  - id: pluginfinity-config
    resource: ../../plugin/pluginfinity.config.ts
  - id: release-workflow
    resource: ../../.github/workflows/release.yml
generated:
  by: okfit/claude-code
  at: 2026-10-10T00:56:05Z
  body_sha256: 79670f8faa0799a72ffa07ef9085b1d6c591bf9f5cbc9bc9fdd79f412ec7a9ae
status: stable
verified:
  - by: human:spencer
    at: 2026-10-10T00:54:24Z
---

# The agent plugin versions on its own release line, built for both hosts by pluginfinity

## Context

The api-docs plugin was a hand-written Claude Code plugin outside the pnpm
workspace, with a hand-written manifest, `hooks.json`, `monitors.json`, a
vendored hook library and slash commands, and it was versioned in lockstep
with `rspress-plugin-api-extractor`, so a plugin change rode the npm
package's release train. Serving GitHub Copilot as well would have meant a
second hand-maintained tree in a different host format.

## Decision

1. **One host-neutral source, two built plugins.** `plugin/` is the pnpm
   workspace `@tsdoctor/ai-plugins` (private, never published to npm).
   `pluginfinity build`, run by Turbo through its `build:dev` and
   `build:prod` scripts, turns `plugin/pluginfinity.config.ts` and the
   skills, agent, hook and monitor sources into `plugin/builds/claude/` and
   `plugin/builds/copilot/`[^pluginfinity-config]. Host-only features stay
   host-only: the `doc-build-issues` monitor is built for Claude Code alone.
2. **`builds/` is committed and generated.** Nobody edits it by hand;
   `pnpm plugin:check` fails when it lags the source, and the release
   workflow runs that check as its on-build gate[^release-workflow].
3. **Its own changeset line.** The plugin is versioned as
   `@tsdoctor/ai-plugins`, independent of `rspress-plugin-api-extractor`;
   a change under `plugin/` gets a changeset for that
   package[^changeset]. `plugin/package.json`'s `version` feeds every
   manifest, and `.changeset/config.json` lists the two built manifests as
   its `versionFiles` so `changeset version` writes them
   too[^changeset-config]. After versioning, rebuild and commit
   `builds/`[^plugin-claude-md].

## Alternatives rejected

- **Keep lockstep with `rspress-plugin-api-extractor`.** Couples a
  documentation-craft plugin's releases to an unrelated package's release
  train: a skill fix waits for an adapter release, and an adapter release
  bumps a plugin that did not change.
- **Hand-maintain a second plugin tree for Copilot.** Two copies of every
  skill, agent and hook in two host formats would drift; one source with a
  build step keeps both hosts at the same content and version.
- **Build at install time instead of committing `builds/`.** `pnpm claude`
  and `pnpm copilot` load the built trees straight from the checkout, so
  they must exist there; the `--check` gate keeps them honest instead.

## Consequences

- The changeset config is the only place that knows the built manifests'
  paths; renaming a build target means updating `versionFiles`.
- A commit hook that flips a script's exec bit makes `builds/` stale, which
  `plugin:check` reports.

See [the api-docs agent plugin module](../modules/api-docs-agent-plugin.md)
and [the plugin-vs-platforms glossary entry](../glossary/plugin-vs-platforms.md).

[^pluginfinity-config]: `plugin/pluginfinity.config.ts`
[^release-workflow]: `.github/workflows/release.yml`
[^changeset]: `.changeset/api-docs-plugin-pluginfinity.md`
[^changeset-config]: `.changeset/config.json`
[^plugin-claude-md]: `plugin/CLAUDE.md`
