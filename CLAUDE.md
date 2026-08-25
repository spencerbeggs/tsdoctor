# CLAUDE.md

This file provides guidance to Claude Code when working with code in this
repository.

## Project Status

The tsdoctor monorepo: tools for generating API documentation from TypeScript
API Extractor models, organized into core `@tsdoctor/*` libraries
(`packages/*`), framework adapters (`platforms/*`), test fixture modules, and
documentation sites. Source repo: <https://github.com/spencerbeggs/tsdoctor>
(renamed from `spencerbeggs/rspress-plugin-api-extractor`, old URL redirects).
Roadmap phases 1–3 have landed, plus a pre-phase-4 adapter refactor. The npm
package name `rspress-plugin-api-extractor` is unchanged.

**Naming caution:** `packages/` = core `@tsdoctor/*` libraries; `platforms/` =
framework adapters (`platforms/rspress/` is the publishable
`rspress-plugin-api-extractor`); the repo-root `plugin/` folder is the
**api-docs Claude Code plugin** — not a pnpm workspace, not the RSPress
plugin. See [plugin/](#plugin-claude-code-plugin).

## Getting Started

```bash
pnpm install
pnpm run build            # Build packages + plugin + modules (not sites)
pnpm dev                  # Start basic site dev server
```

## Workspaces

Workspace globs (`pnpm-workspace.yaml`): `modules/*`, `packages/*`,
`platforms/*`, `sites/*`.

| Workspace | Package Name | Private | Purpose |
| --------- | ------------ | ------- | ------- |
| `platforms/rspress/` | `rspress-plugin-api-extractor` | Publishable | The RSPress adapter (main plugin) |
| `packages/registry/` | `@tsdoctor/registry` | Publishable | External type loading, VFS, Twoslash environments |
| `packages/model/` | `@tsdoctor/model` | Publishable | api.json loading, TSDoc extraction, routes, signatures, markdown rendering |
| `packages/bundle/` | `@tsdoctor/bundle` | Publishable | Bundle spec: `tsdoctor.json` manifest, provenance resolver, discovery, fetchers |
| `packages/snapshot/` | `@tsdoctor/snapshot` | Publishable | Incremental-build snapshot store (SQLite via `@effected/store`) + content hashing |
| `modules/kitchensink/` | `@modules/kitchensink` | Yes | Full API Extractor feature coverage |
| `modules/effect-kit/` | `@modules/effect-kit` | Yes | Effect-TS API patterns (Schema.Class, synthetic bases) |
| `modules/versioned-v1/` | `@modules/versioned-v1` | Yes | Version testing — v1 baseline |
| `modules/versioned-v2/` | `@modules/versioned-v2` | Yes | Version testing — v2 breaking changes |
| `sites/basic/` | `@sites/basic` | Yes | Single API, no versioning, no i18n |
| `sites/versioned/` | `@sites/versioned` | Yes | Single API + multiVersion |
| `sites/i18n/` | `@sites/i18n` | Yes | Single API + i18n |
| `sites/multi/` | `@sites/multi` | Yes | Multi-API portal |
| `sites/effect/` | `@sites/effect` | Yes | Effect-TS module documentation |

`pnpm --filter` matches the **package name**, not the folder. Filter the
plugin as `rspress-plugin-api-extractor` (or by path, `./platforms/rspress`).

### platforms/rspress/

The publishable plugin (`rspress-plugin-api-extractor`). Builds via
`build()` from `@savvy-web/rspress-builder`
(`platforms/rspress/savvy.build.ts`); the runtime is emitted bundleless
per-file under `dist/<mode>/pkg/runtime/` (see `platforms/rspress/CLAUDE.md`).
Depends on all four `@tsdoctor/*` core workspaces via `workspace:*`.
Exports three entry points:

- `.` — Main plugin (per-file output under `dist/<mode>/pkg/`)
- `./runtime` — React components for SSG-compatible rendering (bundleless per-file)
- `./tsconfig/rspress.json` — RSPress tsconfig that sites extend from

### packages/

Core `@tsdoctor/*` libraries, framework-neutral and publishable, versioned
via changesets on fresh 0.x lines. Purposes are in the workspace table above;
read each package's own `CLAUDE.md` before working in it.

**model** is the one to know: Effect v4 namespace modules (`Model`, `Tsdoc`,
`ApiItems`, `EntryPoints`, `Routes`, `SyntheticBases`, `Signature`, `Render`,
`CrossLinker`). `Routes.sanitizeId` is the **single** anchor algorithm —
`Routes.memberAnchors`/`memberRouteKeys` (and the `ApiItems` views of them)
own member anchors and cross-link keys. Never add a second spelling.

### plugin/ (Claude Code plugin)

The **api-docs Claude Code plugin** — not a pnpm workspace, not part of the
build. Ships skills, the `rspress-docs` agent, commands, hooks and monitors;
bats tests in `plugin/__test__/`. Load with `pnpm claude`
(`claude --plugin-dir=plugin`). See `plugin/CLAUDE.md`.

### modules/

Test fixture modules built with `defineBuild()` from `@savvy-web/bundler`
(`savvy.build.ts`), each producing dual output:

- `dist/dev/` — Development build with source maps
- `dist/prod/` — Production build with API Extractor model (`.api.json` under `dist/<mode>/meta/`)

**kitchensink** exercises every API Extractor item kind and exports a
`./testing` entry point for multi-entry testing. **versioned-v1/v2** are the
multiVersion pair: v1 baseline, v2 breaking changes.

### sites/

RSPress 2.0 documentation sites consuming the plugin with different
configurations (see the workspace table). Each depends on the plugin via
`workspace:*` plus one or more modules.

## Effect-TS Architecture

The plugin uses **Effect v4** (`effect@4.0.0-rc.109`, pinned through the
`catalog:effect` catalog) for all build orchestration. Key patterns:

- **Services** in the Layer stack, declared as
  `Context.Service<Self, Shape>()("id")`: `ConfigService`, `PluginConfig`,
  `HighlighterService`, `OgService`, `TwoslashEnvironments`,
  `TwoslashCacheService`, `TypeRegistryService`, `EventBus`, and
  `SnapshotService` (from `@tsdoctor/snapshot`)
- **Per-build `Context.Reference`s** in `src/BuildEnv.ts` (`BuildId`,
  `Thresholds`, `PageConcurrency`, `SuppressExampleErrors`)
- **Two `ManagedRuntime`s**: the main (async-to-build) one, plus a small
  `Layer.succeed`-only one for the sync-island event emitters
- **Stream pipeline** for concurrent page generation (`build-stages.ts`)
- **Effect Schema** for config validation (`src/schemas/`)
- **Core `effect` FileSystem** for cross-platform I/O, with
  `@effect/platform-node` supplying the Node implementation (`@effect/platform`
  merged into the core in v4)
- **Snapshot SQLite DB** behind `@tsdoctor/snapshot`'s `Store.layerSqlite`
  (`@effected/store`); the plugin no longer depends on
  `@effect/sql-sqlite-node` directly

See `platforms/rspress/CLAUDE.md` for detailed service layer documentation.
External type loading flows through the `@tsdoctor/registry` workspace,
model/TSDoc concerns through `@tsdoctor/model`, bundle discovery/fetching
through `@tsdoctor/bundle`, snapshot tracking through `@tsdoctor/snapshot`.

### @effected Distribution and Dogfooding

`@effected/*` packages are distributed through the `@effected/pnpm-plugin-effect`
config dependency declared in `pnpm-workspace.yaml` (`configDependencies:`). The
plugin supplies the pnpm catalogs: `catalog:effect` / `catalog:effect:peers` for
Effect-org packages (`effect`, `@effect/platform-node`, `@effect/sql-sqlite-node`,
…) and `catalog:effected` / `catalog:effected:peers` for `@effected/*` packages.

- Declare every `@effected/*` dependency in this repo as `"catalog:effected"`
  (`"catalog:effected:peers"` under `peerDependencies`). Never hand-pin an
  `@effected` version range.
- Upstream effected CI/CD bumps `@effected/pnpm-plugin-effect` in
  `pnpm-workspace.yaml` and handles the release train. A plugin release
  carries the whole `@effected` dependency/peer graph — never manage
  effected's internal dependency complexity by hand.
- To dogfood unreleased `@effected` work: add `overrides:` entries in
  `pnpm-workspace.yaml` pointing the tinkered packages — **and their peers** —
  at the local sibling `effected` checkout's built artifacts (`file:` links);
  build there, rebuild here. This flows through the `/silk:dogfood` protocol;
  a repo hook blocks pushes while `file:` overrides are linked.

## Design Documentation

Design docs live in `.claude/design/rspress-plugin-api-extractor/`. Load the
relevant doc for the area you touch:

**Build & infrastructure** — load when modifying Effect services, layers,
`Context.Reference`s, plugin lifecycle, or either `ManagedRuntime`:

- @./.claude/design/rspress-plugin-api-extractor/build-architecture.md
- @./.claude/design/rspress-plugin-api-extractor/snapshot-tracking-system.md

**Page generation & markdown** — load when modifying the Stream pipeline,
page generators, Shiki transformers, or cross-linking:

- @./.claude/design/rspress-plugin-api-extractor/page-generation-system.md
- @./.claude/design/rspress-plugin-api-extractor/cross-linking-architecture.md
- @./.claude/design/rspress-plugin-api-extractor/import-generation-system.md

**Runtime components & SSG** — load when modifying React components or
SSG-MD dual-mode rendering:

- @./.claude/design/rspress-plugin-api-extractor/component-development.md
- @./.claude/design/rspress-plugin-api-extractor/ssg-compatible-components.md

**Type loading, VFS & multi-entry points** — load when modifying Twoslash,
external package types, VFS generation, or multi-entry resolution:

- @./.claude/design/rspress-plugin-api-extractor/type-loading-vfs.md
- @./.claude/design/rspress-plugin-api-extractor/multi-entry-point-support.md
- @./.claude/design/rspress-plugin-api-extractor/multi-entry-resolution.md
- @./.claude/design/rspress-plugin-api-extractor/multi-entry-vfs.md

**LLMs integration** — load when modifying llms.txt post-processing,
per-package file generation, or scope-aware UI components:

- @./.claude/design/rspress-plugin-api-extractor/llms-integration.md

**Observability** — load when modifying Effect Metrics, logging, error
tracking, the progress heartbeat, or the `issues.json` artifact:

- @./.claude/design/rspress-plugin-api-extractor/performance-observability.md
- @./.claude/design/rspress-plugin-api-extractor/error-observability.md
- @./.claude/design/rspress-plugin-api-extractor/build-progress-and-issues.md
- @./.claude/design/rspress-plugin-api-extractor/render-phase-instrumentation.md

**Roadmap & @tsdoctor consolidation** — load when working on the road to
1.0.0 or the `@tsdoctor/*` package architecture (phases 1–3 and the
pre-phase-4 adapter refactor are executed; later phases are planned):

- @./.claude/design/rspress-plugin-api-extractor/roadmap-1.0.md
- @./.claude/design/rspress-plugin-api-extractor/tsdoctor-package-architecture.md
- @./.claude/design/rspress-plugin-api-extractor/monorepo-consolidation.md

## Build Pipeline

### How `private: true` Works

The source `package.json` in each publishable workspace (`platforms/rspress/`
and the four `packages/*`) is marked `"private": true` — **this
is intentional and correct**. `publishConfig` controls publishing; never
manually set `"private": false` in the source `package.json`. The savvy-web
builders transform `package.json` during build — set `"private": false` from
`publishConfig`, rewrite `exports`, and strip dev-only fields.

### Publish Targets

All five publishable workspaces publish to the **npm registry** only
(`publishConfig.targets` = `{ npm: true }`), with provenance attestation
enabled.

### Turbo Orchestration

[Turbo](https://turbo.build/) manages build task dependencies and caching:

- `build:dev` depends on `^build:dev` (upstream workspaces build first)
- `build:prod` depends on `types:check` and `build:dev`
- `types:check` depends on `^build:dev`
- The root `build` script runs `build:dev build:prod`; sites define only a
  `build` task, so they are excluded
- Environment pass-through: `GITHUB_ACTIONS`, `CI`

## Savvy-Web Tool References

These `@savvy-web/*` packages are in active development — if behavior seems
unexpected, explore both the GitHub docs and the installed source.

| Package | Purpose | GitHub | Local Source |
| ------- | ------- | ------ | ------------ |
| bundler | Build pipeline for modules (tsdown-based, dual output, package.json transform) | [savvy-web/bundler](https://github.com/savvy-web/bundler) | `modules/*/node_modules/@savvy-web/bundler/` |
| rspress-builder | RSPress-plugin build pipeline (built on bundler, runtime emission) | [savvy-web/rspress-builder](https://github.com/savvy-web/rspress-builder) | `platforms/rspress/node_modules/@savvy-web/rspress-builder/` |
| commitlint | Conventional commit + DCO enforcement | [savvy-web/commitlint](https://github.com/savvy-web/commitlint) | `node_modules/@savvy-web/commitlint/` |
| changesets | Versioning, changelogs, release management | [savvy-web/changesets](https://github.com/savvy-web/changesets) | `node_modules/@savvy-web/changesets/` |
| lint-staged | Pre-commit file linting via Biome | [savvy-web/lint-staged](https://github.com/savvy-web/lint-staged) | `node_modules/@savvy-web/lint-staged/` |
| vitest | Vitest config factory with project support | [savvy-web/vitest](https://github.com/savvy-web/vitest) | `node_modules/@savvy-web/vitest/` |

TypeScript configurations extend per workspace type:

- `platforms/rspress/` → `@savvy-web/rspress-builder/tsconfig/plugin.json`
- Core packages and modules → `@savvy-web/bundler/tsconfig/ecma.json`
- Sites → `rspress-plugin-api-extractor/tsconfig/rspress.json`
- Root → `@savvy-web/silk/tsconfig/node/root.json`

## Reference Repositories

Upstream source for the frameworks this plugin builds on is vendored under `.repos/` as shallow git submodules (sparse checkouts of source + official docs), each pinned to the installed version — treat them as the authority when framework behavior is unclear. Populate one with `git submodule update --init .repos/<name>`; `.repos/config.json` records each repo's `ref`, `purpose`, sparse paths, and an `orientation` map.

| Submodule | Pinned ref | Authority for |
| --------- | ---------- | ------------- |
| `.repos/rspress` | v2.0.17 | `@rspress/core` source + official plugin/config docs |
| `.repos/twoslash` | v0.3.9 | Twoslash engine + notation semantics |
| `.repos/shiki` | v4.3.1 | `@shikijs/twoslash` transformer + Shiki core |
| `.repos/rsbuild` | v2.1.5 | `@rsbuild/core` (bundler under RSPress) + official docs |
| `.repos/effect` | effect@4.0.0-rc.109 | Effect v4 core source + the `migration/` v3-to-v4 notes |

## Commands

Root scripts run across all workspaces; per-workspace commands via
`pnpm --filter <package-name> run <script>` (filters match package names, not
folder names).

### Development

```bash
pnpm run lint              # Check code with Biome
pnpm run lint:fix          # Auto-fix lint issues
pnpm run lint:fix:unsafe   # Auto-fix including unsafe transforms
pnpm run lint:md           # Check markdown with markdownlint
pnpm run lint:md:fix       # Auto-fix markdown issues
pnpm run typecheck         # Type-check all workspaces via Turbo (runs tsgo)
pnpm run test              # Run all tests
pnpm run test:watch        # Run tests in watch mode
pnpm run test:coverage     # Run tests with v8 coverage report
```

### Building

```bash
pnpm run build             # Build packages + plugin + modules via Turbo (excludes sites)
```

### Dev & Preview Servers

```bash
pnpm dev                   # Start basic site dev server (default)
pnpm dev:<site>            # basic | versioned | i18n | multi | effect
pnpm preview               # Preview basic site (default)
pnpm preview:<site>        # basic | versioned | i18n | multi | effect
```

### Per-Workspace Examples

```bash
pnpm --filter rspress-plugin-api-extractor run build:dev   # Build the plugin only
pnpm --filter @modules/kitchensink run build:dev           # Build the kitchensink module only
pnpm --filter @sites/basic run dev                         # Start basic site dev server
```

### Running a Specific Test

```bash
pnpm vitest run platforms/rspress/__test__/build-stages.test.ts
```

The `plugin/` Claude Code plugin is covered by bats, not Vitest:

```bash
bats plugin/__test__
```

## Code Quality and Hooks

### Biome

Unified linter/formatter. Configuration in `biome.jsonc` extends
`@savvy-web/silk/biome`.

### Commitlint

Enforces conventional commit format with DCO signoff. Configuration in
`lib/configs/commitlint.config.ts` uses the `CommitlintConfig.silk()` preset.

### Husky Git Hooks

| Hook | Action |
| ---- | ------ |
| `pre-commit` | Runs lint-staged (Biome on staged files) |
| `commit-msg` | Validates commit message format via commitlint |
| `post-commit` | Normalizes exec bits on `*.sh` files (savvy-hooks managed) |
| `post-checkout` | Package manager setup |
| `post-merge` | Package manager setup |

### Lint-Staged

Configuration in `lib/configs/lint-staged.config.ts` uses the `Preset.silk()`
preset from `@savvy-web/lint-staged`.

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins (e.g., `import fs from 'node:fs'`)
- Separate type imports: `import type { Foo } from './bar.js'`

### Commits

All commits require:

1. Conventional commit format (`feat`, `fix`, `chore`, etc.)
2. DCO signoff: `Signed-off-by: Name <email>`

### Publishing

Packages publish to npm with provenance via the
[@savvy-web/changesets](https://github.com/savvy-web/changesets) release
workflow. The GitHub Action is at
[savvy-web/silk-release-action](https://github.com/savvy-web/silk-release-action).

## Testing

- **Framework**: [Vitest](https://vitest.dev/) with v8 coverage provider
- **Pool**: Uses `forks` (not threads) for broader compatibility
- **Config**: `vitest.config.ts` uses the `VitestConfig.create()` factory from
  `@savvy-web/vitest`, which supports project-based filtering via `--project`
- **CI**: `pnpm run ci:test` sets `CI=true` and enables coverage
