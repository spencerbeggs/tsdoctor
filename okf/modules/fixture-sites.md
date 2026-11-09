---
type: Module
title: Fixture sites
description: Private RSPress and VitePress sites under sites/ that consume the adapters via workspace:* against one or more fixture modules, exercising every plugin configuration shape.
kind: harness
resource: ../../sites
tags: [testing, ci]
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
status: stable
integrity:
  generated:
    body: f80f59f9341c9b1c
---

# Fixture sites

`sites/*` are private (`"private": true`, version `0.0.0`) sites that
consume `rspress-plugin-api-extractor` or `vitepress-plugin-api-extractor`
via `workspace:*`, plus one or more fixture modules (see
[`fixture-modules.md`](fixture-modules.md)). Six sites exist, each
exercising a distinct configuration shape:

| Site | Package | Configuration exercised |
| --- | --- | --- |
| `sites/basic` | `@sites/basic` | Single API, no versioning, no i18n |
| `sites/versioned` | `@sites/versioned` | Single API plus `multiVersion` |
| `sites/i18n` | `@sites/i18n` | Single API plus i18n |
| `sites/multi` | `@sites/multi` | Multi-API portal |
| `sites/effect` | `@sites/effect` | Effect-TS module documentation |
| `sites/vitepress-basic` | `@sites/vitepress-basic` | VitePress fixture over the kitchensink bundle |

Every RSPress site's `package.json` `build` script is `rspress build` and
`dev`/`preview` invoke `node lib/scripts/dev.mts` / `preview.mts` (which
call `rspress-plugin-api-extractor`'s exported `serve()` helper); the
VitePress fixture's scripts call `vitepress build|dev|preview docs`
directly. Every one of these scripts runs under
`NODE_OPTIONS=--conditions=effected-built`.

## Consuming the adapter as a built artifact

A site depends on its adapter through `workspace:*`, whose `exports`
resolve to `src/` by default. Every `packages/*` and `platforms/*` export
also carries a leading `effected-built` condition pointing at the built
file under `./dist/prod/npm/pkg/`, and the sites select it in three
places: the `NODE_OPTIONS=--conditions=effected-built` script prefix (for
Node loading the config), each RSPress site's `rspress.config.ts`
prepending `effected-built` to rspack's `resolve.conditionNames` (for the
site bundle), and the VitePress fixture's config importing the adapter
through a variable-specifier dynamic `import(adapter)` (see
[the Vite config-bundler gotcha](../gotchas/vite-config-ignores-conditions.md)).
A fixture site therefore exercises the adapter's **built** output, the
artifact that ships to real consumers: a build-only break (a missing
export condition, a wrong runtime path) shows up in a fixture site rather
than surfacing only downstream. Turbo's site `build` depends on `^build`
and the fixture module's `#build`, so the built output exists first.

## Populating a model

Each site's `sites/*/lib/models/kitchensink/` (or equivalent per-module
directory) is populated by the corresponding fixture module's build via
`localPaths` — generated, gitignored, containing the `.api.json` trio,
`bundle.json` and any published Open Graph image under `og/` (see
[`fixture-modules.md`](fixture-modules.md)). The **root** `bundle.json`
is the project tier the build nests, under `project`, into every
module's emitted manifest.

## Commands

```bash
pnpm dev                    # start the basic site's dev server (default)
pnpm dev:<site>             # basic | versioned | i18n | multi | effect | vitepress-basic
pnpm preview:<site>         # same set
pnpm build:basic            # turbo run build --filter=@sites/basic
pnpm build:multi
pnpm build:vitepress-basic  # turbo run build --filter=@sites/vitepress-basic
```

## CI scope

No CI workflow builds any fixture site: the root `ci:build` script filters
both `!@sites/*` and `!@modules/*`. A site therefore participates in CI
only through `typecheck` (Turbo's `types:check` task, which every
workspace including sites defines) and, where a site has its own suite,
Vitest — never through an actual production build in the unattended path.

## Related concepts

- [`fixture-modules.md`](fixture-modules.md) — the models these sites
  consume.
- [`workspace.md`](workspace.md) — the `ci:build` filter and the Turbo
  task graph these commands run through.
