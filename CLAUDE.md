# CLAUDE.md

This file provides guidance to Claude Code when working with code in this
repository.

## Project Status

The tsdoctor monorepo: tools for generating API documentation from TypeScript
API Extractor models, organized into core `@tsdoctor/*` libraries
(`packages/*`), framework adapters (`platforms/*`), test fixture modules, and
documentation sites. Source repo: <https://github.com/spencerbeggs/tsdoctor>.
Roadmap phases 1–4 have landed; phase 5's `@tsdoctor/pages` IR and the
VitePress adapter alpha landed on `feat/phase-5`. The npm package name
`rspress-plugin-api-extractor` is unchanged.

**Naming caution:** the repo-root `plugin/` folder is the **api-docs Claude
Code plugin** — not a pnpm workspace, not the RSPress plugin (that is
`platforms/rspress/`). See [plugin/](#plugin-claude-code-plugin).

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
| `platforms/vitepress/` | `vitepress-plugin-api-extractor` | Publishable | The VitePress 2.x adapter: markdown-only alpha, awaited `apiExtractor()` config helper, native `@shikijs/vitepress-twoslash` |
| `packages/vfs/` | `@tsdoctor/vfs` | Publishable | VFS primitives: `Vfs`, `VirtualPackage`, `TsEnvironment`, the compiler-options seam |
| `packages/registry/` | `@tsdoctor/registry` | Publishable | External type loading: fetch, cache and resolve package types into a `Vfs` |
| `packages/model/` | `@tsdoctor/model` | Publishable | api.json loading, TSDoc extraction, routes, signatures, `.d.ts` reconstruction, frontmatter, markdown rendering |
| `packages/manifest/` | `@tsdoctor/manifest` | Publishable | The `tsdoctor.json` spec-1 sidecar manifest: schema, `encodeBundleManifest` / `decodeBundleManifest` boundaries and the `ManifestSource` authoring-file shape |
| `packages/bundle/` | `@tsdoctor/bundle` | Publishable | Bundle spec: `tsdoctor.json` manifest, provenance resolver, discovery, fetchers |
| `packages/snapshot/` | `@tsdoctor/snapshot` | Publishable | Incremental-build snapshot store (SQLite via `@effected/store`) + content hashing |
| `packages/seo/` | `@tsdoctor/seo` | Publishable | Framework-neutral `<head>` metadata: `HeadTag`, canonical, OG/Twitter, attribution, JSON-LD |
| `packages/pages/` | `@tsdoctor/pages` | Publishable | Framework-neutral page IR: block vocabulary, `ApiItem` → `Page` builders, navigation tree, example preparation, plain-markdown emitter, llms.txt text transforms |
| `modules/kitchensink/` | `@modules/kitchensink` | Yes | Full API Extractor feature coverage |
| `modules/effect-kit/` | `@modules/effect-kit` | Yes | Effect-TS API patterns (Schema.Class, synthetic bases) |
| `modules/versioned-v1/` | `@modules/versioned-v1` | Yes | Version testing — v1 baseline |
| `modules/versioned-v2/` | `@modules/versioned-v2` | Yes | Version testing — v2 breaking changes |
| `sites/basic/` | `@sites/basic` | Yes | Single API, no versioning, no i18n |
| `sites/versioned/` | `@sites/versioned` | Yes | Single API + multiVersion |
| `sites/i18n/` | `@sites/i18n` | Yes | Single API + i18n |
| `sites/multi/` | `@sites/multi` | Yes | Multi-API portal |
| `sites/effect/` | `@sites/effect` | Yes | Effect-TS module documentation |
| `sites/vitepress-basic/` | `@sites/vitepress-basic` | Yes | VitePress fixture over the kitchensink bundle |

`pnpm --filter` matches the **package name**, not the folder. Filter the
adapters as `rspress-plugin-api-extractor` / `vitepress-plugin-api-extractor`
(or by path, `./platforms/rspress`).

### platforms/rspress/

The publishable plugin (`rspress-plugin-api-extractor`). Builds via
`build()` from `@savvy-web/rspress-builder`
(`platforms/rspress/savvy.build.ts`); the runtime is emitted bundleless
per-file under `dist/<mode>/pkg/runtime/` (see `platforms/rspress/CLAUDE.md`).
Depends on all seven `@tsdoctor/*` core workspaces via `workspace:*`.
Exports three entry points:

- `.` — Main plugin (per-file output under `dist/<mode>/pkg/`)
- `./runtime` — React components for SSG-compatible rendering (bundleless per-file)
- `./tsconfig/rspress.json` — RSPress tsconfig that sites extend from

### platforms/vitepress/

The VitePress adapter (`vitepress-plugin-api-extractor`), the second
consumer of `@tsdoctor/pages`. One helper, `apiExtractor()`, awaited by a
site's `docs/.vitepress/config.mts`: generates markdown pages under `docs/`
and returns the sidebar, the Twoslash code transformer and a `buildEnd` hook.
No Vue components. See `platforms/vitepress/CLAUDE.md`.

### packages/

Core `@tsdoctor/*` libraries, framework-neutral and publishable, versioned
via changesets on fresh 0.x lines. Purposes are in the workspace table above;
read each package's own `CLAUDE.md` before working in it.

**model**: Effect v4 namespace modules (`Model`, `Tsdoc`,
`ApiItems`, `EntryPoints`, `Routes`, `SyntheticBases`, `Signature`, `Render`,
`CrossLinker`) plus `ApiExtractedPackage`, `TypeReferenceExtractor` and the
`Frontmatter` contract.
`Routes.sanitizeId` is the **single** anchor algorithm —
`Routes.memberAnchors`/`memberRouteKeys` (and the `ApiItems` views of them)
own member anchors and cross-link keys. Never add a second spelling.

**vfs** is the substrate **registry** and **model** share so neither depends on
the other: the `Vfs` currency type, `VirtualPackage`, `TsEnvironment`, the
compiler-options seam and the Twoslash result cache both adapters warm.
`typescript`, `@typescript/vfs` and `@shikijs/twoslash` are optional peers
there and nowhere else in the core.

**manifest** depends on `effect` alone so a bundler can write `tsdoctor.json`
through it without the bundle package's fetch and cache stack; **bundle**
depends on it and re-exports every manifest name, so readers in this repo
import from `@tsdoctor/bundle`.

**seo** owns every `<head>` concern behind one seam, `Seo.headTags(input)`,
returning a neutral `HeadTag[]` an adapter merely renders. The package decides
WHICH tags a page gets; adapters never compose their own. Schema.org derivation
lives here, not in **model** — the model's `StructuredData` stub is deleted.

**pages** is the IR adapters emit over: `prepareWorkItems` turns a model
into per-API work items plus the route map (uncategorized items and route
collisions returned as data); `buildPage` lifts an `ApiItem` into a `Page`
(facts, required `kind`, typed blocks, nav entry); `buildNav` builds the
sidebar tree. Emitters (`platforms/*/src/emit/`) render — never recompute
anchors, routes or display/source code.

### plugin/ (Claude Code plugin)

The **api-docs Claude Code plugin** — not a pnpm workspace, not part of the
build. Ships skills, the `rspress-docs` agent, commands, hooks and monitors;
bats tests in `plugin/__test__/`. Load with `pnpm claude`. See
`plugin/CLAUDE.md`.

### modules/

Test fixture modules built with `defineBuild()` from `@savvy-web/bundler`
(`savvy.build.ts`), producing `dist/dev/` (source maps) and `dist/prod/`
(API Extractor model, `.api.json` under `dist/<mode>/meta/`).
**kitchensink** also exports a `./testing` entry point for multi-entry testing.

### sites/

RSPress 2.0 sites consuming the plugin via `workspace:*` plus one or more
modules (configurations in the workspace table). `sites/vitepress-basic/` is
the VitePress 2 fixture, populated by kitchensink's `localPaths` like
`sites/basic/`.

## Effect-TS Architecture

Everything runs on **Effect v4** (`effect@4.0.0-rc.109`, pinned through the
`catalog:effect` catalog). Key patterns in the RSPress adapter:

- **Services** declared as `Context.Service<Self, Shape>()("id")`, each
  owning its layer as a static (inventory in
  `platforms/rspress/CLAUDE.services.md`)
- **Per-build `Context.Reference`s** in `src/BuildEnv.ts`
- **Two `ManagedRuntime`s**: the main (async-to-build) one, plus a
  `Layer.succeed`-only one for the sync-island event emitters
- **Stream pipeline** for concurrent page generation (`build-stages.ts`)
- **Effect Schema** for config validation (`src/schemas/`)
- **Core `effect` FileSystem** for I/O, `@effect/platform-node` for Node
- **Snapshot SQLite DB** behind `@tsdoctor/snapshot` (`@effected/store`)

### @effected Distribution and Dogfooding

`@effected/*` packages are distributed through the `@effected/pnpm-plugin-effect`
config dependency in `pnpm-workspace.yaml` (`configDependencies:`), which
supplies the pnpm catalogs: `catalog:effect` / `catalog:effect:peers` for
Effect-org packages and `catalog:effected` / `catalog:effected:peers` for
`@effected/*`.

- Declare every `@effected/*` dependency in this repo as `"catalog:effected"`
  (`"catalog:effected:peers"` under `peerDependencies`). Never hand-pin an
  `@effected` version range.
- Upstream effected CI/CD bumps `@effected/pnpm-plugin-effect`; a plugin
  release carries the whole `@effected` dependency/peer graph — never manage
  that graph by hand.
- To dogfood unreleased `@effected` work: add `overrides:` in
  `pnpm-workspace.yaml` pointing the tinkered packages — **and their peers** —
  at the local sibling `effected` checkout's built artifacts (`file:` links).
  This is the `/silk:dogfood` protocol; a repo hook blocks pushes while
  `file:` overrides are linked.

## Design Documentation

Design docs live in `.claude/design/rspress-plugin-api-extractor/`. Load the
relevant doc for the area you touch:

**Build & infrastructure** — load when modifying services, layers,
`Context.Reference`s, either `ManagedRuntime`, hook lifecycle, config
resolution, or the build script:

- @./.claude/design/rspress-plugin-api-extractor/build-architecture.md
- @./.claude/design/rspress-plugin-api-extractor/effect-service-layer.md
- @./.claude/design/rspress-plugin-api-extractor/plugin-lifecycle.md
- @./.claude/design/rspress-plugin-api-extractor/configuration-system.md
- @./.claude/design/rspress-plugin-api-extractor/build-tooling.md
- @./.claude/design/rspress-plugin-api-extractor/snapshot-tracking-system.md

**Page generation & markdown** — load when modifying the Stream pipeline,
Shiki transformers, or cross-linking:

- @./.claude/design/rspress-plugin-api-extractor/page-generation-system.md
- @./.claude/design/rspress-plugin-api-extractor/cross-linking-architecture.md
- @./.claude/design/rspress-plugin-api-extractor/import-generation-system.md

**Page IR & emitters** — load when modifying `@tsdoctor/pages` blocks or
builders, either adapter's `src/emit/` emitters, or the golden-file gate:

- @./.claude/design/rspress-plugin-api-extractor/doc-ir-and-pages.md
- @./.claude/design/rspress-plugin-api-extractor/rspress-mdx-emitter.md
- @./.claude/design/rspress-plugin-api-extractor/vitepress-adapter.md

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

**SEO & head metadata** — load when modifying canonical URLs, Open Graph,
Twitter cards, attribution, or schema.org JSON-LD:

- @./.claude/design/rspress-plugin-api-extractor/structured-data-and-og.md

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
1.0.0 or the `@tsdoctor/*` package architecture:

- @./.claude/design/rspress-plugin-api-extractor/roadmap-1.0.md
- @./.claude/design/rspress-plugin-api-extractor/tsdoctor-package-architecture.md
- @./.claude/design/rspress-plugin-api-extractor/monorepo-consolidation.md

## Build Pipeline

### `private: true` and Publish Targets

Every publishable workspace's source `package.json` is `"private": true` —
**intentional**. `publishConfig` controls publishing (npm only, with
provenance); never set `"private": false` in the source manifest — the
builders transform `package.json` during build.

### Turbo Orchestration

[Turbo](https://turbo.build/) manages task dependencies and caching:

- `build:dev` depends on `^build:dev`; `build:prod` on `types:check` and
  `build:dev`; `types:check` on `^build:dev`
- The root `build` script runs `build:dev build:prod`; sites define only a
  `build` task, so they are excluded
- Environment pass-through: `GITHUB_ACTIONS`, `CI`

## Savvy-Web Tool References

These `@savvy-web/*` packages are in active development — when behavior seems
unexpected, read the installed source under `node_modules/@savvy-web/`.

| Package | Purpose | GitHub |
| ------- | ------- | ------ |
| bundler | Build pipeline for modules (tsdown-based, dual output, package.json transform) | [savvy-web/bundler](https://github.com/savvy-web/bundler) |
| rspress-builder | RSPress-plugin build pipeline (built on bundler, runtime emission) | [savvy-web/rspress-builder](https://github.com/savvy-web/rspress-builder) |
| commitlint | Conventional commit + DCO enforcement | [savvy-web/commitlint](https://github.com/savvy-web/commitlint) |
| changesets | Versioning, changelogs, release management | [savvy-web/changesets](https://github.com/savvy-web/changesets) |
| lint-staged | Pre-commit file linting via Biome | [savvy-web/lint-staged](https://github.com/savvy-web/lint-staged) |
| vitest | Vitest config factory with project support | [savvy-web/vitest](https://github.com/savvy-web/vitest) |

TypeScript configurations extend per workspace type:

- `platforms/rspress/` → `@savvy-web/rspress-builder/tsconfig/plugin.json`
- Core packages, modules and `platforms/vitepress/` →
  `@savvy-web/bundler/tsconfig/ecma.json`
- RSPress sites → `rspress-plugin-api-extractor/tsconfig/rspress.json`
- Root → `@savvy-web/silk/tsconfig/node/root.json`

## Reference Repositories

Upstream framework source is vendored under `.repos/` as sparse, shallow git submodules pinned to the installed version — the authority when framework behavior is unclear. Populate one with `git submodule update --init .repos/<name>`; `.repos/config.json` records each `ref`, sparse paths and orientation.

| Submodule | Pinned ref | Authority for |
| --------- | ---------- | ------------- |
| `.repos/rspress` | v2.0.17 | `@rspress/core` source + official plugin/config docs |
| `.repos/twoslash` | v0.3.9 | Twoslash engine + notation semantics |
| `.repos/shiki` | v4.4.3 | `@shikijs/twoslash` transformer, `@shikijs/vitepress-twoslash` + Shiki core |
| `.repos/rsbuild` | v2.1.5 | `@rsbuild/core` (bundler under RSPress) + official docs |
| `.repos/effect` | effect@4.0.0-rc.109 | Effect v4 core source + the `migration/` v3-to-v4 notes |
| `.repos/vitepress` | v2.0.0-alpha.19 | VitePress 2.x source (`src/node` hooks + `codeTransformers`) + `docs/en` |

## Commands

Per-workspace commands: `pnpm --filter <package-name> run <script>`.

### Development

```bash
pnpm run lint              # Biome (`:fix`, `:fix:unsafe` variants)
pnpm run lint:md           # markdownlint (`:fix` variant)
pnpm run typecheck         # All workspaces via Turbo (runs tsgo)
pnpm run test              # All tests (`:watch`, `:coverage` variants)
```

### Building

```bash
pnpm run build             # Build packages + plugin + modules via Turbo (excludes sites)
pnpm build:vitepress-basic # Build the VitePress fixture site (also build:basic, build:multi)
```

### Dev & Preview Servers

```bash
pnpm dev                   # Start basic site dev server (default)
pnpm dev:<site>            # basic | versioned | i18n | multi | effect | vitepress-basic
pnpm preview               # Preview basic site (default)
pnpm preview:<site>        # basic | versioned | i18n | multi | effect | vitepress-basic
```

### Per-Workspace Examples

```bash
pnpm --filter rspress-plugin-api-extractor run build:dev  # plugin only
pnpm --filter @sites/basic run dev                        # one site's dev server
pnpm vitest run platforms/rspress/__test__/build-stages.test.ts
```

The `plugin/` Claude Code plugin is covered by bats, not Vitest:

```bash
bats plugin/__test__
```

## Code Quality and Hooks

### Biome

Linter/formatter; `biome.jsonc` extends `@savvy-web/silk/biome`.

### Commitlint

Conventional commits + DCO signoff; `lib/configs/commitlint.config.ts` uses
the `CommitlintConfig.silk()` preset.

### Husky Git Hooks

`pre-commit` runs lint-staged (Biome on staged files); `commit-msg` runs
commitlint; `post-commit` normalizes exec bits on `*.sh` files;
`post-checkout` / `post-merge` set up the package manager.

## Conventions

### Imports

- Use `.js` extensions for relative imports (ESM requirement)
- Use `node:` protocol for Node.js built-ins (e.g., `import fs from 'node:fs'`)
- Separate type imports: `import type { Foo } from './bar.js'`

### Commits and Publishing

Conventional commit format plus DCO signoff (`Signed-off-by: Name <email>`).
Packages publish via the
[@savvy-web/changesets](https://github.com/savvy-web/changesets) release
workflow and
[savvy-web/silk-release-action](https://github.com/savvy-web/silk-release-action).

## Testing

- **Framework**: [Vitest](https://vitest.dev/), v8 coverage, `forks` pool
- **Config**: `vitest.config.ts` uses `VitestConfig.create()` from
  `@savvy-web/vitest`; filter by workspace with `--project`
- **CI**: `pnpm run ci:test` sets `CI=true` and enables coverage
