---
type: Convention
title: "@effected is the foundation: check before hand-rolling"
description: "Check @effected/* before hand-rolling any capability; expand the kit through the dogfood loop when it lacks one."
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 78da30760fd38618d9b58df709ac9e15b5212c099fc7e79696cdaa9fba4ade7b
stale_after: 2026-12-12T00:00:00Z
tags: [dx, architecture]
sources:
  - id: root-claude
    resource: ../../CLAUDE.md
  - id: workspace
    resource: ../../pnpm-workspace.yaml
---

# Check @effected before hand-rolling any capability

Before implementing a capability — parsing or editing JSONC/YAML/TOML/Markdown, semver math, SPDX license expressions, an in-memory filesystem for tests, package.json or tsconfig.json handling, XDG directory resolution, SQLite-backed state or caching, schema.org vocabulary, and so on — check whether an `@effected/*` package already ships it. When the kit genuinely lacks a capability this repo needs, close the gap by expanding `@effected` itself through the dogfood loop (see `../runbooks/dogfood-effected-overrides.md`) — never by reimplementing the capability locally as a one-off helper.

Declare every `@effected/*` dependency as `"catalog:effected"` in `dependencies`, and `"catalog:effected:peers"` under `peerDependencies`. Never hand-pin an `@effected` package to a specific version range. Never manage the `@effected` dependency/peer graph by hand at all: upstream `effected` CI/CD bumps the `@effected/pnpm-plugin-effect` config dependency in `../../pnpm-workspace.yaml`, and a single plugin release carries the whole `@effected` graph forward together.

In tests, reach for `@effected/memfs` as the in-memory `FileSystem` implementation instead of hand-stubbing a filesystem layer.

## Why

Reimplementing a capability the kit already owns creates exactly the drift this consolidation exists to eliminate — a local mdast helper, a local semver comparator, a local XDG path — because each is one more copy to keep in step with the kit's own evolution. The dogfood loop turned several such gaps into permanent kit capabilities rather than permanent local code: MDX construction and serialization now live in `@effected/markdown` (including the MDX vocabulary the RSPress emitter serializes through); `Store.layerSqlite` gained option pass-through and `checkpointOnClose`; `Cache.degrading` replaced a hand-written degrade that had been absorbing interruption causes it should have re-raised; `@effected/schema-org` shipped its first release; and minimal inline escaping landed in `@effected/markdown`, letting both the RSPress and VitePress emitters delete their byte-parity shims.

Not every ask is granted, and a decline is also useful signal about where the boundary sits: per-node control of the presence-keyed MDX `{` escape stayed a kit invariant (the sanctioned raw-output hatch is an inline `Html` node, not a stringify option), and a programmatic-spelling input for `TsEnumCodec` was superseded by the `Schema.pick` seam built directly into `@tsdoctor/vfs` instead.

Each package's own dependency list documents which capability it draws from the kit — `@tsdoctor/vfs` uses `@effected/tsconfig-json` for its compiler-options seam; `@tsdoctor/registry` uses `semver`, `store` (`Cache`), and `xdg`; `@tsdoctor/model` uses `markdown` for TSDoc-to-mdast and `yaml` for frontmatter; `@tsdoctor/bundle` uses `package-json`, `tsconfig-json`, `github`, `npm`, `semver`, `store` plus `xdg`, `glob` / `walker`, and `jsonc`'s `JsoncFingerprint`; `@tsdoctor/snapshot` uses `store` and `jsonc`; `@tsdoctor/seo` uses `schema-org`, `package-json`'s `PackageManifest`, and `spdx`; `@tsdoctor/pages` uses `markdown` as its IR substrate.

## How to check

- `grep '"@effected/' <package>/package.json` to see what a workspace already declares, before adding a new one.
- Search the `effected` package index skill or its published docs for the capability by keyword before writing a parser, cache, or filesystem-path helper from scratch.
- `grep -n 'catalog:effected' -R packages/*/package.json platforms/*/package.json` should show every `@effected/*` entry using the catalog spelling — a bare semver range next to `@effected/` is the convention breaking.
- Confirm the config dependency itself is current: `configDependencies` in `../../pnpm-workspace.yaml` names the `@effected/pnpm-plugin-effect` version; it should track upstream releases rather than sit pinned indefinitely.
