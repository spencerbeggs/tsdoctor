# CLAUDE.md

This file provides guidance to Claude Code when working with code in this
repository.

## Project Status

The tsdoctor monorepo: tools for generating API documentation from TypeScript
API Extractor models, organized into core `@tsdoctor/*` libraries
(`packages/*`), framework adapters (`platforms/*`), test fixture modules, and
documentation sites. The source repository is
<https://github.com/spencerbeggs/tsdoctor> (renamed from
`spencerbeggs/rspress-plugin-api-extractor`; GitHub redirects the old URL);
phase 1 of the roadmap consolidation has landed. The npm package name
`rspress-plugin-api-extractor` is unchanged.

**Naming caution:** `packages/` = core `@tsdoctor/*` libraries; `platforms/` =
framework adapters (`platforms/rspress/` is the publishable
`rspress-plugin-api-extractor`; phase 5 adds `platforms/vitepress`); the
repo-root `plugin/` folder is the **api-docs Claude Code plugin** — not a pnpm
workspace, not the RSPress plugin. See
[plugin/](#plugin-claude-code-plugin).

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
| `packages/model/` | `@tsdoctor/model` | Publishable | Pure api.json loading, TSDoc extraction, formatting, markdown rendering |
| `modules/kitchensink/` | `@modules/kitchensink` | Yes | Full API Extractor feature coverage |
| `modules/effect-kit/` | `@modules/effect-kit` | Yes | Effect-TS API patterns (Schema.Class, synthetic bases, companion namespaces) |
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
Depends on `@tsdoctor/registry` and `@tsdoctor/model` via `workspace:*` (the
old npm deps `type-registry-effect` and `api-extractor-llms` are gone).
Exports three entry points:

- `.` — Main plugin (per-file output under `dist/<mode>/pkg/`)
- `./runtime` — React components for SSG-compatible rendering, bundleless per-file under `dist/<mode>/pkg/runtime/`
- `./tsconfig/rspress.json` — RSPress tsconfig that sites extend from (`platforms/rspress/public/tsconfig/rspress.json`)

### packages/

Core `@tsdoctor/*` libraries, framework-neutral and publishable, moved in
during phase 1 of the consolidation with no behavior change:

**registry** — `@tsdoctor/registry`, the renamed
`type-registry-effect@2.3.5` (same API; its `Context.Service` tag id strings
still read `type-registry-effect/...` deliberately). See
`packages/registry/CLAUDE.md`.

**model** — `@tsdoctor/model`, seeded from the dissolved
`api-extractor-llms`; deps only `@microsoft/api-extractor-model` +
`@microsoft/tsdoc`. See `packages/model/CLAUDE.md`.

Both start fresh at 0.x, versioned via changesets.

### plugin/ (Claude Code plugin)

The **api-docs Claude Code plugin** — a stub, not a pnpm workspace and not part
of the build. Ships a `.claude-plugin/plugin.json` manifest and a SessionStart
orientation hook (`hooks/`); bats tests live in `plugin/__test__/`. Load it with
`pnpm claude` (`claude --plugin-dir=plugin`). See `plugin/CLAUDE.md`.

### modules/

Test fixture modules using `defineBuild()` from `@savvy-web/bundler`
(`savvy.build.ts`) to build demo TypeScript libraries. Each produces dual
outputs:

- `dist/dev/` — Development build with source maps
- `dist/prod/` — Production build with API Extractor model (`.api.json` under `dist/<mode>/meta/`)

**kitchensink** — Comprehensive module exercising all API Extractor item kinds
(classes, interfaces, enums, functions, type aliases, variables, namespaces).
Exports a `./testing` entry point for multi-entry point documentation testing.

**versioned-v1 / versioned-v2** — Paired modules for testing multiVersion
documentation. v1 provides a baseline API; v2 introduces breaking changes.

### sites/

RSPress 2.0 documentation sites that consume the plugin with different
configurations (see the workspace table for what each exercises). Each site
depends on `rspress-plugin-api-extractor` via `workspace:*` and one or more
modules.

## Effect-TS Architecture

The plugin uses **Effect v4** (`effect@4.0.0-rc.109`, pinned through the
`catalog:effect` catalog) for all build orchestration. Key patterns:

- **Services** in the Layer stack, declared as
  `Context.Service<Self, Shape>()("id")`: `ConfigService`, `SnapshotService`,
  `TypeRegistryService`, `PathDerivationService`
- **Stream pipeline** for concurrent page generation (`build-stages.ts`)
- **Effect Schema** for config validation (`src/schemas/`)
- **Core `effect` FileSystem** for cross-platform I/O, with
  `@effect/platform-node` supplying the Node implementation (`@effect/platform`
  merged into the core in v4)
- **`@effect/sql-sqlite-node`** over `effect/unstable/sql` for snapshot
  tracking DB (`@effect/sql` also merged into the core)

See `platforms/rspress/CLAUDE.md` for detailed service layer documentation.
External type loading flows through the `@tsdoctor/registry` workspace,
model/TSDoc concerns through `@tsdoctor/model`.

### @effected Distribution and Dogfooding

`@effected/*` packages are distributed through the `@effected/pnpm-plugin-effect`
config dependency declared in `pnpm-workspace.yaml` (`configDependencies:`). The
plugin supplies the pnpm catalogs: `catalog:effect` / `catalog:effect:peers` for
Effect-org packages (`effect`, `@effect/platform-node`, `@effect/sql-sqlite-node`,
…) and `catalog:effected` / `catalog:effected:peers` for `@effected/*` packages.

- Declare every `@effected/*` dependency in this repo as `"catalog:effected"`
  (`"catalog:effected:peers"` under `peerDependencies`). Never hand-pin an
  `@effected` version range.
- Upstream effected CI/CD bumps the `@effected/pnpm-plugin-effect` version in
  this repo's `pnpm-workspace.yaml`, builds, tests, verifies peer-dependency
  integrity, and handles changesets/deployment. A plugin release carries the
  whole `@effected` dependency/peer graph — never manage effected's internal
  dependency complexity by hand.
- To dogfood unreleased `@effected` work: add `overrides:` entries in
  `pnpm-workspace.yaml` pointing the tinkered packages — **and their peers** —
  at the local sibling `effected` checkout's built artifacts (`file:` links);
  build there, rebuild here. This flows through the `/silk:dogfood` protocol;
  a repo hook blocks pushes while `file:` overrides are linked.

## Design Documentation

Design docs live in `.claude/design/rspress-plugin-api-extractor/`. Load the
relevant doc when working on these areas:

**Build & infrastructure** — load when modifying Effect services, layers,
plugin lifecycle, or ManagedRuntime:

- @./.claude/design/rspress-plugin-api-extractor/build-architecture.md
- @./.claude/design/rspress-plugin-api-extractor/snapshot-tracking-system.md

**Page generation & markdown** — load when modifying the Stream pipeline,
page generators, Shiki transformers, or cross-linking:

- @./.claude/design/rspress-plugin-api-extractor/page-generation-system.md
- @./.claude/design/rspress-plugin-api-extractor/cross-linking-architecture.md
- @./.claude/design/rspress-plugin-api-extractor/import-generation-system.md
- @./.claude/design/rspress-plugin-api-extractor/source-mapping-system.md

**Runtime components & SSG** — load when modifying React components or
SSG-MD dual-mode rendering:

- @./.claude/design/rspress-plugin-api-extractor/component-development.md
- @./.claude/design/rspress-plugin-api-extractor/ssg-compatible-components.md

**Type loading, VFS & multi-entry points** — load when modifying Twoslash,
external package types, virtual file system generation, or multi-entry point
resolution in the doc generation pipeline:

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

**Roadmap & @tsdoctor consolidation (planned, not current state)** — load when
working on the road to 1.0.0, the `@tsdoctor/*` package split, or the
monorepo consolidation; these docs describe planned architecture, not the
current implementation:

- @./.claude/design/rspress-plugin-api-extractor/roadmap-1.0.md
- @./.claude/design/rspress-plugin-api-extractor/tsdoctor-package-architecture.md
- @./.claude/design/rspress-plugin-api-extractor/monorepo-consolidation.md

## Build Pipeline

### How `private: true` Works

The source `package.json` in each publishable workspace (`platforms/rspress/`,
`packages/registry/`, `packages/model/`) is marked `"private": true` — **this
is intentional and correct**. `publishConfig` controls publishing; never
manually set `"private": false` in the source `package.json`. The savvy-web
builders transform `package.json` during build — set `"private": false` from
`publishConfig`, rewrite `exports`, and strip dev-only fields.

### Publish Targets

All three publishable workspaces publish to the **npm registry** only
(`publishConfig.targets` = `{ npm: true }`), with provenance attestation
enabled.

### Turbo Orchestration

[Turbo](https://turbo.build/) manages build task dependencies and caching:

- `build:dev` depends on `^build:dev` (upstream workspaces build first)
- `build:prod` depends on `types:check` and `build:dev`
- `types:check` depends on `^build:dev`
- The root `build` script runs `build:dev build:prod` unfiltered; sites are
  excluded because they define only a `build` task, not `build:dev`/`build:prod`
- Environment pass-through: `GITHUB_ACTIONS`, `CI`

## Savvy-Web Tool References

This project depends on several `@savvy-web/*` packages. These are in active
development — if behavior seems unexpected, explore both the GitHub docs and the
installed source.

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

Upstream source for the frameworks this plugin builds on is vendored under `.repos/` as pinned, shallow git submodules (sparse checkouts of source + official docs), each pinned to the installed version — treat them as the authority when framework behavior is unclear. Populate one with `git submodule update --init .repos/<name>`; `.repos/config.json` records each repo's `ref`, `purpose`, sparse paths, and an `orientation` map.

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
pnpm --filter @sites/basic run preview                     # Preview basic site production build
```

### Running a Specific Test

```bash
pnpm vitest run platforms/rspress/__test__/build-stages.test.ts
```

The `plugin/` Claude Code plugin's hooks are covered by bats, not Vitest:

```bash
bats plugin/__test__
```

## Code Quality and Hooks

### Biome

Unified linter and formatter replacing ESLint + Prettier. Configuration in
`biome.jsonc` extends `@savvy-web/silk/biome`.

### Commitlint

Enforces conventional commit format with DCO signoff. Configuration in
`lib/configs/commitlint.config.ts` uses the `CommitlintConfig.silk()` preset.

### Husky Git Hooks

| Hook | Action |
| ---- | ------ |
| `pre-commit` | Runs lint-staged (Biome on staged files) |
| `commit-msg` | Validates commit message format via commitlint |
| `pre-push` | Runs tests for affected packages using Turbo |
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
