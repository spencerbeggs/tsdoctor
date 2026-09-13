---
type: Module
title: The tsdoctor monorepo workspace
description: pnpm workspace root — task orchestration, dependency catalogs, code-quality hooks, release tooling and vendored reference repos.
kind: workspace
resource: ../..
tags: [architecture, dx, ci, release, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 34dd0e4e5a647c39161ec8009f585e04237d2baf973dd1dbedf31698c74a8859
---

# The tsdoctor monorepo workspace

The repository root: not a publishable package, but the pnpm/turbo/husky
machinery every other Module in this bundle runs inside.

## Workspace layout

`pnpm-workspace.yaml` globs four package roots — `modules/*`, `packages/*`,
`platforms/*`, `sites/*`. `pnpm --filter` matches the package **name**, not
the folder path (see [`../conventions/pnpm-filter-by-package-name.md`](../conventions/pnpm-filter-by-package-name.md)).
The root itself (`package.json`) is `tsdoctor-monorepo`, private, and owns no
publishable surface of its own.

`pnpm install` then `pnpm run build` (builds packages, the `plugin/` Claude
Code plugin's dependents, and fixture modules — sites are excluded from the
root build) get a checkout working.

## Turbo task graph

`turbo.json` defines four tasks:

- `build:dev` depends on `^build:dev` (its own workspace dependencies must
  build first) and writes `dist/dev/**`.
- `build:prod` depends on `types:check` and `build:dev`, and writes
  `dist/prod/**`.
- `types:check` depends on `^build:dev` (a workspace can only type-check
  once everything it imports has emitted its dev build) and caches
  `dist/.tsbuildinfo.lib`.
- `dev` / `preview` are uncached, persistent tasks depending on `build:dev`,
  used by the fixture sites' dev servers.

The root `build` script runs `build:dev build:prod` through Turbo; fixture
sites define only a `build` script (not `build:dev`/`build:prod`), so
Turbo's root build never touches them. `ci:build` explicitly filters both
`!@sites/*` and `!@modules/*`, so CI's unattended build path never builds a
fixture module or fixture site — see
[`../modules/fixture-sites.md`](fixture-sites.md) for what that means for
site coverage.

## Effect-TS foundation and the `@effected` catalogs

Everything in `packages/*` and `platforms/*` runs on Effect v4
(`effect@4.0.0-rc.115` per `.repos/config.json`'s pin), never Effect v3 —
see [`../decisions/effect-v4-only.md`](../decisions/effect-v4-only.md).

`@effected/*` packages are distributed through the
`@effected/pnpm-plugin-effect` **config dependency** declared in
`pnpm-workspace.yaml`'s `configDependencies` block (alongside
`@savvy-web/pnpm-plugin-silk`), which supplies the pnpm catalogs
`catalog:effect` / `catalog:effect:peers` for Effect-org packages and
`catalog:effected` / `catalog:effected:peers` for `@effected/*` packages. A
config dependency resolves before the rest of the workspace, which is what
lets every `@tsdoctor/*` package pin through the catalog rather than a
hand-picked version range — see
[`../conventions/effected-is-the-foundation.md`](../conventions/effected-is-the-foundation.md)
for the rule this catalog exists to serve. Upstream `@effected` CI bumps the
plugin version, and a plugin release carries the whole `@effected`
dependency/peer graph at once; nobody in this repo hand-edits that graph.

Unreleased `@effected` work is dogfooded by pointing `overrides:` in
`pnpm-workspace.yaml` at a local sibling `effected` checkout's built
artifacts (`file:` links) — see
[`../runbooks/dogfood-effected-overrides.md`](../runbooks/dogfood-effected-overrides.md).
A repo hook blocks pushes while any `file:` override is linked.

## Vendored reference repos (`.repos/`)

`.repos/config.json` records, per submodule: the upstream `url`, the pinned
`ref`, `sparse` checkout paths and an `orientation` block (layout,
`startHere`, `keyPaths`). Six repos are vendored today — see
[`../interfaces/vendored-reference-repos.md`](../interfaces/vendored-reference-repos.md)
for the full table and the promise each pin makes. A submodule is populated
on demand with `git submodule update --init .repos/<name>`; re-pinning after
a dependency bump is a repeatable procedure — see
[`../runbooks/repin-vendored-repo.md`](../runbooks/repin-vendored-repo.md).

## Code quality and git hooks

- **Biome** (`biome.jsonc`, extending `@savvy-web/silk/biome`) is the
  linter/formatter. `pnpm run lint` / `lint:fix` / `lint:fix:unsafe` run it
  at the repo root; running Biome directly against a path bypasses the
  repo's own config and can touch `.repos/**` vendored submodules — see
  [`../conventions/never-hand-format.md`](../conventions/never-hand-format.md).
- **markdownlint** (`pnpm run lint:md`, config at
  `lib/configs/.markdownlint-cli2.jsonc`) lints every `.md`/`.mdx` file,
  including this bundle.
- **Commitlint** enforces Conventional Commits plus DCO signoff, configured
  through `lib/configs/commitlint.config.ts`'s `CommitlintConfig.silk()`
  preset.
- **Husky** git hooks: `pre-commit` runs lint-staged (Biome on staged
  files); `commit-msg` runs commitlint; `post-commit` normalizes the exec
  bit on `*.sh` files; `post-checkout` / `post-merge` set up the package
  manager.

## Release tooling

Publishable packages version via changesets on fresh 0.x lines, released
through the [`@savvy-web/changesets`](https://github.com/savvy-web/changesets)
workflow and [`savvy-web/silk-release-action`](https://github.com/savvy-web/silk-release-action).
Every publishable workspace's source `package.json` is `"private": true` —
`publishConfig` controls actual publishing — see
[`../conventions/private-true-publishconfig.md`](../conventions/private-true-publishconfig.md).

## TypeScript configuration per workspace type

- `platforms/rspress/` extends `@savvy-web/rspress-builder/tsconfig/plugin.json`.
- Core packages, fixture modules and `platforms/vitepress/` extend
  `@savvy-web/bundler/tsconfig/ecma.json`.
- RSPress fixture sites extend `rspress-plugin-api-extractor/tsconfig/rspress.json`
  (the plugin's own published tsconfig entry point).
- The repo root extends `@savvy-web/silk/tsconfig/node/root.json`.

## Testing

Vitest (v8 coverage, `forks` pool) is configured through
`vitest.config.ts`'s `VitestConfig.create()` from `@savvy-web/vitest`;
`--project` filters by workspace. `pnpm run ci:test` sets `CI=true` and
enables coverage. The `plugin/` Claude Code plugin is covered by `bats`, not
Vitest — `bats plugin/__test__` (see
[`api-docs-claude-plugin.md`](api-docs-claude-plugin.md)).

## Related concepts

- [`../decisions/consolidate-into-one-monorepo.md`](../decisions/consolidate-into-one-monorepo.md) —
  why the two former external packages moved into this workspace.
- [`../decisions/effect-v4-only.md`](../decisions/effect-v4-only.md)
- [`../conventions/effected-is-the-foundation.md`](../conventions/effected-is-the-foundation.md)
- [`../conventions/private-true-publishconfig.md`](../conventions/private-true-publishconfig.md)
- [`../conventions/pnpm-filter-by-package-name.md`](../conventions/pnpm-filter-by-package-name.md)
- [`../conventions/never-hand-format.md`](../conventions/never-hand-format.md)
- [`../runbooks/dogfood-effected-overrides.md`](../runbooks/dogfood-effected-overrides.md)
- [`../runbooks/repin-vendored-repo.md`](../runbooks/repin-vendored-repo.md)
- [`../interfaces/vendored-reference-repos.md`](../interfaces/vendored-reference-repos.md)
