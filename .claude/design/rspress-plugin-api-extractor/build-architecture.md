---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
  - rspress-plugin-api-extractor/component-development.md
  - rspress-plugin-api-extractor/ssg-compatible-components.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
dependencies: []
---

# Build Architecture

## Table of Contents

- [Overview](#overview)
- [Per-file Plugin and Bundleless Runtime](#per-file-plugin-and-bundleless-runtime)
- [Effect Service Layer](#effect-service-layer)
- [Core Package Consumption](#core-package-consumption)
- [Plugin Lifecycle](#plugin-lifecycle)
- [Configuration System](#configuration-system)
- [Build Tooling](#build-tooling)
- [Development Workflow](#development-workflow)

## Overview

The rspress-plugin-api-extractor separates Node.js plugin code from React runtime components, combined with an **Effect service layer** for doc generation orchestration. Both halves are emitted **per-file** (each `src/*.ts(x)` transpiled 1:1 to its own `.js`, mirroring the source tree); they differ by **environment and externals**, not by bundling strategy. The plugin half targets Node.js with its dependencies external; the runtime half targets the browser with `react`/`@theme` external, CSS modules and `import.meta.env` preserved so RSPress does the final per-site compile.

The plugin entry point (`plugin.ts`) is a thin RSPress adapter that wires
Effect services and delegates all doc generation to `build-program.ts` and
`build-stages.ts`.

## Per-file Plugin and Bundleless Runtime

### Plugin code (Node.js)

**Entry:** `src/index.ts` (a barrel re-exporting `plugin.ts`, the `serve.ts` API and the public config schemas). **Output:** `dist/dev/pkg/` (the published package root — see [Build Tooling](#build-tooling)). **Environment:** Node.js (RSPress build process).

The plugin half is emitted **per-file**: every `src/*.ts` becomes its own `.js` under `dist/dev/pkg/`, mirroring the source tree (e.g. `plugin.js`, `build-program.js`, `layers/config-resolution.js`), with sibling imports preserved as relative `./...js` specifiers and `dependencies` left external. It owns the RSPress lifecycle hooks (config, beforeBuild, afterBuild), Effect service layer initialization and runtime management, the doc generation pipeline and the remark plugins for code block processing. A bundled `index.d.ts` is emitted alongside, inlining the declarations of any `bundledPackages` (here `@rspress/core`, `@type/mdast`, `@type/unist`).

### Runtime components (bundleless, React/browser)

**Published export:** `./runtime` → `{ "types": "./runtime/index.d.ts", "import": "./runtime/index.js" }`. **Environment:** Browser (RSPress SSG and client-side).

The runtime is **not** compiled into a single `runtime/index.js` bundle, nor shipped as raw `.tsx`. The builder's `build()` (from `@savvy-web/rspress-builder`) emits it **bundleless**: each component is transpiled 1:1 into its own `.js` under `runtime/`, mirroring the `src/runtime/...` tree, with `react`/`@theme` external and `import.meta.env` left as a runtime expression. **RSPress then compiles each referenced `.js` per site build.** This is required for `import.meta.env.SSG_MD` to resolve correctly (a single bundle froze it to `undefined`, breaking the SSG-MD dual-mode branch) and so the `globalUIComponents` / `resolve.alias` registrations in `plugin.ts` can point at real per-component `.js` files. A bundled `runtime/index.d.ts` (types only) is also emitted so the export's `types` condition resolves. See `ssg-compatible-components.md` for the bundleless mechanism and why component-path resolution is layout-invariant.

The runtime provides the React components that render API documentation: signature/example blocks, parameter and enum tables, the interactive wrap/copy buttons and the Twoslash hover tooltips and error display.

### Build tooling

**Builder:** `@savvy-web/rspress-builder`'s `build()`, which is built on the tsdown-based `@savvy-web/bundler`. The plugin builds via a self-executing `platforms/rspress/savvy.build.ts` that top-level-awaits `build({...})`. `build` produces the two-entry shape automatically — the Node plugin entry (`.`) and the bundleless React runtime (`./runtime`); the plugin half is not a single bundle but per-file JS. **Module system:** ESM with `"module": "esnext"` and `"moduleResolution": "bundler"`. **CSS processing:** CSS modules (no Sass) for runtime components, compiled by RSPress alongside the transpiled JS.

## Effect Service Layer

### Service Architecture

The plugin uses Effect's Context/Layer/Service pattern for dependency injection. Every service tag is declared in the v4 form, `class X extends Context.Service<X, XShape>()("rspress-plugin-api-extractor/X")` — and **every service owns its own layer as a static on that class**, matching the pattern the four core packages already follow. The five `layers/*ServiceLive.ts` modules are gone; `layers/` now holds composition (`AppLayer.ts`), the config-resolution implementation and the shared platform/observability pieces.

### The layer stack, tiered

`src/layers/AppLayer.ts` is the one place the stack is composed. `makeAppLayers(input)` returns BOTH runtime stacks from a single call:

```text
plugin.ts (RSPress adapter)
  |
  +-> makeAppLayers({ options, obs, buildId, dbPath, pageConcurrency,
  |                   eventBus, metrics })  ->  { app, emitter }
  |
  |     PlatformLayer     NodeFileSystem.layer (+ layers/xdg.ts PlatformLive
  |     |                 where a service needs FileSystem/Path locally)
  |     |
  |     ObservabilityLayer
  |     |   eventBus (from buildEventBus)  synchronous fan-out sinks
  |     |   metrics.layer                  the build's own MetricRegistry
  |     |   makeSummaryLoggerLayer         Effect Logger gate
  |     |
  |     CoreLayer  (own a resource; need only the platform)
  |     |   TypeRegistryService.layer      external package type loading
  |     |   TwoslashCacheService.layer     XDG sqlite Twoslash result cache
  |     |   SnapshotService.layer(dbPath)  @tsdoctor/snapshot, Store.layerSqlite
  |     |   OgService.layer                over PlatformLive
  |     |
  |     BuildLayer  (scoped to this build's configuration)
  |     |   Layer.succeed(PluginConfig, options)
  |     |   HighlighterService.layer(themes)   bound to a const — a factory
  |     |   TwoslashEnvironments.layer
  |     |   BuildEnvLayer  (BuildId, Thresholds, PageConcurrency,
  |     |                   SuppressExampleErrors — provided to BOTH stacks)
  |     |
  |     app     = Layer.provideMerge(ConfigService.layer,
  |     |           mergeAll(BuildLayer, CoreLayer, ObservabilityLayer,
  |     |                    NodeFileSystem.layer))
  |     emitter = Layer.mergeAll(ObservabilityLayer, BuildEnvLayer)
  |
  +-> ManagedRuntime.make(appLayers.app)
  +-> ManagedRuntime.make(appLayers.emitter)
```

The tiers are ordered by what they may reach: the platform knows nothing about this plugin, core services know the platform, build-scoped services know both. The flat eleven-way `Layer.mergeAll` this replaced told you what the build contained but not what depended on what — and one of its members carried a local `Layer.provide` precisely because a flat merge could not feed it.

**Returning both stacks from one call is the point, not a convenience.** The two-runtime invariant — they must share `metrics.layer` and the `BuildEnv` references BY REFERENCE — was previously enforced only by comments, and both halves fail silently when broken: a split metric registry reports every count as zero, and a split `BuildId` mislabels every event a sync island emits. One call with one `MetricStore` input makes constructing them from different inputs structurally impossible.

`AppLayers.app`'s error channel is **not** `never`. `SnapshotService.layer` can fail with `StoreError | StoreMigrationError` when its database cannot be opened or migrated, and that surfaces when the `ManagedRuntime` first builds rather than at any call site. Stating it rather than erasing it is deliberate: a corrupt snapshot DB should stop the build loudly, unlike the two cache layers, which degrade.

### Two runtimes, deliberately

There are **two** `ManagedRuntime`s and they must not be merged back into one.

The main runtime's layer opens two SQLite databases at construction — the snapshot store and the Twoslash result cache — because both cache-backed layers acquire their stack at layer-construction time rather than inside each method body (see [Layer acquisition](#layer-acquisition-and-memoization)). That makes `appLayers.app` **asynchronous to build**, and `makeRuntimeEmitter`'s `runtime.runSync` builds a runtime's layer before running anything, so the first sync emit from a remark plugin died with `AsyncFiberError` during RSPress's render pass — invisible to every unit test.

The sync-island emitters therefore run on `appLayers.emitter`, whose every member is `Layer.succeed` and therefore synchronously buildable. Beyond the bug that surfaced it, the split states an invariant worth keeping: **an event emitter has no business forcing a database open.**

### Static initializers and the false green

A static on a service class is evaluated while the module body is still being evaluated, so a static that names a `const` declared further down — or a binding imported from a module that imports this one back — throws AT IMPORT TIME while typechecking completely clean. The failure surfaces only as vitest reporting "0 tests passed" with exit code 0, which reads as a green run.

The deferring forms used here are `Layer.suspend(() => …)` for a layer composition (`TypeRegistryService.layer`, `TwoslashCacheService.layer`) and `Effect.suspend(() => make())` for an effect body (`ConfigService.layer`, `OgService.layer`). Use one whenever a service's static names something defined after it.

### Per-build configuration as `Context.Reference`s

`src/BuildEnv.ts` holds the values that used to travel by hand as constructor arguments and god-object fields:

| Reference | Default | Read by |
| --- | --- | --- |
| `BuildId` | `""` | `EventBus.emit` (fills `ctx.buildId`), `sync-emitter.ts` |
| `Thresholds` | the `ResolvedObservability` defaults | `withPhase` (`observability/spans.ts`) |
| `PageConcurrency` | `1` (`plugin.ts` provides `os.cpus().length`) | `build-program.ts` |
| `SuppressExampleErrors` | `true` | `build-program.ts` |

A `Context.Reference` carries a default, so a wiring mistake **succeeds quietly with the default** rather than failing. That is why the decoded plugin options are a `Context.Service` (`services/PluginConfig.ts`) and not a Reference: there is no sensible default for "which APIs is this site documenting", so forgetting to provide it must be a loud "service not provided". The same reasoning makes the Shiki themes a **layer argument** to `HighlighterService.layer` rather than a Reference. Use a Reference only where the default is merely conservative, never where it would be silently wrong.

### Services and their layers

| Service | Module | Layer | Key dependencies |
| --- | --- | --- | --- |
| `ConfigService` | `services/ConfigService.ts` | `ConfigService.layer` | `TypeRegistryService`, `PluginConfig` |
| `PluginConfig` | `services/PluginConfig.ts` | `Layer.succeed` in `AppLayer.ts` | (none) |
| `HighlighterService` | `services/HighlighterService.ts` | `HighlighterService.layer(themes)` | (none; `Effect.acquireRelease` over `createHighlighter`) |
| `TwoslashEnvironments` | `services/TwoslashEnvironments.ts` | `TwoslashEnvironments.layer` | (none) |
| `OgService` | `services/OgService.ts` | `OgService.layer` | `FileSystem`, `Path` (given `PlatformLive` in `AppLayer.ts`) |
| `TwoslashCacheService` | `services/TwoslashCacheService.ts` | `TwoslashCacheService.layer` | `@effected/store` `Cache`, `layers/xdg.ts` |
| `TypeRegistryService` | `services/TypeRegistryService.ts` | `TypeRegistryService.layer` | `@tsdoctor/registry`, `@effected/store`, `layers/xdg.ts`, `@effect/platform-node` |
| `SnapshotService` | `@tsdoctor/snapshot` (`packages/snapshot/src/SnapshotService.ts`, tag id `"@tsdoctor/snapshot/SnapshotService"`) | `SnapshotService.layer(dbPath)` | `@effected/store` (`Store.layerSqlite`) |
| `EventBus` | `observability/EventBus.ts` | `buildEventBus` (`layers/observability.ts`) | Synchronous fan-out event bus |

`makeSummaryLoggerLayer` (`layers/observability.ts`) is the remaining free-standing layer — the Effect Logger gate for `Effect.log*` calls.

`ConfigService.layer` is a **zero-argument static**, not a layer-returning factory. Layers memoize by reference, so a factory called twice mints two layers — with a second `ConfigService` capturing its own `TypeRegistry`. Making it a plain static turns "call it twice" into a type error rather than a test case. `HighlighterService.layer(themes)` and `SnapshotService.layer(dbPath)` remain factories, which is why `AppLayer.ts` binds the highlighter's result to a `const` before merging: a second call would acquire a second highlighter.

`PathDerivationService` is **deleted**. It was a `Layer.succeed` over two pure functions whose declared `PathDerivationError` was unreachable, and it was already bypassed at seven call sites that imported the pure functions from `path-derivation.ts` directly. `plugin.ts` even composed the layer into the stack without ever using it. The pure module and its tests remain — that is where the coverage always lived.

### Test doubles on the service

`ConfigService`, `OgService`, `TwoslashCacheService`, `TypeRegistryService` and `@tsdoctor/snapshot`'s `SnapshotService` each ship `makeTest(overrides)` and `layerTest(overrides)` alongside their live layer. Each member defaults to the shape a build takes when nothing is configured — every snapshot lookup misses, every spec resolves unchanged, the Twoslash cache is cold — so a test overrides only the member it exercises rather than restating the whole shape, which is the difference from the hand-written `Layer.succeed` doubles these replace.

**Two members deliberately have no default and throw naming themselves:** `ConfigService.resolve` and `OgService.resolveImage`. Their natural defaults (an empty array, `Option.none`) are indistinguishable from a real answer — an empty array is exactly what an inert plugin produces — so a test that forgot to stub them would assert against a build that generated nothing and pass.

`SnapshotServiceShape.hashContent` was **removed from the shape**. It had zero consumers in the method form, and being non-effectful it forced every double to supply it. The standalone `hashContent` export from `@tsdoctor/snapshot` is unchanged and is what the build stages import.

### Layer acquisition and memoization

`TypeRegistryService.layer` and `TwoslashCacheService.layer` used to call `Effect.provide(SomeLayerConst)` *inside each method body*. In Effect v4 `provideLayer` is a `scopedWith` over `buildWithScope` that forks a **child** `MemoMap` whose parent never built the layer, so the registry stack (XDG + `metadata.sqlite` + undici + `TypeCache`) and the Twoslash cache were each built and torn down twice per build. Both now acquire once at `ManagedRuntime` construction.

Both cache-backed layers must **degrade to a cache miss** rather than fail. Moving acquisition to layer-construction time moved the failure mode from "this method fails and its local catch absorbs it" to "the `ManagedRuntime` build aborts the whole site build" — a purely structural-looking change that silently violated `TwoslashCacheService`'s documented contract. The type system was the only thing that noticed, when the layer's error channel went from `never` to `CacheError | AppDirsError | XdgEnvError`. `SnapshotService.layer` is the deliberate counter-example: its failure stays in the channel and stops the build.

**Degrading is `@effected/store`'s `Cache.degrading`, not `Layer.catchCause`.** The hand-written `Layer.catchCause` this replaced caught EVERY cause, interruption included, so a fiber being interrupted during shutdown was handed a working degraded cache and carried on instead of dying — the one cause a degrade must never absorb. Degrading at the `Cache` rather than at the service layer also collapsed `TwoslashCacheService`'s separate `DegradedLive`: the ordinary implementation running over an always-missing cache IS the degraded behaviour, so there is no second implementation to keep in step. `TypeRegistryService` keeps a hand-written catch, because its construction can fail outside the cache (no HOME for XDG, an unwritable metadata DB), and that catch **re-raises interruption** — rebuilding the cause from `Cause.interruptors` so the fiber recorded as the interruptor is the original one, not whichever fiber happened to be running the layer.

`CacheShape.degraded` is surfaced on `TwoslashCacheServiceShape`. A degraded cache and a genuinely cold one behave identically at every lookup, so without the flag the build summary reported an unusable cache as merely cold — the two are indistinguishable from the outside, which is exactly why the distinction has to be carried rather than inferred.

Both cache layers also share one platform and XDG root, `src/layers/xdg.ts`, exporting `TSDOCTOR_NAMESPACE`, `PlatformLive` and `AppDirsLive`. Each file previously declared its own — including a copy-pasted `"tsdoctor"` namespace literal. Two distinct layer references build twice, and a drifted namespace literal is permanent and silent: the caches move directory, every lookup misses, and a build that should hit a warm Twoslash cache goes cold forever with nothing in the output to notice.

### Effect v4 and the peer dependency closure

The plugin runs on **Effect v4** (`effect@4.0.0-rc.109`, pinned through the `catalog:effect` catalog supplied by `@effected/pnpm-plugin-effect`). Two v3 packages are gone because their contents merged into the `effect` core: `@effect/platform` (FileSystem is now the top-level `effect` `FileSystem` module) and `@effect/sql` (now `effect/unstable/sql`). `@effect/platform-node` and `@effect/sql-sqlite-node` remain as separate node-platform packages.

The v3 peer-closure block (`@effect/cluster`, `@effect/experimental`, `@effect/rpc`, `@effect/workflow`) has been **removed**: the v4 peer graph is small enough that issue #69's escaping-peer problem no longer applies in that form. The closure principle still holds, though — because the per-file plugin build leaves `dependencies` external, any unclosed non-optional peer escapes to the consuming workspace where pnpm `autoInstallPeers` can bind it unpredictably. As of phase 2 the closure lives in the plugin's `dependencies` block (only `@rspress/core`/`react`/`react-dom` remain peers):

- `ioredis` — non-optional peer of the `@effect/platform-node` v4 beta.
- The full `@effected` surface the six `@tsdoctor/*` workspaces ride on, all via `catalog:effected`: `@effected/semver`, `@effected/store`, `@effected/tsconfig-json`, `@effected/xdg` (registry closure) plus the phase-2 additions `@effected/github`, `@effected/glob`, `@effected/npm`, `@effected/package-json`, `@effected/walker` (bundle closure) and `@effected/yaml` (frontmatter handling, now behind `@tsdoctor/model`), alongside `@typescript/vfs`. The released effected round-1 kit wave added two more: `@effected/jsonc` (canonical JSON-value hashing behind `@tsdoctor/bundle`'s `BundleHash.ts`) and `@effected/markdown` (frontmatter fence grammar and block assembly behind `@tsdoctor/model`'s `Frontmatter.ts` and, transitively, its prose/render internals). Round 2 (phase 4) added `@effected/schema-org@0.1.0` behind `@tsdoctor/seo`, alongside `@effected/spdx@0.5.0` and `@effected/package-json@0.13.0`, and bumped the `@effected/pnpm-plugin-effect` config dependency in `pnpm-workspace.yaml` to `0.6.11` to carry the schema-org catalog entry. `@effected/package-json` is now a DIRECT plugin import as well as a closure entry — `layers/config-resolution.ts` decodes each API's `package.json` through `PackageManifest`.
- The six core workspaces themselves: `@tsdoctor/vfs`, `@tsdoctor/registry`, `@tsdoctor/model`, `@tsdoctor/bundle`, `@tsdoctor/snapshot` and `@tsdoctor/seo`, each `workspace:*`.

`@effect/sql-sqlite-node` and `gray-matter` are **gone** from the plugin manifest — SQLite moved behind `@tsdoctor/snapshot`'s `Store.layerSqlite`, and frontmatter parsing moved to `@effected/yaml` — and then out of the adapter entirely, into `@tsdoctor/model`'s `Frontmatter.ts` (Tier 1 core moves; the adapter now imports `parseFrontmatter` / `emitFrontmatterBlock` from the model). Do not prune the closure entries as "unused"; the plugin imports some of them directly (see `services/TypeRegistryService.ts`, `sync-node-fs.ts`, `twoslash-transformer.ts`) and the rest exist to keep the dependency graph closed.

`mdast-util-from-markdown` has moved to `devDependencies`: `twoslash-transformer.ts`'s `renderMarkdown` now parses through `@effected/markdown`'s `Markdown.parseResult` + `Mdast.toMdast`, passing `dialect: "commonmark"` explicitly (the kit defaults to GFM, and adopting GFM would be a product change, not a dependency swap). `mdast-util-to-hast` **stays a runtime dependency** — `@effected/markdown` puts markdown→HTML permanently out of scope, so `toHast` has no kit equivalent. On the dev side, `@effect/vitest` and `@effected/memfs` were added: the latter replaces a hand-stubbed `layerNoop` in one registry test. `TypeCache.test.ts`'s `layerNoop` is deliberately left alone — that one is fault injection, which memfs cannot do.

A former `pnpm-workspace.yaml` override pinned `yuku-parser: ^0.6.12` to dodge a broken 0.6.7 publish that crashed `rolldown-plugin-dts` during the declaration build; the ecosystem now resolves a healthy version and the override (plus its `minimumReleaseAgeExclude` entries) has been removed.

### v4 idiom notes

The migration changed several call-site idioms that recur throughout the plugin source:

| Concern | v4 form |
| --- | --- |
| Service tags | `Context.Service<Self, Shape>()("id")` (replaces `Context.Tag("id")<Self, Shape>()`) |
| Schema literals / unions / records | `Schema.Literals([...])`, `Schema.Union([a, b])`, `Schema.Record(key, value)` |
| Schema defaults | `X.pipe(Schema.withDecodingDefault(Effect.succeed(v)))` (replaces `Schema.optionalWith(X, { default })`) |
| Schema type extraction | `typeof X.Type` / `typeof X.Encoded` (replaces `Schema.Schema.Type<typeof X>`) |
| Metrics | `Metric.histogram(name, { boundaries: [...] })`; `Metric.update(m, n)` (replaces `Metric.increment/incrementBy`; the `MetricBoundaries` module is gone) |
| Error channel inspection | `Effect.result` yielding a `Result` (`_tag: "Failure"`, `.failure`), replacing `Effect.either` |
| Error recovery | `Effect.catch` (replaces `Effect.catchAll`) |

`Schema.mutable` is restricted to array schemas in v4, so struct-level `mutable` wrappers were dropped. `Data.TaggedError` and `Data.TaggedEnum`/`taggedEnum` survive unchanged, so `errors.ts` and `observability/events.ts` needed no migration.

### Schema Validation

Plugin options are defined as Effect Schemas in `schemas/`:

- `schemas/config.ts` -- `PluginOptions`, `SingleApiConfig`,
  `MultiApiConfig`, `CategoryConfig`, `ExternalPackageSpec`, etc.
- `schemas/opengraph.ts` is **deleted** — `OpenGraphImageConfig` and the rest
  of the OG vocabulary now live in `@tsdoctor/seo` and are re-exported from
  `src/index.ts` for consumers
- `schemas/performance.ts` -- `PerformanceThresholds` (the top-level `performance` plugin option is **deleted**; thresholds reach the build through `observability.thresholds` and the `Thresholds` Reference)

Options are decoded at plugin factory time. The exported
`ApiExtractorPlugin` is the factory function with config helpers attached as
a namespace:

```typescript
function ApiExtractorPluginImpl(rawOptions: PluginOptions): RspressPlugin {
  const options = Schema.decodeUnknownSync(PluginOptions)(rawOptions);
  // ...
}

export const ApiExtractorPlugin = Object.assign(ApiExtractorPluginImpl, {
  api: { fromDir },
  apis: { fromDir: fromParentDir },
});
```

### Config Helpers

`ApiExtractorPlugin.api.fromDir` and `ApiExtractorPlugin.apis.fromDir` (`src/config-helpers.ts`, internally `fromDir` and `fromParentDir`) build `MultiApiConfig` objects by discovering the package name, version, `.api.json` model and `tsconfig.json` from a built module package folder (the per-package model dirs the modules emit via `@savvy-web/bundler`'s `meta.localPaths`). Since phase 2 the discovery itself delegates to `@tsdoctor/bundle`'s `discoverBundle`, run synchronously over the `SyncDiscoveryLayer` FileSystem bridge (`src/sync-node-fs.ts`) so the public helper API stays sync. Adapter-side and deliberately NOT delegated: the `requirePackageJson` strictness (the plugin requires a `package.json` even though the bundle spec's discovery needs only layer 0 — see `bundle-spec.md`), baseRoute templating, `MultiApiConfig` assembly and the historical error messages (all 21 config-helpers tests pass unmodified). They are exposed under two namespaces matching the plugin option they feed:

- `api.fromDir(dir, overrides?)` -- one config from a single package folder, for use under the `api:` option or as an element of `apis:`. Caller overrides win over discovery.
- `apis.fromDir(parentDir, options?)` -- scans a parent directory and builds one config per subfolder for the `apis:` option, requiring every non-dotfile subdirectory to be a valid model folder.

The helpers no longer inject a default `baseRoute`. When the caller omits it the route is left unset and the plugin applies a context-aware default during resolution in `layers/config-resolution.ts`: under `api:` it mounts at `/api` (`baseRoute ?? "/"`), under `apis:` at `/{packageName}/api` (`baseRoute ?? "/${unscopedName(packageName)}"`), in both cases appending `apiFolder ?? "api"`. This fixes a bug where a single-API site using the helper generated docs at `/{dirname}/api` instead of `/api`. Callers can still pass an explicit `baseRoute` -- a `{dirname}` / `{packageName}` template string or an `(info: DirInfo) => string` callback -- to override.

The helper types (`DirInfo`, `BaseRoute`, `FromDirOptions`) are re-exported from `src/index.ts`; both helpers share `FromDirOptions`.

## Core Package Consumption

The plugin depends on all seven `@tsdoctor/*` core workspaces via `workspace:*` and, since the phase-2 model redesign, consumes **`@tsdoctor/model`** directly — the four phase-1 delegation shims (`loader.ts`, the class-based `model-loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`) are **deleted**. The model's v4 surface is namespace modules: `Model` (Effect-typed loading with `ModelNotFoundError`/`ModelParseError`/`EmptyModelError`), `Tsdoc` (pure TSDoc accessors), `ApiItems` (categorization + namespace members), `EntryPoints`, `Routes`, `SyntheticBases`, `Signature` (de-classed formatting), `Render` and the `CrossLinker` class. (The model's `@alpha` `StructuredData` stub is **deleted** as of phase 4; schema.org derivation lives in `@tsdoctor/seo`.)

How the former shim call sites consume it now:

| Concern | Now |
| --- | --- |
| Model loading | `model-loader.ts` is plain functions over `Model.load` (typed `ModelLoadError = Model.ModelNotFoundError \| Model.ModelParseError \| Model.EmptyModelError`); failures emit `ModelLoadFailed` via `Effect.tapError` in `layers/config-resolution.ts` (see `build-progress-and-issues.md`) |
| TSDoc extraction | the `@tsdoctor/pages` builders (`Build.ts`) call `Tsdoc.summary`/`Tsdoc.params`/`Tsdoc.releaseTag`/`Tsdoc.deprecation` etc. directly; the adapter's page generators are deleted (phase 5) |
| Signature formatting | `Signature.format(excerpt)` directly (the `TypeSignatureFormatter` class is gone) |
| Categorization | `ApiItems.categorize(items, categories)` returning `{ items, uncategorized }`; the adapter emits an `ItemSkipped` event per uncategorized item |
| Prose cross-linking | one immutable `CrossLinker.fromRoutes(routes)` per API, built in `build-program.ts` and carried through `GenerateSinglePageContext.linker` into `@tsdoctor/pages`'s `buildPage` — the former `markdown/prose-linker.ts` module-level holder is **deleted** (phase 5; see `cross-linking-architecture.md`) |

**Moved into the model, still not merged.** `ApiExtractedPackage` (now `packages/model/src/ApiExtractedPackage.ts`) keeps its OWN private `extractPlainText`. Despite the shared name with the library helper, it is a different algorithm for declaration reconstruction: it PRESERVES `{@link X.Y}` TSDoc syntax and reconstructs fenced code blocks for `.d.ts`/JSDoc output, whereas the library's prose extraction flattens `{@link}` to display text and drops code fences. The two are not interchangeable.

**`@tsdoctor/bundle`** supplies discovery for the config helpers (see [Config Helpers](#config-helpers)) plus the npm-tarball and GitHub-release fetchers (`bundle-spec.md`). **`@tsdoctor/snapshot`** supplies the snapshot service (`snapshot-tracking-system.md`). **`@tsdoctor/registry`** fetches, caches and resolves external package types into a `Vfs` (`type-loading-vfs.md`), with its tag ids renamed to `"@tsdoctor/registry/..."` in phase 2.

**`@tsdoctor/vfs`** is the sixth core workspace, extracted from the registry in the Tier 1 core moves: the `Vfs` currency type and its `mergeVfs`/`prefixVfs`/`isTypeDefinition` helpers, `VirtualPackage`, `TsEnvironment`, and the compiler-options seam (`parseTsConfig`, `TypeResolutionCompilerOptions`, `decodeCompilerOptions`, `toProgrammaticCompilerOptions`, `DEFAULT_COMPILER_OPTIONS`, `resolveTypeScriptConfig`). Since phase 5 it also hosts the **Twoslash result cache** (`TwoslashCache.ts`: `makeTwoslashCache`, `twoslashBlobKey`, `encodeTwoslashCache`/`decodeTwoslashCache`, `TWOSLASH_CACHE_FORMAT`), moved out of the adapter's `twoslash-cache.ts` so both adapters warm one XDG store; `services/TwoslashCacheService.ts` keeps only the persistence over it. The adapter consumes the seam from `layers/type-environment.ts` and `twoslash-transformer.ts`; the model sits on `VirtualPackage` independently, with no edge between the model and the registry in either direction. See [The D1 outcome](tsdoctor-package-architecture.md) for why the substrate was extracted rather than hosted, and `type-loading-vfs.md` for the seam itself.

**`@tsdoctor/seo`** (phase 4) supplies every `<head>` concern behind one seam. `deriveSiteUrl` is consumed in `layers/config-resolution.ts`; `attributionFacts` + `packageContext` in `build-program.ts`, once per API; `deriveScriptBody` + `headTags` in `generateSinglePage`; the `HeadTag` vocabulary in `markdown/helpers.ts`, which renders each tag into an RSPress frontmatter `head` pair. The adapter's `og-resolver.ts` and `schemas/opengraph.ts` were **deleted** into it. What the adapter kept is `OgService` — filesystem probing of a configured local image, genuinely I/O and genuinely RSPress-path-shaped — now importing `imageMimeType` / `ogAltText` / `resolveUrl` from the package. See `structured-data-and-og.md`.

**`@tsdoctor/pages`** (phase 5) is the seventh core workspace and the one the page pipeline is written against. `build-stages.ts` imports `prepareWorkItems` (entry-point deduplication, synthetic bases, categorization, collision detection, the route map and member anchors — with `uncategorized` items and route `collisions` returned as DATA; the adapter's own `prepareWorkItems` is a reporting wrapper that emits `ItemSkipped` per uncategorized item and `RouteCollisionDetected` per collision before throwing `Routes.RouteCollisionError`), `buildPage` / `buildIndexPage` (the `ApiItem` → `Page` builders) and `buildNav` / `NavEntry` (the sidebar tree). Around it: `prettier-formatter.ts` wraps the package's `formatExampleCode` so both adapters format examples identically; `remark-with-api.ts` imports `stripTwoslashDirectives`; `plugin.ts` and `config-helpers.ts` take the scope helpers `normalizeBaseRoute` / `unscopedName`; and `llms-program.ts` imports the llms.txt text transforms (`parseLlmsTxtLine`, `filterLlmsTxt`, `generateStructuredLlmsTxt`, `filterLlmsFullTxt`, `generatePackageLlmsTxt`, `generatePackageLlmsFullTxt` — see `llms-integration.md`). What the adapter keeps is emission: `src/emit/mdx.ts` and `src/emit/meta.ts`. See `doc-ir-and-pages.md`.

### Stage 2 output convergence (resolved, phase 5)

An earlier "Stage 2" that would have emitted the MDX pages on top of the model's `renderItem` body was deferred because the eight page generators built MDX with JSX components carrying dual `code`/`source` props, so the plain-markdown body was not a clean substring of the output; converging needed a structured `bodyParts(item)` API. **That API is the `@tsdoctor/pages` block IR.** The generators are deleted; `buildPage` produces typed blocks with mdast prose and the adapter's `src/emit/mdx.ts` renders them, switched behind a byte-identical golden gate over all five fixture sites. The model's `Render` module is deprecated in favour of `@tsdoctor/pages`. Full record in `doc-ir-and-pages.md`.

## Plugin Lifecycle

### Hook Execution Order

```text
1. ApiExtractorPlugin(rawOptions)  -- factory
   - Decode options via Effect Schema
   - Classify api/apis via classifyApiConfig -> isInert
   - Call `makeAppLayers(...)` once for both layer stacks
   - Build the main ManagedRuntime and the sync-emitter ManagedRuntime from them
   - installSyncEmitter(emitterRuntime)

2. config(config, utils, isProd)  -- BEFORE route scanning
   - Pre-create output directories
   - Run Effect program (SKIPPED when inert):
     - VfsRegistry.clear(), clearTypeRoutes(), clearTwoslashAccess()
     - ConfigService.resolve() loads models, resolves types, registers
       Twoslash environments -> ReadonlyArray<ResolvedApiConfig>
     - installTwoslashAccess(yield* TwoslashEnvironments)
     - generateApiDocs() for each API config (concurrent)
     - Progress heartbeat forked when isProd (see build-progress-and-issues.md)
   - Register remark plugins (remarkWithApi, remarkApiCodeblocks)
   - Add runtime to builderConfig.source.include
   - LLMs resolve.alias + scope/globalUIComponents injection (SKIPPED when inert)
   - On failure: best-effort issues.json write (isProd only), then rethrow

3. beforeBuild()  -- intentionally empty
   (doc generation happens in config() to fix cold-start issues)

4. afterBuild(config, isProd)
   - Log build summary (first build only, skip HMR; SKIPPED when inert)
   - Write .api-docs/build/issues.json (isProd only, first build only; SKIPPED when inert)
   - LLMs post-processing (SKIPPED when inert)
   - Dispose runtime in production (preserves it for dev HMR)
```

RSPress invokes `config` as `config(config, utils, isProd)`; the plugin now consumes the real `isProd` flag (previously ignored) to gate the heartbeat fork and the `issues.json` write — see [Build Progress Heartbeat and Issues Artifact](build-progress-and-issues.md) for both.

The `isInert` steps are the [inert configuration](#inert-configuration) path: an explicitly empty `api`/`apis` option skips everything that depends on an API model, while the RSPress-facing wiring that must exist regardless (remark plugins, `source.include`) still runs.

### Doc Generation Pipeline

The `config()` hook runs the full doc generation as an Effect program:

```typescript
await effectRuntime.runPromise(
  Effect.gen(function* () {
    installTwoslashAccess(yield* TwoslashEnvironments);

    const configSvc = yield* ConfigService;
    const apiConfigs = yield* configSvc.resolve(rspressConfigSubset);

    yield* Effect.forEach(
      apiConfigs,
      (apiConfig) => generateApiDocs(apiConfig, fileContextMap),
      { concurrency: 2 },
    );
  }).pipe(Effect.scoped),
);
```

`generateApiDocs` takes the one API config and the file-context map; the build context it used to take as a second argument is gone with `ResolvedBuildContext`. `installTwoslashAccess` is wired here beside the other seams rather than inside `ConfigService.layer` — config resolution should compute a value, not also mutate module state as a side effect.

### Build Program (build-program.ts)

`generateApiDocs` orchestrates the 5 build stages for a single API:

1. **prepareWorkItems** -- `@tsdoctor/pages` computes work items, cross-link data, uncategorized items and collisions; the adapter wrapper reports them
2. **buildPipelineForApi** (Stream) -- Generate pages and write files
3. **writeMetadata** -- Root _meta.json, index page, category_meta.json
4. **cleanupAndCommit** -- Batch upsert snapshots, delete stale/orphans

See `page-generation-system.md` for the Stream pipeline details.

### Runtime Management

The `ManagedRuntime` is created once at plugin initialization and shared
across all hooks:

- **Production builds:** Runtime disposed in `afterBuild`, triggering
  scope finalizers (SQLite WAL checkpoint, resource cleanup)
- **Dev mode:** Runtime stays alive for HMR rebuilds. Disposing would
  destroy the DB connection and break subsequent builds.

### Artifact directories

All of the plugin's on-disk artifacts live under `<cwd>/.api-docs/`, split into two lifecycle subfolders. The snapshot SQLite DB (`SnapshotService.layer(dbPath)`) is `<cwd>/.api-docs/snapshot/api-docs.db` — the one artifact a production consumer site may choose to commit, for build idempotency between CI and local (see `snapshot-tracking-system.md`). Everything else the plugin writes for observability purposes — the JSONL trace and, on production builds, `issues.json` — lives under `<cwd>/.api-docs/build/` instead, since those are ephemeral per-build artifacts regenerated every run, never state to persist. This repo's fixture sites gitignore the whole `.api-docs/` directory in one line; a production site wanting DB idempotency instead gitignores only `.api-docs/build/` plus the snapshot dir's WAL sidecars and commits `.api-docs/snapshot/`. See `build-progress-and-issues.md` for both subfolders and the full gitignore story.

## Configuration System

### Inert configuration

`api` and `apis` are both optional and both nullable (`Schema.optional(Schema.NullOr(...))` in `schemas/config.ts`). Supplying `api: null`, `apis: null` or `apis: []` is an **explicit opt-in to an inert plugin** — the plugin validates its options and installs its RSPress wiring, but generates nothing. This lets a site add the plugin to `rspress.config.ts` before any API model exists, rather than having to comment the plugin out until the first model is built. Omitting BOTH keys entirely remains a configuration error (`"Must provide either 'api' or 'apis'."`); the distinction is between "I said there is no API" and "I forgot to say anything".

The pure classifier `classifyApiConfig(options)` (`config-utils.ts`) collapses the option shapes into an `ApiConfigMode`:

| Mode | Meaning |
| --- | --- |
| `configured` | At least one option carries real config. Generate docs. |
| `disabled` | A key carries an empty value (`api: null`, `apis: null`, `apis: []`). Inert. |
| `missing` | Neither key was supplied, or one was supplied as `undefined`. Fail validation. |

A populated option wins over an empty sibling, so `{ api: cfg, apis: [] }` classifies as `configured` rather than tripping the both-provided error — that error now fires only when both options carry real config.

An explicit `undefined` classifies as `missing`, not `disabled`, even though `Schema.optional` accepts it and the decoded object keeps the key. `undefined` is what a spread or a conditional produces when it yields nothing, so it is indistinguishable from a forgotten key and must keep failing validation; only a present, non-`undefined` value reads as a deliberate opt-in. That is why the classifier tests the values (`options.api !== undefined || options.apis !== undefined`) rather than key presence via `in`.

Two consumers read the classification:

- `validateOptions` (`layers/config-resolution.ts`) treats null/empty as absent (`apis: []` is no longer an error on its own) and returns successfully on `disabled`, so `resolve()` produces an empty `ResolvedApiConfig` array.
- `plugin.ts` computes `const isInert = classifyApiConfig(options) === "disabled"` once at factory time and uses it to gate the lifecycle hooks — see [Hook Execution Order](#hook-execution-order).

When inert, `config()` never runs the doc generation Effect program at all: no model loading, no `ManagedRuntime` build and therefore no snapshot SQLite database. The empty `.api-docs/snapshot/` directory is still created, deliberately — a stray sync emitter (a deprecation warning, a user-authored `with-api` code block) can still force the runtime to build, and SQLite opens its file eagerly at layer construction, so it would fail without the directory. `afterBuild` likewise skips the build summary, the `issues.json` write and LLMs post-processing, and `config()` skips the LLMs `resolve.alias` plus the `themeConfig.apiExtractorScopes` / `globalUIComponents` injection (see `llms-integration.md`). The remark plugin registration and the runtime `source.include` entry still happen, because user-authored `with-api` code blocks work without any API model.

The classifier is covered by `__test__/config-utils.test.ts`; the empty-result resolution for each inert spelling is covered by `__test__/config-service.test.ts`.

### ConfigService.resolve()

`ConfigService.layer` resolves the raw plugin options plus the RSPress config into the API configurations the pipeline runs over. The layer lives on the service; the implementation is `makeConfigService` in `layers/config-resolution.ts`, which is the bulk of the work and stays out of the module that declares the contract.

**Inputs:** `PluginConfig` (the decoded `PluginOptions`, resolved once at layer construction) and an `RspressConfigSubset` extracted from RSPress's `UserConfig` and passed to each `resolve` call.

**Output:** `ReadonlyArray<ResolvedApiConfig>` — fully resolved config per API (model, paths, categories, source, theme, the derived site URL, `ogImage`, docs roots).

**`ResolvedApiConfig` carries TWO views of the package's `package.json`** (phase 4). `packageJson` is the loose object that feeds dependency extraction, unchanged. `manifest?: PackageManifest` is the same file decoded through `@effected/package-json` — typed `Person` / `Repository` / SPDX license, which is the shape the SEO layer derives attribution from. Deliberately not the discovery-tier `LenientManifest`, which leaves `author` and `repository` as raw `string | Record` unions with no decoding at all. `PackageManifest` is presence-lenient but **shape-strict**, so one malformed field fails the whole decode — and that degrades to the field being absent with a `ConfigValidationWarning` emitted, never to a failed build. `decodeManifest` performs it at both resolution sites (single-API and multi-API). Replacing the loose field with the typed one is a separate refactor.

**The canonical site URL is derived, not configured.** The plugin's `siteUrl` option is **gone**; `RspressConfigSubset` carries RSPress's own `siteOrigin` and `base` instead, and `deriveSiteUrl(siteOrigin, base)` (now `@tsdoctor/seo`'s `Canonical.ts`; formerly `og-resolver.ts`) joins them in RSPress's documented `siteOrigin + base + routePath` order. Asking for the deployment URL a second time invited the two answers to disagree, and the plugin's would have won silently — emitting `canonical` and `og:url` tags for a host the site is not served from. With no `siteOrigin` the prefix is `""`, so URLs fall back to **root-relative** (`/api/class/foo`) and the tags are still emitted, matching RSPress's own documented `base + routePath` fallback and keeping them inspectable under `rspress dev` on localhost where no configured origin could be right. An earlier iteration omitted the tags entirely in that case; that was wrong, and it is why the head-tag block is gated on `packageName` alone rather than on a non-empty site URL. (As of phase 4 that gate lives in `generateSinglePage`, not `writeSingleFile` — see `page-generation-system.md`.)

**Error channel: `ConfigValidationError` only.** The declared signature used to be `Effect<…, ConfigValidationError | ApiModelLoadError | TypeRegistryError, Scope.Scope | TwoslashCacheService | TwoslashEnvironments>` and was over-wide in three separate ways: both extra error types were unreachable (model-load failures are `Effect.orDie`d after emitting `ModelLoadFailed`, and external type loading degrades rather than fails), and the `Scope.Scope` requirement was never needed. The implementation carried a trailing `as Effect<…>` cast to bridge the gap, which is exactly what a cast on a service method means — the declared contract had stopped matching the code. Both the extra members and the cast are gone; the requirement channel is `TwoslashCacheService | TwoslashEnvironments`.

**Three configuration failures are now typed rather than defects.** `loadPackageJson`, `validateExternalPackages` and `resolveTypeScriptConfig` (at two call sites) threw from inside `Effect.promise` bodies. A throw there escapes as an untyped DEFECT, so the build died with an unhandled rejection and wrote NO `issues.json` entry — the issues sink only ever sees events, and a defect is not a failure. All four `Effect.promise` bodies in that file are gone; each of these now fails with a `ConfigValidationError` carrying `field` and `reason`, plus an optional `cause` that preserves the original error rather than stringifying its message and discarding the stack. A malformed tsconfig stays fatal rather than degrading to default compiler options, which would type-check every example against a configuration the user did not ask for.

**Four error classes are deleted** from `errors.ts`: `ApiModelLoadError`, `PageGenerationError`, `TwoslashProcessingError` and `PrettierFormatError`. None was constructed anywhere in `src` — their only references were tests asserting their own message strings, a suite testing nothing but itself. What those subsystems actually report is a `PluginEvent` through the EventBus (`error-observability.md`), so the types were a second, unused error vocabulary sitting beside the real one. `ConfigValidationError` and `TypeRegistryError` remain, and the two `TaggedError` base constants they extend are no longer exported. One note for plan readers: Chunk 6 Task 6.1 of `.claude/plans/2026-08-25-rspress-adapter-refactor.md` speaks of "resurrecting" `PageGenerationError` — that is a proposal for a type that does not currently exist, not a description of the tree.

### Config resolution, split into siblings

`layers/config-resolution.ts` kept the long generator (859 lines down to roughly 676) and three concerns moved out beside it:

| Module | Contents |
| --- | --- |
| `layers/api-results.ts` | `mergeApiResult` (pure) + `emitVfsPayloadEvents` (effectful) |
| `layers/type-environment.ts` | `registerTypeEnvironments`, `resolveTsConfigTyped` |
| `layers/external-types.ts` | `mergeExternalTypes` |

`api-results.ts` collapses three near-identical ~35-line blocks — one per resolution path (versioned, single non-versioned, multi-API) — and is deliberately split along the pure/effectful seam rather than shipped as one helper: the multi-API path emits its events at a different moment than the other two, so a single combined helper would have fitted two paths and left the third with its own copy. The third copy had already drifted that way.

`external-types.ts` is the one phase that **degrades rather than fails** — external types are an enhancement, and without them code blocks render without Twoslash enrichment. `mergeExternalTypes` takes the type registry as an argument rather than yielding the tag, because `ConfigService.layer` resolves it once at layer construction; yielding it inside would move it into `resolve`'s per-call requirement channel, a different resolution point and a widened public signature for a dependency that does not vary per call.

A `resolveModels` extraction was considered and deliberately not made: that section touches 13 closure variables and mutates two of them that are read afterwards, so the cut would produce a worse interface than the code it replaced.

`ResolvedBuildContext`, the 16-field object this used to return, is **deleted**.
It was a bag the build carried because there was nowhere else to put things,
and most of it was neither produced nor owned by config resolution. Where each
field went:

| Former field | Now |
| --- | --- |
| `apiConfigs` | the entire return value |
| `combinedVfs`, `resolvedCompilerOptions`, `logLevel` | deleted — zero production readers |
| `twoslashTransformer` | deleted — `transformerFor(scope) ?? transformerFor()`, whose second operand could only fire when the first was already null |
| `highlighter` | `HighlighterService` |
| `ogResolver` | `OgService` |
| `tsEnvCache`, and the `TwoslashManager` singleton behind it | `TwoslashEnvironments` |
| `shikiCrossLinker` | one immutable `ShikiCrossLinker.fromRoutes(...)` per API, held behind that scope's `VfsRegistry` entry |
| `twoslashCache` / `twoslashEnvHash` | `TwoslashCacheService` + a per-build value lifted in `plugin.ts` (the env hash **is** the cache key) |
| `buildId`, `thresholds`, `logLevel`, `pageConcurrency`, `suppressExampleErrors` | `Context.Reference`s in `BuildEnv.ts` |
| `hideCutTransformer`, `hideCutLinesTransformer` | module-level immutable consts, imported directly from `hide-cut-transformer.ts` (note the naming trap: the field named `hideCutTransformer` held `MemberFormatTransformer`) |

The collapse is what makes phase 4 affordable. Its two build-scoped concerns —
OG image generation and JSON-LD derivation — would otherwise each have had
exactly one home: another field on the object and another argument on
`ConfigServiceLive(options, shikiCrossLinker, buildId, thresholds)` — a factory that no longer exists.

### Schema Types

Key config types defined via Effect Schema:

- `PluginOptions` -- Top-level plugin config; `api` and `apis` are each optional and nullable (see [Inert configuration](#inert-configuration))
- `SingleApiConfig` -- Config for single-API mode (`api:`)
- `MultiApiConfig` -- Config for multi-API mode (`apis:[]`)
- `CategoryConfig` -- API category definition (display name, folder, kinds)
- `ExternalPackageSpec` -- External package for type loading
- `VersionConfig` -- Multi-version configuration. It carries **no** `tsconfig` or `compilerOptions`: those levels of the resolution cascade were never read, so a multi-version site silently type-checked every version against the defaults. The unwired levels are deleted rather than wired, since nothing asked for them (see `type-loading-vfs.md`)

## Build Tooling

### `savvy.build.ts` and `build()`

`platforms/rspress/savvy.build.ts` is a self-executing build script: it imports `build` from `@savvy-web/rspress-builder` and top-level-awaits it. The call is deliberately small (RSPress plugins have a fixed shape) — the plugin passes `runtime: true`, `bundledPackages: ["@rspress/core", "@type/mdast", "@type/unist"]` and `meta.tsdoc.suppressWarnings` (the `ae-forgotten-export` rules). There is no `transform` and no per-registry package-name rewrite — the package publishes to npm only, under its own name:

```typescript
// platforms/rspress/savvy.build.ts (abridged)
import { build } from "@savvy-web/rspress-builder";

await build({
  runtime: true,
  bundledPackages: ["@rspress/core", "@type/mdast", "@type/unist"],
  meta: { tsdoc: { suppressWarnings: [ /* ae-forgotten-export rules */ ] } },
});
```

`build` produces the fixed two-entry shape — the Node plugin entry (`.`) and the **bundleless** React runtime (`./runtime`, `react`/`@theme` external). It applies the `import.meta.env` identity `define` (replacements are merged *after* it, so a user key can override intentionally) that keeps `import.meta.env.SSG_MD` a runtime expression for RSPress to resolve per site. The published `exports` (`./`, `./runtime`, `./tsconfig/rspress.json`) and `private: false` are produced by the builder's manifest handling. See `ssg-compatible-components.md` for the bundleless mechanism and the `build` surface in `@savvy-web/rspress-builder` for the full option set.

### Build output layout and the local link

The plugin emits the same per-file flat package shape into several roots. The dev build writes `dist/dev/pkg`, and the plugin's `publishConfig` (`directory: "dist/dev/pkg"`, `linkDirectory: true`) makes **that directory the workspace link target** — sites depending on `rspress-plugin-api-extractor` via `workspace:*` import the built per-file JS from `dist/dev/pkg`, not the `src/` sources. The production build emits the **published** root at `dist/prod/npm/pkg`, recorded in `dist/prod/targets.json` — publishing targets npm only (`publishConfig.targets: { npm: true }`; the former GitHub Packages target and its package-rename `transform` are gone). The source `platforms/rspress/package.json` keeps `private: true` with `src/`-pointing `exports`; the build rewrites these to the compiled form (`private: false`, `index.js` / `runtime/index.js`, plus the `tsconfig/rspress.json` export). Every one of these `pkg` roots carries the identical per-file flat layout (the runtime sits next to `index.js`), which is what makes the runtime component paths layout-invariant — see [Per-file Plugin and Bundleless Runtime](#per-file-plugin-and-bundleless-runtime) and `ssg-compatible-components.md`.

### TypeScript Configuration

The plugin uses a standalone `tsconfig.json` with
`"module": "esnext"` and `"moduleResolution": "bundler"` because:

- Root config uses `"module": "node20"` (incompatible with API Extractor)
- API Extractor requires `"moduleResolution": "bundler"`

The package also publishes a standalone **RSPress tsconfig** at `rspress-plugin-api-extractor/tsconfig/rspress.json` (source `platforms/rspress/public/tsconfig/rspress.json`), which the documentation sites extend from. It is a standard RSPress/React-JSX bundler-resolution config (`jsx: react-jsx`, `module: esnext`, `verbatimModuleSyntax`) and is exported as a third entry point alongside `.` and `./runtime`.

### Component Registration

Components are imported directly in generated MDX files (NOT via
RSPress `globalComponents`):

```typescript
import { SignatureBlock, ParametersTable }
  from "rspress-plugin-api-extractor/runtime";
```

## Development Workflow

### Local Development

```bash
pnpm run build          # Build plugin + modules
pnpm dev                # Start basic site dev server
```

### Watch Mode

```bash
cd package && pnpm dev   # Rebuilds on file changes
```

### Dev and preview servers (`serve`)

The plugin exports a `serve(options?: ServeOptions): Promise<void>` runner (`src/serve.ts`) from the main entry, used by every site's `lib/scripts/dev.mts` / `preview.mts` (they just call `serve({ mode, openPath })`). It frees the target port (best-effort `lsof`), spawns `pnpm rspress dev|preview --port <port>`, streams output and opens a browser once the server is ready. Readiness is detected from RSPress's `Local:` address line (cross-mode), with a dev `built in` fallback (`isServerReady(mode, output)`). `open` is a lazy dynamic import and a plugin dependency.

`ServeOptions`, `ServeMode`, `ResolvedServeConfig` and the pure helpers `isServerReady` and `resolveServeConfig` are exported from `rspress-plugin-api-extractor`. The two pure helpers carry the testable logic (readiness predicate, default/config resolution); the spawning side effects are not unit-tested. See `src/serve.ts` for the option defaults (`port`, `open`, `openPath`, `packageManager`, `cwd`, `readyWhen`).

### Key Source Files

**No barrel modules inside `src/`.** `schemas/index.ts` and `markdown/index.ts` are deleted, and the 38 files that went through them import concrete modules. A barrel counts as a consumer of everything it re-exports, so it hides unused exports from every reachability check — removing these two immediately surfaced an orphan the first dead-code scan had scored as live. `index.ts`, the package's public entry, stays a barrel; that is what it is for.

| File | Purpose |
| --- | --- |
| `savvy.build.ts` | Build script: top-level `build()` call |
| `index.ts` | Public barrel: plugin, `serve` API, config schemas/types |
| `plugin.ts` | RSPress adapter, runtime management |
| `serve.ts` | `serve` dev/preview runner + pure config/readiness helpers |
| `build-program.ts` | Doc generation orchestration |
| `build-stages.ts` | Stream pipeline (`buildPage` → `emitMdxBody`), the reporting `prepareWorkItems` wrapper, file writes |
| `config-helpers.ts` | `fromDir` / `fromParentDir` config builders (delegating to `@tsdoctor/bundle` discovery) |
| `config-utils.ts` | `classifyApiConfig`, `mergeLlmsPluginConfig`, dependency extraction |
| `sync-node-fs.ts` | Sync `FileSystem` bridge for running bundle discovery under the sync helper API |
| `markdown/helpers.ts` | `generateFrontmatter` — the one helper left after phase 5 moved example preparation to `@tsdoctor/pages` |
| `emit/mdx.ts` | `emitMdxBody` + `escapeMdxGenerics` — renders a `@tsdoctor/pages` `Page` as RSPress MDX |
| `emit/meta.ts` | `renderRootMeta` / `renderCategoryMeta` / `emitIndexPage` — `_meta.json` and `index.mdx` from the nav tree and `IndexPage` |
| `BuildEnv.ts` | The per-build `Context.Reference`s (`BuildId`, `Thresholds`, `PageConcurrency`, `SuppressExampleErrors`) |
| `twoslash-access.ts` | Module-level holder bridging RSPress's render pass to `TwoslashEnvironments` |
| `observability/sync-emitter.ts` | The one sync-island bridge (`installSyncEmitter` / `emitSync`) |
| `services/OgService.ts` | Filesystem probing of a configured OG image; the pure URL/MIME/metadata helpers it used to sit on moved to `@tsdoctor/seo` and `og-resolver.ts` is deleted |
| `layers/xdg.ts` | `TSDOCTOR_NAMESPACE`, `PlatformLive`, `AppDirsLive` — one home for both cache-backed layers |
| `layers/AppLayer.ts` | `makeAppLayers` — the tiered stack, returning both runtimes' layers |
| `layers/config-resolution.ts` | `makeConfigService`: config resolution, model loading |
| `layers/api-results.ts` | `mergeApiResult` / `emitVfsPayloadEvents` — the per-API accumulator seam |
| `layers/type-environment.ts` | `registerTypeEnvironments`, `resolveTsConfigTyped` |
| `layers/external-types.ts` | `mergeExternalTypes` — the one resolution phase that degrades |
| `layers/observability.ts` | Sinks, logger gate, build summary |
| `schemas/config.ts` | Effect Schema definitions |

## Related Documentation

- **Component Development:**
  `component-development.md`
- **SSG-Compatible Components:**
  `ssg-compatible-components.md`
- **Page Generation System:**
  `page-generation-system.md`
- **Snapshot Tracking:**
  `snapshot-tracking-system.md`
- **LLMs Integration:**
  `llms-integration.md`
- **Type Loading & VFS:**
  `type-loading-vfs.md`
- **Build Progress & Issues Artifact:**
  `build-progress-and-issues.md`
- **Structured Data & Head Metadata:**
  `structured-data-and-og.md`
- **Doc IR and `@tsdoctor/pages`:**
  `doc-ir-and-pages.md`
