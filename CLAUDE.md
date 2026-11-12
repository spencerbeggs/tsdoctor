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

**Naming caution:** the repo-root `plugin/` folder is the **api-docs agent
plugin** (`@tsdoctor/ai-plugins`, built for Claude Code and GitHub Copilot) —
not the RSPress plugin (that is `platforms/rspress/`). See
[plugin/](#plugin-agent-plugin).

## Getting Started

```bash
pnpm install
pnpm run build            # Build packages + plugin + modules (not sites)
pnpm dev                  # Start basic site dev server
```

## Workspaces

Workspace globs (`pnpm-workspace.yaml`): `modules/*`, `packages/*`,
`platforms/*`, `plugin`, `sites/*`.

| Workspace | Package Name | Private | Purpose |
| --------- | ------------ | ------- | ------- |
| `platforms/rspress/` | `rspress-plugin-api-extractor` | Publishable | The RSPress adapter (main plugin) |
| `platforms/vitepress/` | `vitepress-plugin-api-extractor` | Publishable | The VitePress 2.x adapter: markdown-only alpha, awaited `apiExtractor()` config helper, native `@shikijs/vitepress-twoslash` |
| `packages/vfs/` | `@tsdoctor/vfs` | Publishable | VFS primitives: `Vfs`, `VirtualPackage`, `TsEnvironment`, the compiler-options seam |
| `packages/registry/` | `@tsdoctor/registry` | Publishable | External type loading: fetch, cache and resolve package types into a `Vfs` |
| `packages/model/` | `@tsdoctor/model` | Publishable | api.json loading, TSDoc extraction, routes, signatures, `.d.ts` reconstruction, frontmatter, markdown rendering |
| `packages/bundle/` | `@tsdoctor/bundle` | Publishable | Bundle spec: `bundle.json` manifest, provenance resolver, discovery, fetchers |
| `packages/snapshot/` | `@tsdoctor/snapshot` | Publishable | Incremental-build snapshot store (SQLite via `@effected/store`) + content hashing |
| `packages/seo/` | `@tsdoctor/seo` | Publishable | Framework-neutral `<head>` metadata: `HeadTag`, canonical, OG/Twitter, attribution, JSON-LD |
| `packages/pages/` | `@tsdoctor/pages` | Publishable | Framework-neutral page IR: block vocabulary, `ApiItem` → `Page` builders, navigation tree, example preparation, plain-markdown emitter, llms.txt text transforms |
| `plugin/` | `@tsdoctor/ai-plugins` | Yes (not on npm) | The api-docs agent plugin: one pluginfinity source built into `builds/claude/` and `builds/copilot/` |
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
`effected package build`, configured by `platforms/rspress/effected.toml`; the
runtime is emitted bundleless per-file under `dist/prod/npm/pkg/runtime/`
(see `platforms/rspress/CLAUDE.md`).
Depends on all seven `@tsdoctor/*` core workspaces via `workspace:*`.
Exports three entry points:

- `.` — Main plugin (output under `dist/prod/npm/pkg/`)
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

The `bundle.json` manifest schema ships from the kit as `@effected/manifest`
(depends on `effect` alone); this repo keeps no copy of it. **bundle**
re-exports its names from `@effected/manifest`, so readers in this repo import from `@tsdoctor/bundle`;
both platforms depend on `@effected/manifest` directly.

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

### plugin/ (agent plugin)

The **api-docs agent plugin** (`@tsdoctor/ai-plugins`), authored once with
[pluginfinity](https://github.com/spencerbeggs/pluginfinity) and built by
Turbo into `plugin/builds/claude/` and `plugin/builds/copilot/` (committed;
never edit `builds/` by hand — rebuild). Ships skills, the `rspress-docs`
agent, a SessionStart hook and a Claude-only monitor; bats tests in
`plugin/__test__/`. Versioned on its own changeset line; the version files
are the two built manifests. Load with `pnpm claude` / `pnpm copilot`;
`pnpm plugin:check` fails when `builds/` lags the source. See
`plugin/CLAUDE.md`.

### modules/

Test fixture modules built with `effected package build`, producing
`dist/prod/npm/pkg/` and `dist/prod/npm/meta/` (API Extractor model,
`.api.json`); each module's `effected.toml` sets `[package.build.meta]
localPaths` to copy the model into the sites that consume it.
**kitchensink** also exports a `./testing` entry point for multi-entry
testing. `modules/kitchensink/effected.toml` carries a `[package.bundle]`
table (name, tagline, a satori-generated Open Graph image via
`[package.bundle.openGraph] generate = "satori"`) that the build writes out
as the site's `bundle.json` sidecar.

### sites/

RSPress 2.0 sites consuming the plugin via `workspace:*` plus one or more
modules (configurations in the workspace table). `sites/vitepress-basic/` is
the VitePress 2 fixture, populated by kitchensink's `localPaths` like
`sites/basic/`. Each site's `sites/*/lib/models/kitchensink/` is populated by
the kitchensink build (generated, gitignored) with `bundle.json` and
`og/kitchensink.png` beside the api.json trio. The root `bundle.json` is
the project tier the build flattens into every site's resolved bundle
manifest.

Workspace links resolve through `exports` to `src/`; every `packages/*` and
`platforms/*` export carries an `effected-built` condition first (pointing at
`dist/prod/npm/pkg/`), which the build strips from the published manifest.
Sites run `build`/`dev`/`preview` with
`NODE_OPTIONS=--conditions=effected-built`, so they load the built siblings:
each RSPress config prepends `effected-built` to rspack's
`resolve.conditionNames`, and the VitePress fixture imports the adapter
through a variable-specifier `import(adapter)` because Vite's config bundler
ignores `--conditions`. Siblings must be built before a site runs (Turbo
handles it).

## Effect-TS Architecture

Everything runs on **Effect v4** (`effect@4.1.1`, pinned through the
`catalog:effected` catalog). Key patterns in the RSPress adapter:

- **Services** declared as `Context.Service<Self, Shape>()("id")`, each
  owning its layer as a static (inventory in
  `okf/modules/rspress-plugin-api-extractor.md`)
- **Per-build `Context.Reference`s** in `src/BuildEnv.ts`
- **Two `ManagedRuntime`s**: the main (async-to-build) one, plus a
  `Layer.succeed`-only one for the sync-island event emitters
- **Stream pipeline** for concurrent page generation (`build-stages.ts`)
- **Effect Schema** for config validation (`src/schemas/`)
- **Core `effect` FileSystem** for I/O, `@effect/platform-node` for Node
- **Snapshot SQLite DB** behind `@tsdoctor/snapshot` (`@effected/store`)

### @effected Distribution and Dogfooding

`@effected/*` packages are distributed through the `@effected/pnpm-plugin-effected`
config dependency in `pnpm-workspace.yaml` (`configDependencies:`), which
supplies one pnpm catalog, `catalog:effected`, holding both the Effect
family (held to one Effect minor, `~4.1.2`) and the `@effected/*` kit.

- Declare every `effect`, `@effect/*` and `@effected/*` entry in
  `dependencies` as `"catalog:effected:exact"`, in `devDependencies` as
  `"catalog:effected"`, and in `peerDependencies` as
  `"catalog:effected:peers"` (the `:peers` twin floors each range to its
  minor so a published peer doesn't pin consumers to one patch). Never
  hand-pin an `@effected` version range.
- **The adapters seal their kit closure.** Consumers install
  `platforms/*`, so a kit patch must never reach them without an adapter
  release: the `:exact` spelling covers every runtime kit dependency of the
  adapters *and* of the `@tsdoctor/*` libraries they ship (pnpm resolves a
  library's carets independently), and each adapter declares its whole kit
  closure flattened — every kit package reached through a dependency or
  required peer, at any depth — so upstream kit-to-kit carets resolve onto
  the adapter's pins. `platforms/*/__test__/kit-closure-pins.test.ts`
  holds these rules; when a plugin bump fails it, add the new package to
  both adapters as `catalog:effected:exact`.
- Upstream effected CI/CD bumps `@effected/pnpm-plugin-effected`; a plugin
  release carries the whole `@effected` dependency/peer graph — never manage
  that graph by hand.
- To dogfood unreleased `@effected` work: add `overrides:` in
  `pnpm-workspace.yaml` pointing the tinkered packages — **and their peers** —
  at the local sibling `effected` checkout's built artifacts (`file:` links).
  This is the `/silk:dogfood` protocol; a repo hook blocks pushes while
  `file:` overrides are linked.

## Knowledge bundle (okf/)

The design record now lives as an [OKF](https://okfspec.dev) knowledge bundle
under `okf/`, not as standalone design docs. Start at `okf/index.md` for the
full concept map; the groupings below point at the concepts most relevant to
each area of the code, not an exhaustive list. They are pointers, not imports:
read one when the task touches its area.

**Build & infrastructure** — services, layers, `Context.Reference`s, either
`ManagedRuntime`, hook lifecycle, config resolution, the build script:

- `okf/modules/rspress-plugin-api-extractor.md`
- `okf/decisions/two-managed-runtimes.md`
- `okf/conventions/services-own-their-layers.md`
- `okf/decisions/generate-docs-in-config-hook.md`
- `okf/interfaces/rspress-plugin-options.md`
- `okf/decisions/core-peers-follow-public-surface.md`
- `okf/decisions/adapter-kit-closure-pins.md`
- `okf/conventions/rspress-dependency-closure.md`
- `okf/decisions/typescript-version-split.md`

**Page generation & markdown** — the Stream pipeline, Shiki transformers,
cross-linking:

- `okf/decisions/single-anchor-algorithm.md`
- `okf/decisions/linker-is-a-scope.md`
- `okf/decisions/import-namespace-root-not-leaf.md`

**Page IR & emitters** — `@tsdoctor/pages` blocks or builders, either
adapter's `src/emit/` emitters, the byte-parity gate:

- `okf/modules/tsdoctor-pages.md`
- `okf/decisions/per-node-mdx-serialization.md`
- `okf/conventions/byte-parity-emitter-changes.md`
- `okf/modules/vitepress-plugin-api-extractor.md`

**Runtime components & SSG** — React components, SSG-MD dual-mode rendering:

- `okf/conventions/runtime-component-authoring.md`
- `okf/decisions/bundleless-per-file-runtime.md`

**Type loading, VFS & multi-entry points** — Twoslash, external package
types, VFS generation, multi-entry resolution:

- `okf/modules/tsdoctor-vfs.md`
- `okf/decisions/per-scope-typescript-environments.md`
- `okf/limitations/collision-detection-by-final-route.md`
- `okf/decisions/route-collisions-fail-the-build.md`

**SEO & head metadata** — canonical URLs, Open Graph, Twitter cards,
attribution, schema.org JSON-LD:

- `okf/interfaces/seo-headtags.md`
- `okf/decisions/site-url-is-derived-not-configured.md`
- `okf/decisions/head-tags-built-in-generate-stage.md`

**LLMs integration** — llms.txt post-processing, per-package file
generation, scope-aware UI components:

- `okf/decisions/llms-post-process-not-generate.md`

**Observability** — Effect Metrics, logging, error tracking, the progress
heartbeat, the `issues.json` artifact:

- `okf/conventions/observability-events-not-logs.md`
- `okf/decisions/synchronous-event-bus.md`
- `okf/models/issues-json-artifact.md`
- `okf/gotchas/undimensioned-metrics-are-process-wide.md`

**Roadmap & @tsdoctor consolidation** — the road to 1.0.0, the
`@tsdoctor/*` package architecture:

- `okf/decisions/vitepress-alpha-gates-1-0.md`
- `okf/decisions/core-adapter-boundary.md`
- `okf/decisions/consolidate-into-one-monorepo.md`

## Build Pipeline

### `private: true` and Publish Targets

Every publishable workspace's source `package.json` is `"private": true` —
**intentional**. `publishConfig` controls publishing (npm only, with
provenance); never set `"private": false` in the source manifest —
`effected package build` transforms `package.json` during build.

### Turbo Orchestration

[Turbo](https://turbo.build/) manages task dependencies and caching:

- One `build` task (`effected package build`) depends on `^build` and
  `types:check`, with outputs `dist/prod/**` (`<group>/{pkg,meta}`,
  `targets.json`, `issues.json`); `types:check` depends on `^types:check`
- `dev`/`preview` depend on `^build`; a site's `build` depends on `^build`
  plus its module's `#build`
- The root `build` script is `turbo run build --filter=!@sites/*`;
  `ci:build` also excludes modules
- Environment pass-through: `GITHUB_ACTIONS`, `CI`

## Savvy-Web Tool References

These `@savvy-web/*` packages are in active development — when behavior seems
unexpected, read the installed source under `node_modules/@savvy-web/`.

| Package | Purpose | GitHub |
| ------- | ------- | ------ |
| commitlint | Conventional commit + DCO enforcement | [savvy-web/commitlint](https://github.com/savvy-web/commitlint) |
| changesets | Versioning, changelogs, release management | [savvy-web/changesets](https://github.com/savvy-web/changesets) |
| lint-staged | Pre-commit file linting via Biome | [savvy-web/lint-staged](https://github.com/savvy-web/lint-staged) |
| vitest | Vitest config factory with project support | [savvy-web/vitest](https://github.com/savvy-web/vitest) |

TypeScript configurations extend per workspace type:

- Core packages, modules and `platforms/vitepress/` →
  `@effected/plugin/tsconfig/ecma.json`
- `platforms/rspress/` → the same, overriding `jsx: react-jsx`,
  `lib: [es2025, dom]` and `types: [node, react, react-dom]`
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
| `.repos/effect` | effect@4.1.1 | Effect v4 core source + the `migration/` v3-to-v4 notes |
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
pnpm --filter rspress-plugin-api-extractor run build  # plugin only
pnpm --filter @sites/basic run dev                    # one site's dev server
pnpm vitest run platforms/rspress/__test__/build-stages.test.ts
```

The `plugin/` agent plugin is covered by bats, not Vitest:

```bash
pnpm test:bats
pnpm plugin:check       # builds/ current with the pluginfinity source
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
