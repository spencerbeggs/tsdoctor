---
type: Module
title: Fixture sites
description: Private RSPress and VitePress sites under sites/ that consume the adapters via workspace:* against one or more fixture modules, exercising every plugin configuration shape.
kind: harness
resource: ../../sites
tags: [testing, ci]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 454d2acee3d56f38f05af8617d7adb954b6294ae295402410765dda8d5e12954
status: stable
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
directly.

## Consuming the adapter as a built artifact

A site depends on its adapter through `workspace:*`, which pnpm links to
the adapter's `publishConfig.directory` — the adapter's **built** output
(`dist/dev/pkg` for the dev build), not `src/`. A fixture site therefore
exercises exactly the artifact that ships to real consumers: a build-only
break (a missing export condition, a wrong runtime path) shows up in a
fixture site rather than surfacing only downstream.

## Populating a model

Each site's `sites/*/lib/models/kitchensink/` (or equivalent per-module
directory) is populated by the corresponding fixture module's build via
`localPaths` — generated, gitignored, containing the `.api.json` trio,
`tsdoctor.json` and any published Open Graph image (see
[`fixture-modules.md`](fixture-modules.md)). The **root** `tsdoctor.json`
is the project tier every site's resolved bundle manifest flattens over.

## Commands

```bash
pnpm dev                    # start the basic site's dev server (default)
pnpm dev:<site>             # basic | versioned | i18n | multi | effect | vitepress-basic
pnpm preview:<site>         # same set
pnpm build:basic            # turbo run build:dev build:prod --filter=@sites/basic
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
