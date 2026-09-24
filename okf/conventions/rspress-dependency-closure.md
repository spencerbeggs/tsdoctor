---
type: Convention
title: Keep every adapter's dependency closure whole
description: "Every platforms/* adapter declares the full @effected closure and every @tsdoctor/* core package it consumes in dependencies, never as peers; never prune an entry as unused without checking."
generated:
  by: okfit/claude-code
  at: 2026-09-24T20:28:47Z
  body_sha256: 2c10b2652ec598245cf1ae38365c7188debe4a84f5cc6c311c1bfbe189120087
stale_after: 2026-12-23T00:00:00Z
tags: [compat, release, deps]
sources:
  - id: package-json
    resource: ../../platforms/rspress/package.json
  - id: vitepress-package-json
    resource: ../../platforms/vitepress/package.json
status: stable
---

# Keep every adapter's full closure in `dependencies`

Every adapter under `platforms/*` is an application, not a library. The
RSPress adapter (`../../platforms/rspress/package.json`[^package-json]) and
the VitePress adapter
(`../../platforms/vitepress/package.json`[^vitepress-package-json]) must each
list the following as ordinary `dependencies`, never as `peerDependencies`:

- The complete `@effected/*` closure of the core packages the adapter
  consumes, each as `catalog:effected`. That covers public-surface peers
  and internal-only dependencies alike: `github`, `glob`, `jsonc`,
  `markdown`, `npm`, `package-json`, `schema-org`, `semver`, `spdx`,
  `store`, `tsconfig-json`, `walker`, `xdg` and `yaml`.
- `effect` and `@effect/platform-node`.
- Every `@tsdoctor/*` core workspace it consumes, as `workspace:*`. That is
  all eight for RSPress (`bundle`, `manifest`, `model`, `pages`,
  `registry`, `seo`, `snapshot`, `vfs`) and every one except `snapshot` for
  VitePress.

An adapter's only `peerDependencies` are its host framework:
`@rspress/core`, `react` and `react-dom` for RSPress, and `vitepress` for
VitePress. The core libraries follow the opposite rule, peering only on what
their public `.d.ts` surface exposes (see
`../decisions/core-peers-follow-public-surface.md`). The adapter is where
those peers finally get satisfied.

Do not prune an entry from this closure as "unused" without first checking
that it is genuinely unreferenced. Some entries are imported directly from
adapter source (`../../platforms/rspress/src/services/TypeRegistryService.ts`,
`../../platforms/rspress/src/sync-node-fs.ts`,
`../../platforms/rspress/src/twoslash-transformer.ts`). The rest exist
only to keep the dependency graph closed, even though no adapter source
file imports them by name.

In the RSPress adapter, `mdast-util-from-markdown` stays a `devDependency`
only. `../../platforms/rspress/src/twoslash-transformer.ts` parses through
`@effected/markdown`'s `Markdown.parseResult` with `dialect: "commonmark"`,
not through this package, so it is needed only at test or build time.
`mdast-util-to-hast` stays a runtime dependency because `@effected/markdown`
deliberately leaves markdown-to-HTML conversion out of its own scope.

## Why

A per-file build (`../../platforms/rspress/savvy.build.ts`) leaves
`dependencies` external instead of bundling them. So does the VitePress
adapter's `@savvy-web/bundler` build
(`../../platforms/vitepress/savvy.build.ts`). A peer the adapter's manifest does not satisfy therefore
escapes to the consuming site, and pnpm's `autoInstallPeers` can bind
whatever version resolves first there, one the adapter was never built or
tested against. Closing the loop in each adapter's `package.json` makes the
adapter's own dependency versions the ones every consuming site actually
gets.

## How to check

- `pnpm peers check --json` should report zero missing, bad or conflicting
  peers across every workspace. A peer warning at install time for a
  package this convention says belongs in an adapter's `dependencies` is
  the failure signal.
- `jq -r '.dependencies | keys[]' platforms/*/package.json | grep @effected | sort | uniq -c`.
  Every `@effected` package the core closure reaches should appear once
  per adapter.
- `grep -c "workspace:\*" ../../platforms/rspress/package.json` should
  count eight `@tsdoctor/*` entries.
- Before removing any dependency entry, run
  `grep -rn "<package-name>" ../../platforms/<adapter>/src/` to confirm
  adapter source never references it. If the entry exists only to close
  the graph, also confirm that the peer it closes is still a real
  transitive peer of something that remains in `dependencies`.

[^package-json]: `../../platforms/rspress/package.json`
[^vitepress-package-json]: `../../platforms/vitepress/package.json`
