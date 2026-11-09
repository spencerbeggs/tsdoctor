---
type: Module
title: Fixture modules
description: Private packages under modules/ built purely to produce API Extractor models (.api.json) for the adapters' test fixture sites.
kind: harness
resource: ../../modules
tags: [testing, ci]
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
status: stable
integrity:
  generated:
    body: d6a0014b2826c0b2
---

# Fixture modules

`modules/*` are private (`"private": true`, version `0.0.0` except the
versioned pair) packages that are not real libraries — each is a controlled
TypeScript surface built by `effected package build` (one `build` script,
configured by an `effected.toml` per module), producing `dist/prod/npm/pkg/`
(the built package) and `dist/prod/npm/meta/` (the API Extractor model,
`.api.json`, beside the `bundle.json` sidecar). They exist to give the adapters and their fixture
sites something real to document.

## The four fixtures

- **`modules/kitchensink`** (`@modules/kitchensink`) — exercises every
  TSDoc tag and every API Extractor item kind: enums, classes (abstract,
  sealed, decorated, extending a synthetic base), interfaces, type
  aliases, namespaces, generic and labeled functions, and more (see
  `modules/kitchensink/CLAUDE.md`'s TSDoc/item-kind matrix). It also
  exports a `./testing` entry point (`kitchensink/testing`), so it is the
  fixture that exercises multi-entry-point resolution and dedup end to
  end. Its `effected.toml` carries a `[package.bundle]` table (name,
  tagline, and `openGraph.generate = "satori"` for a generated Open Graph
  image) that the build writes out as this module's `bundle.json`
  bundle-manifest sidecar.
- **`modules/effect-kit`** (`@modules/effect-kit`) — exercises Effect-TS
  API patterns: `Schema.Class`, and the const-plus-type companion-name
  pattern (the same `displayName` shared by a value and a type export),
  alongside multi-entry-point models.
- **`modules/versioned-v1`** / **`modules/versioned-v2`** — a baseline API
  (v1, version `1.0.0`) and a breaking-change API (v2, version `2.0.0`),
  used together for version-diff testing across a multiVersion site.

## What consumes the built models

Each fixture module's `effected.toml` lists the fixture sites (see
[`fixture-sites.md`](fixture-sites.md)) it feeds under
`[package.build.meta].localPaths`; the fixture module's build populates that
site's `sites/*/lib/models/kitchensink/` (or equivalent) directory —
generated, gitignored — with the `.api.json` trio plus `bundle.json` and
any published Open Graph image. This is how a site gets a model to
document without a real npm dependency.

`dist/prod/issues.json` is the build's own report (tsdown and API
Extractor diagnostics, with a `suppressed` bucket). It is not what the
api-docs agent plugin's `doc-build-issues` monitor polls; that monitor
reads the adapters' `.api-docs/build/issues.json` — see
[`api-docs-agent-plugin.md`](api-docs-agent-plugin.md).

## Build and test commands

```bash
pnpm --filter @modules/kitchensink run build   # build + API Extractor model + bundle.json
pnpm --filter @modules/kitchensink run types:check
pnpm vitest run modules/kitchensink/
```

The root `pnpm run build` (Turbo's single `build` task) builds every
fixture module, but `ci:build` filters `!@modules/*` — modules are not part
of the unattended CI build path and participate in CI only through
`typecheck` and their own Vitest suites.

## Related concepts

- [`fixture-sites.md`](fixture-sites.md) — the consumers these models feed.
- [`api-docs-agent-plugin.md`](api-docs-agent-plugin.md) — the monitor
  that reads the adapters' doc-build `issues.json` artifact.
- [`workspace.md`](workspace.md) — the Turbo task graph and `ci:build`
  filter these fixtures are excluded from.
