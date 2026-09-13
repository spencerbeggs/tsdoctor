---
type: Convention
title: Keep the RSPress adapter's dependency closure whole
description: Keep the full non-optional peer closure of the RSPress adapter in dependencies, not peerDependencies; never prune an entry as unused without checking.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 6bf13c8b93f9ad6c355e46da4d557373f4ac546a5a71b6b3de88d06e6a578d91
stale_after: 2026-12-12T00:00:00Z
tags: [compat, release]
sources:
  - id: package-json
    resource: ../../platforms/rspress/package.json
---

# Keep the RSPress adapter's non-optional peer closure in `dependencies`

`../../platforms/rspress/package.json` must list, as ordinary `dependencies` rather than `peerDependencies`, the full closure of every non-optional peer the adapter's own dependencies pull in: `ioredis` (a non-optional peer of `@effect/platform-node`), the complete `@effected/*` surface the eight `@tsdoctor/*` core workspaces ride on (each declared as `catalog:effected`, per `../conventions/effected-is-the-foundation.md`), and all eight `@tsdoctor/*` core workspaces themselves (`bundle`, `manifest`, `model`, `pages`, `registry`, `seo`, `snapshot`, `vfs`) as `workspace:*`. Only `@rspress/core`, `react`, and `react-dom` remain `peerDependencies` of the adapter.

Do not prune an entry from this closure as "unused" without checking it is genuinely unreferenced. Some entries are imported directly from adapter source (`../../platforms/rspress/src/services/TypeRegistryService.ts`, `../../platforms/rspress/src/sync-node-fs.ts`, `../../platforms/rspress/src/twoslash-transformer.ts`), while the rest exist purely to keep the dependency graph closed even though no adapter source file imports them by name.

`mdast-util-from-markdown` stays a `devDependency` only — `../../platforms/rspress/src/twoslash-transformer.ts` parses through `@effected/markdown`'s `Markdown.parseResult` with `dialect: "commonmark"` rather than this package, so it is a test-time or build-time need, not a runtime one. `mdast-util-to-hast` stays a runtime dependency because `@effected/markdown` deliberately keeps markdown-to-HTML conversion out of its own scope.

## Why

The plugin half of the adapter is built per file (`../../platforms/rspress/savvy.build.ts`), and a per-file build leaves `dependencies` external rather than bundling them. Any non-optional peer that is not itself declared in `dependencies` therefore escapes to whichever site consumes the plugin via `workspace:*`, where pnpm's `autoInstallPeers` behavior can bind an unpredictable version of that peer — a version the adapter was never built or tested against. Closing the loop in `platforms/rspress/package.json` is what makes the adapter's own dependency versions the ones every consuming site actually gets.

## How to check

- `pnpm ls --filter rspress-plugin-api-extractor --depth 0` (or the equivalent inside a fixture site under `sites/*`) shows what actually resolves; a peer warning at install time for a package this convention says should be a direct dependency is the failure signal.
- `grep -c "workspace:\*" ../../platforms/rspress/package.json` — the count of `@tsdoctor/*` entries should be eight.
- `grep '"ioredis"' ../../platforms/rspress/package.json` should find it under `dependencies`, not absent.
- Before removing any dependency entry: `grep -rn "<package-name>" ../../platforms/rspress/src/` to confirm it is truly unreferenced by adapter source before assuming it is closure-only, and if it is closure-only, confirm the peer it closes is still a real transitive peer of something still in `dependencies`.
