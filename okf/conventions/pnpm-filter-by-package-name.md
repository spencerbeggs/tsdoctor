---
type: Convention
status: stable
title: "pnpm --filter matches the package name, not the workspace folder"
description: Filter by the name field in package.json (or a ./path), never by the directory name.
tags: [dx]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
integrity:
  generated:
    body: 29d19fd80b9a8028
---

# `pnpm --filter` matches the package **name**, not the folder

Always pass `pnpm --filter` the value of the target workspace's `name` field
in `package.json`, never the directory it lives in. The folder and the
package name diverge for both adapters — `platforms/rspress` publishes as
`rspress-plugin-api-extractor`[^1] and `platforms/vitepress` as
`vitepress-plugin-api-extractor`[^2] — and every `packages/*` core library
publishes under the `@tsdoctor/` scope while its folder carries the bare
name.

| Folder | Package name |
| --- | --- |
| `platforms/rspress/` | `rspress-plugin-api-extractor` |
| `platforms/vitepress/` | `vitepress-plugin-api-extractor` |
| `packages/vfs/` | `@tsdoctor/vfs` |
| `packages/registry/` | `@tsdoctor/registry` |
| `packages/model/` | `@tsdoctor/model` |
| `packages/manifest/` | `@tsdoctor/manifest` (deprecated) |
| `packages/bundle/` | `@tsdoctor/bundle` |
| `packages/snapshot/` | `@tsdoctor/snapshot` |
| `packages/seo/` | `@tsdoctor/seo` |
| `packages/pages/` | `@tsdoctor/pages` |
| `modules/kitchensink/` | `@modules/kitchensink` |
| `modules/effect-kit/` | `@modules/effect-kit` |
| `modules/versioned-v1/` | `@modules/versioned-v1` |
| `modules/versioned-v2/` | `@modules/versioned-v2` |
| `sites/basic/` | `@sites/basic` |
| `sites/versioned/` | `@sites/versioned` |
| `sites/i18n/` | `@sites/i18n` |
| `sites/multi/` | `@sites/multi` |
| `sites/effect/` | `@sites/effect` |
| `sites/vitepress-basic/` | `@sites/vitepress-basic` |

A path filter works too, and is the escape hatch when the name is not at
hand: `pnpm --filter ./platforms/rspress run build`.

## Why

pnpm resolves `--filter` against the workspace graph's package names, and
this repo's two adapters were deliberately kept under their historical npm
names (`rspress-plugin-api-extractor` predates the `platforms/` layout) while
every folder was renamed for clarity during the monorepo consolidation. A
directory-shaped guess — `pnpm --filter platforms/rspress` — silently
matches nothing and pnpm runs the script against zero packages without
erroring loudly enough to notice in a long command chain.

## How to check

```bash
pnpm --filter rspress-plugin-api-extractor run build   # correct
pnpm --filter ./platforms/rspress run build            # also correct
pnpm --filter platforms/rspress run build              # matches nothing
```

Confirm any package's real name with `cat <folder>/package.json | grep
'"name"'` before filtering by name.

[^1]: [platforms/rspress/package.json](../../platforms/rspress/package.json)
[^2]: [platforms/vitepress/package.json](../../platforms/vitepress/package.json)
