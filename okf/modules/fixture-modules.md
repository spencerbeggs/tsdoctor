---
type: Module
title: Fixture modules
description: Private packages under modules/ built purely to produce API Extractor models (.api.json) for the adapters' test fixture sites.
kind: harness
resource: ../../modules
tags: [testing, ci]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: f293c4bea4b4a0506b89bc7f31827968e00d0eefdf35971115af09b591fbf81a
---

# Fixture modules

`modules/*` are private (`"private": true`, version `0.0.0` except the
versioned pair) packages that are not real libraries — each is a controlled
TypeScript surface built with `@savvy-web/bundler`'s `defineBuild()`
(`savvy.build.ts` per module), producing `dist/dev/` (source maps) and
`dist/prod/` (the API Extractor model, `.api.json`, under
`dist/<mode>/meta/`). They exist to give the adapters and their fixture
sites something real to document.

## The four fixtures

- **`modules/kitchensink`** (`@modules/kitchensink`) — exercises every
  TSDoc tag and every API Extractor item kind: enums, classes (abstract,
  sealed, decorated, extending a synthetic base), interfaces, type
  aliases, namespaces, generic and labeled functions, and more (see
  `modules/kitchensink/CLAUDE.md`'s TSDoc/item-kind matrix). It also
  exports a `./testing` entry point (`kitchensink/testing`), so it is the
  fixture that exercises multi-entry-point resolution and dedup end to
  end. Its `savvy.build.ts` carries a `meta.tsdoctor` block (name,
  tagline, and a satori-generated Open Graph image via
  `@savvy-web/bundler/og`'s `ogImage.satori()`) that the bundler writes
  out as this module's `tsdoctor.json` bundle-manifest sidecar.
- **`modules/effect-kit`** (`@modules/effect-kit`) — exercises Effect-TS
  API patterns: `Schema.Class`, and the const-plus-type companion-name
  pattern (the same `displayName` shared by a value and a type export),
  alongside multi-entry-point models.
- **`modules/versioned-v1`** / **`modules/versioned-v2`** — a baseline API
  (v1, version `1.0.0`) and a breaking-change API (v2, version `2.0.0`),
  used together for version-diff testing across a multiVersion site.

## What consumes the built models

Each fixture site under `sites/*` (see
[`fixture-sites.md`](fixture-sites.md)) declares a `localPaths` dependency
on one or more of these modules; the fixture module's build populates that
site's `sites/*/lib/models/kitchensink/` (or equivalent) directory —
generated, gitignored — with the `.api.json` trio plus `tsdoctor.json` and
any published Open Graph image. This is how a site gets a model to
document without a real npm dependency.

`dist/<mode>/meta/issues.json` (written by the bundler's own API Extractor
pass) is the artifact the api-docs Claude Code plugin's `doc-build-issues`
monitor polls for — see
[`api-docs-claude-plugin.md`](api-docs-claude-plugin.md).

## Build and test commands

```bash
pnpm --filter @modules/kitchensink run build:dev   # dev build (both entry points)
pnpm --filter @modules/kitchensink run build:prod  # prod build + API Extractor model
pnpm --filter @modules/kitchensink run types:check
pnpm vitest run modules/kitchensink/
```

The root `pnpm run build` (`build:dev build:prod` via Turbo) builds every
fixture module, but `ci:build` filters `!@modules/*` — modules are not part
of the unattended CI build path and participate in CI only through
`typecheck` and their own Vitest suites.

## Related concepts

- [`fixture-sites.md`](fixture-sites.md) — the consumers these models feed.
- [`api-docs-claude-plugin.md`](api-docs-claude-plugin.md) — the monitor
  that reads the bundler's `issues.json` artifact.
- [`workspace.md`](workspace.md) — the Turbo task graph and `ci:build`
  filter these fixtures are excluded from.
