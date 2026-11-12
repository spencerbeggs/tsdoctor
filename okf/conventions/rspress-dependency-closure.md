---
type: Convention
title: Keep every adapter's dependency closure whole
description: "Every platforms/* adapter declares the full @effected closure, pinned catalog:effected:exact, and every @tsdoctor/* core package it consumes in dependencies, never as peers; never prune an entry as unused without checking."
generated:
  by: okfit/claude-code
  at: 2026-11-12T02:59:11Z
stale_after: 2026-12-23T00:00:00Z
tags: [compat, release, deps]
sources:
  - id: package-json
    resource: ../../platforms/rspress/package.json
  - id: vitepress-package-json
    resource: ../../platforms/vitepress/package.json
status: stable
integrity:
  generated:
    body: 5b50f5261f1601d5
---

# Keep every adapter's full closure in `dependencies`

Every adapter under `platforms/*` is an application, not a library. The
RSPress adapter (`../../platforms/rspress/package.json`[^package-json]) and
the VitePress adapter
(`../../platforms/vitepress/package.json`[^vitepress-package-json]) must each
list the following as ordinary `dependencies`, never as `peerDependencies`:

- The complete `@effected/*` closure of the core packages the adapter
  consumes, each as `catalog:effected:exact` (see
  `../decisions/adapter-kit-closure-pins.md`). That covers public-surface
  peers, internal-only dependencies, and every kit package reached through
  a range (a regular dependency or a required peer) at any depth,
  flattened: `commands`, `config-file`, `crypto`, `files`, `github`,
  `github-references`, `glob`, `images`, `jsonc`, `jwt`, `kit`, `manifest`,
  `markdown`, `npm`, `oidc`, `package-json`, `schema-org`, `semver`,
  `source`, `spdx`, `store`, `tsconfig-json`, `walker`, `xdg` and `yaml`.
  Most of the transitive entries are there only to hold an upstream caret
  to the adapter's pinned version; `config-file` is `@effected/xdg`'s peer.
  Packages reached only through exact upstream pins
  (`@effect/platform-node-shared`, `@effect/sql-sqlite-node`) are already
  sealed and must not be redeclared: a pin that disagrees with the
  upstream exact pin installs a second copy in consumers. `@effected/manifest` is the
  adapters' direct manifest dependency. The RSPress adapter
  also carries `memfs` as a runtime dependency: its `node-sync` subpath is
  the synchronous `FileSystem` the config helpers run bundle discovery on.
- `effect` and `@effect/platform-node`, also `catalog:effected:exact`.
- Every `@tsdoctor/*` core workspace it consumes, as `workspace:*`. That is
  seven for RSPress (`bundle`, `model`, `pages`, `registry`, `seo`,
  `snapshot`, `vfs`) and every one except `snapshot` for VitePress.

An adapter's only `peerDependencies` are its host framework:
`@rspress/core`, `react` and `react-dom` for RSPress, and `vitepress` for
VitePress. The core libraries follow the opposite rule, peering only on what
their public `.d.ts` surface exposes (see
`../decisions/core-peers-follow-public-surface.md`). The adapter is where
those peers finally get satisfied.

Do not prune an entry from this closure as "unused" without first checking
that it is genuinely unreferenced. Some entries are imported directly from
adapter source (`../../platforms/rspress/src/services/TypeRegistryService.ts`,
`../../platforms/rspress/src/config-helpers.ts`,
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

`effected package build` leaves `dependencies` external instead of
bundling them, for the RSPress adapter's per-file build
(`../../platforms/rspress/effected.toml`) and the VitePress adapter's
default build alike. A peer the adapter's manifest does not satisfy therefore
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
- Each adapter's `__test__/kit-closure-pins.test.ts` fails on a kit
  runtime dependency not spelled `catalog:effected:exact`, on any kit
  package reached through a range (at any depth) that the adapter does
  not declare, on an adapter pin that does not satisfy a published edge
  reaching it, and on a kit package resolving at two versions.
- `grep -c "workspace:\*" ../../platforms/rspress/package.json` should
  count seven `@tsdoctor/*` entries.
- Before removing any dependency entry, run
  `grep -rn "<package-name>" ../../platforms/<adapter>/src/` to confirm
  adapter source never references it. If the entry exists only to close
  the graph, also confirm that the peer it closes is still a real
  transitive peer of something that remains in `dependencies`.

[^package-json]: `../../platforms/rspress/package.json`
[^vitepress-package-json]: `../../platforms/vitepress/package.json`
