---
type: Module
title: The tsdoctor monorepo workspace
description: pnpm workspace root — task orchestration, dependency catalogs, code-quality hooks, release tooling and vendored reference repos.
kind: workspace
resource: ../..
tags: [architecture, dx, ci, release, compat]
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
status: stable
integrity:
  generated:
    body: 7a661c3413cab0a9
---

# The tsdoctor monorepo workspace

The repository root: not a publishable package, but the pnpm/turbo/husky
machinery every other Module in this bundle runs inside.

## Workspace layout

`pnpm-workspace.yaml` lists five package roots — `modules/*`, `packages/*`,
`platforms/*`, `plugin`, `sites/*`. `pnpm --filter` matches the package **name**, not
the folder path (see [`../conventions/pnpm-filter-by-package-name.md`](../conventions/pnpm-filter-by-package-name.md)).
The root itself (`package.json`) is `tsdoctor-monorepo`, private, and owns no
publishable surface of its own.

`pnpm install` then `pnpm run build` (builds packages, the adapters, the
`plugin/` agent plugin's committed Claude Code and Copilot builds, and
fixture modules — sites are excluded from the root build) get a checkout working.

## Turbo task graph

Every package, platform and fixture module builds through one `build`
script, `effected package build` (the bin from the root
`@effected/plugin` devDependency), optionally configured by an
`effected.toml` beside its `package.json`. It writes `dist/prod/npm/pkg`
(the publishable package), `dist/prod/npm/meta` (the API Extractor model
and `bundle.json`) and `dist/prod/issues.json`. There is no dev build.

`turbo.json` defines four tasks:

- `build` depends on `^build` and `types:check`, and writes
  `dist/prod/**`.
- `types:check` depends on `^types:check` and caches
  `dist/.tsbuildinfo.lib`. Workspace links resolve through `exports` to
  `src/`, so type-checking needs no upstream build.
- `dev` / `preview` are uncached, persistent tasks depending on `^build`,
  used by the fixture sites' dev servers.

A fixture site's own `turbo.json` makes its `build` depend on `^build`
plus the fixture module's `#build` that populates its models. The root
`build` script runs `turbo run build --filter=!@sites/*`, so the root
build never touches a site. `ci:build` explicitly filters both
`!@sites/*` and `!@modules/*`, so CI's unattended build path never builds
a fixture module or fixture site — see
[`../modules/fixture-sites.md`](fixture-sites.md) for what that means for
site coverage, and for the `effected-built` export condition the sites use
to load built output.

## Effect-TS foundation and the `@effected` catalogs

Everything in `packages/*` and `platforms/*` runs on Effect v4
(`effect@4.1.1` per `.repos/config.json`'s pin), never Effect v3 —
see [`../decisions/effect-v4-only.md`](../decisions/effect-v4-only.md).

`@effected/*` packages are distributed through the
`@effected/pnpm-plugin-effected` **config dependency** declared in
`pnpm-workspace.yaml`'s `configDependencies` block (alongside
`@savvy-web/pnpm-plugin-silk`), which supplies
one catalog, `catalog:effected`, for Effect-org and `@effected/*` packages
alike. A config dependency resolves before the rest of the workspace, which is what
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
The private `@tsdoctor/ai-plugins` workspace (`plugin/`) also versions on its
own changeset line, without publishing to npm; the release workflow's
on-build gate runs `pnpm plugin:check` so its committed builds cannot lag
their source — see
[`../decisions/agent-plugin-own-release-line.md`](../decisions/agent-plugin-own-release-line.md).

## TypeScript configuration per workspace type

- Core packages, both adapters and the fixture modules extend
  `@effected/plugin/tsconfig/ecma.json`.
- RSPress fixture sites extend `rspress-plugin-api-extractor/tsconfig/rspress.json`
  (the plugin's own published tsconfig entry point).
- The repo root extends `@savvy-web/silk/tsconfig/node/root.json`.

Packages and platforms stay on TypeScript 6 while the effected build
chain declares a TypeScript 7.1 peer; toolchain devDependencies come from
`catalog:effected:build` — see
[`../decisions/typescript-version-split.md`](../decisions/typescript-version-split.md).

## Testing

Vitest (v8 coverage, `forks` pool) is configured through
`vitest.config.ts`'s `VitestConfig.create()` from `@savvy-web/vitest`;
`--project` filters by workspace. `pnpm run ci:test` sets `CI=true` and
enables coverage. The `plugin/` agent plugin is covered by `bats`, not
Vitest — `pnpm test:bats` runs `bats --recursive plugin/__test__` (see
[`api-docs-agent-plugin.md`](api-docs-agent-plugin.md)).

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
