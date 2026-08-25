---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 90
related:
  - rspress-plugin-api-extractor/component-development.md
  - rspress-plugin-api-extractor/ssg-compatible-components.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
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

The plugin half is emitted **per-file**: every `src/*.ts` becomes its own `.js` under `dist/dev/pkg/`, mirroring the source tree (e.g. `plugin.js`, `build-program.js`, `layers/ConfigServiceLive.js`), with sibling imports preserved as relative `./...js` specifiers and `dependencies` left external. It owns the RSPress lifecycle hooks (config, beforeBuild, afterBuild), Effect service layer initialization and runtime management, the doc generation pipeline and the remark plugins for code block processing. A bundled `index.d.ts` is emitted alongside, inlining the declarations of any `bundledPackages` (here `@rspress/core`, `@type/mdast`, `@type/unist`).

### Runtime components (bundleless, React/browser)

**Published export:** `./runtime` → `{ "types": "./runtime/index.d.ts", "import": "./runtime/index.js" }`. **Environment:** Browser (RSPress SSG and client-side).

The runtime is **not** compiled into a single `runtime/index.js` bundle, nor shipped as raw `.tsx`. The builder's `build()` (from `@savvy-web/rspress-builder`) emits it **bundleless**: each component is transpiled 1:1 into its own `.js` under `runtime/`, mirroring the `src/runtime/...` tree, with `react`/`@theme` external and `import.meta.env` left as a runtime expression. **RSPress then compiles each referenced `.js` per site build.** This is required for `import.meta.env.SSG_MD` to resolve correctly (a single bundle froze it to `undefined`, breaking the SSG-MD dual-mode branch) and so the `globalUIComponents` / `resolve.alias` registrations in `plugin.ts` can point at real per-component `.js` files. A bundled `runtime/index.d.ts` (types only) is also emitted so the export's `types` condition resolves. See `ssg-compatible-components.md` for the bundleless mechanism and why component-path resolution is layout-invariant.

The runtime provides the React components that render API documentation: signature/example blocks, parameter and enum tables, the interactive wrap/copy buttons and the Twoslash hover tooltips and error display.

### Build tooling

**Builder:** `@savvy-web/rspress-builder`'s `build()`, which is built on the tsdown-based `@savvy-web/bundler`. The plugin builds via a self-executing `platforms/rspress/savvy.build.ts` that top-level-awaits `build({...})`. `build` produces the two-entry shape automatically — the Node plugin entry (`.`) and the bundleless React runtime (`./runtime`); the plugin half is not a single bundle but per-file JS. **Module system:** ESM with `"module": "esnext"` and `"moduleResolution": "bundler"`. **CSS processing:** CSS modules (no Sass) for runtime components, compiled by RSPress alongside the transpiled JS.

## Effect Service Layer

### Service Architecture

The plugin uses Effect's Context/Layer/Service pattern for dependency injection. Every service tag is declared in the v4 form, `class X extends Context.Service<X, XShape>()("rspress-plugin-api-extractor/X")`:

```text
plugin.ts (RSPress adapter)
  |
  +-> BuildEnvLayer (Context.References; provided to BOTH runtimes)
  |     BuildId, Thresholds, PageConcurrency, SuppressExampleErrors
  |
  +-> EffectAppLayer = Layer.provideMerge(ConfigServiceLive, BaseLayer)
  |     |
  |     +-> ConfigServiceLive          (a module-level const, not a factory)
  |     |     Resolves plugin options + RSPress config into
  |     |     ReadonlyArray<ResolvedApiConfig>
  |     |
  |     +-> PluginConfigLive           Layer.succeed(PluginConfig, options)
  |     |
  |     +-> HighlighterServiceLive(themes)
  |     |     Shiki highlighter acquired/released at runtime lifetime
  |     |
  |     +-> TwoslashEnvironmentsLive   Per-config Twoslash environments
  |     |
  |     +-> OgServiceLive              Open Graph image resolution
  |     |     (provided PlatformLive locally)
  |     |
  |     +-> TypeRegistryServiceLive    External package type loading
  |     |     Edge-composed @tsdoctor/registry stack over layers/xdg.ts
  |     |
  |     +-> TwoslashCacheServiceLive   XDG sqlite Twoslash result cache
  |     |
  |     +-> SnapshotServiceLive (from @tsdoctor/snapshot)
  |     |     SQLite via @effected/store Store.layerSqlite
  |     |     StoreMigration list applied at layer construction
  |     |     WAL checkpoint finalizer via checkpointOnClose: true
  |     |
  |     +-> EventBus layer (from buildEventBus)
  |     |     Synchronous fan-out: console, metrics, issues, render,
  |     |     optional trace sinks
  |     |
  |     +-> metricStore.layer          Per-build MetricRegistry
  |     |
  |     +-> makeSummaryLoggerLayer     Effect Logger gating Effect.log* calls
  |     |
  |     +-> NodeFileSystem.layer       Node FileSystem implementation
  |
  +-> ManagedRuntime.make(EffectAppLayer)        the main runtime
  |
  +-> ManagedRuntime.make(                        the sync-emitter runtime
        eventBusLayer + metricStore.layer
        + makeSummaryLoggerLayer + BuildEnvLayer)
```

### Two runtimes, deliberately

There are **two** `ManagedRuntime`s and they must not be merged back into one.

The main runtime's layer opens two SQLite databases at construction — the snapshot store and the Twoslash result cache — because both cache-backed layers acquire their stack at layer-construction time rather than inside each method body (see [Layer acquisition](#layer-acquisition-and-memoization)). That makes `EffectAppLayer` **asynchronous to build**, and `makeRuntimeEmitter`'s `runtime.runSync` builds a runtime's layer before running anything, so the first sync emit from a remark plugin died with `AsyncFiberError` during RSPress's render pass — invisible to every unit test.

The sync-island emitters therefore run on their own small runtime over `Layer.succeed`-only layers (`eventBusLayer`, `metricStore.layer`, the summary logger and `BuildEnvLayer`), which stays synchronously buildable. `metricStore.layer` is shared **by reference** between the two runtimes, which is what keeps the metrics sink's writes and `logBuildSummary`'s reads in one registry; breaking that sharing is the silent all-zeros failure the store exists to prevent. Beyond the bug that surfaced it, the split states an invariant worth keeping: **an event emitter has no business forcing a database open.**

### Per-build configuration as `Context.Reference`s

`src/BuildEnv.ts` holds the values that used to travel by hand as constructor arguments and god-object fields:

| Reference | Default | Read by |
| --- | --- | --- |
| `BuildId` | `""` | `EventBus.emit` (fills `ctx.buildId`), `sync-emitter.ts` |
| `Thresholds` | the `ResolvedObservability` defaults | `withPhase` / `withOp` (`observability/spans.ts`) |
| `PageConcurrency` | `1` (`plugin.ts` provides `os.cpus().length`) | `build-program.ts` |
| `SuppressExampleErrors` | `true` | `build-program.ts` |

A `Context.Reference` carries a default, so a wiring mistake **succeeds quietly with the default** rather than failing. That is why the decoded plugin options are a `Context.Service` (`services/PluginConfig.ts`) and not a Reference: there is no sensible default for "which APIs is this site documenting", so forgetting to provide it must be a loud "service not provided". The same reasoning makes the Shiki themes a **layer argument** to `HighlighterServiceLive` rather than a Reference. Use a Reference only where the default is merely conservative, never where it would be silently wrong.

### Service Interfaces

| Service | Location | Purpose |
| --- | --- | --- |
| `ConfigService` | `services/ConfigService.ts` | Resolve options + RSPress config into `ReadonlyArray<ResolvedApiConfig>` |
| `PluginConfig` | `services/PluginConfig.ts` | The decoded `PluginOptions` |
| `HighlighterService` | `services/HighlighterService.ts` | The build's single Shiki highlighter |
| `TwoslashEnvironments` | `services/TwoslashEnvironments.ts` | Per-compiler-config Twoslash environments and transformers |
| `OgService` | `services/OgService.ts` | Open Graph image resolution, typed `OgImageError` |
| `TwoslashCacheService` | `services/TwoslashCacheService.ts` | Persisted Twoslash result cache (load-once / save-once) |
| `TypeRegistryService` | `services/TypeRegistryService.ts` | External type loading |
| `SnapshotService` | `@tsdoctor/snapshot` (`packages/snapshot/src/SnapshotService.ts`, tag id `"@tsdoctor/snapshot/SnapshotService"`) | Incremental build tracking |
| `EventBus` | `observability/EventBus.ts` | Synchronous event fan-out |

`PathDerivationService` is **deleted**. It was a `Layer.succeed` over two pure functions whose declared `PathDerivationError` was unreachable, and it was already bypassed at seven call sites that imported the pure functions from `path-derivation.ts` directly. `plugin.ts` even composed the layer into the stack without ever using it. The pure module and its tests remain — that is where the coverage always lived.

### Layer Implementations

| Layer | Location | Key Dependencies |
| --- | --- | --- |
| `ConfigServiceLive` | `layers/ConfigServiceLive.ts` | `TypeRegistryService`, `PluginConfig` |
| `HighlighterServiceLive(themes)` | `layers/HighlighterServiceLive.ts` | (none; `Effect.acquireRelease` over `createHighlighter`) |
| `TwoslashEnvironmentsLive` | `layers/TwoslashEnvironmentsLive.ts` | (none) |
| `OgServiceLive` | `layers/OgServiceLive.ts` | `FileSystem`, `Path` (provided `PlatformLive` locally) |
| `TwoslashCacheServiceLive` | `layers/TwoslashCacheServiceLive.ts` | `@effected/store` `Cache`, `layers/xdg.ts` |
| `TypeRegistryServiceLive` | `layers/TypeRegistryServiceLive.ts` | `@tsdoctor/registry`, `@effected/store`, `layers/xdg.ts`, `@effect/platform-node` |
| `SnapshotServiceLive` | `@tsdoctor/snapshot` (`packages/snapshot/src/SnapshotServiceLive.ts`) | `@effected/store` (`Store.layerSqlite`) |
| `buildEventBus` (EventBus layer) | `layers/ObservabilityLive.ts` | Synchronous fan-out event bus |
| `makeSummaryLoggerLayer` | `layers/ObservabilityLive.ts` | Effect Logger gate for `Effect.log*` calls |

`ConfigServiceLive` is a **zero-argument module-level `const`**, not a layer-returning factory. Layers memoize by reference, so a factory called twice mints two layers — with a second `ConfigService` capturing its own `TypeRegistry`. Making it a `const` turns "call it twice" into a type error rather than a test case. `HighlighterServiceLive` remains a factory (it takes the collected themes as its layer argument), which is why `plugin.ts` binds its result to a `const` before merging: a second call would acquire a second highlighter.

### Layer acquisition and memoization

`TypeRegistryServiceLive` and `TwoslashCacheServiceLive` used to call `Effect.provide(SomeLayerConst)` *inside each method body*. In Effect v4 `provideLayer` is a `scopedWith` over `buildWithScope` that forks a **child** `MemoMap` whose parent never built the layer, so the registry stack (XDG + `metadata.sqlite` + undici + `TypeCache`) and the Twoslash cache were each built and torn down twice per build. Both are now `Layer.effect(Service, …).pipe(Layer.provide(TheLayer))`, acquiring once at `ManagedRuntime` construction.

Both cache-backed layers must **degrade to a cache miss** rather than fail. Moving acquisition to layer-construction time moved the failure mode from "this method fails and its local catch absorbs it" to "the `ManagedRuntime` build aborts the whole site build" — a purely structural-looking change that silently violated `TwoslashCacheService`'s documented contract. Both layers therefore wrap in `Layer.catchCause` and degrade; the type system was the only thing that noticed, when the layer's error channel went from `never` to `CacheError | AppDirsError | XdgEnvError`.

Both also share one platform and XDG root, `src/layers/xdg.ts`, exporting `TSDOCTOR_NAMESPACE`, `PlatformLive` and `AppDirsLive`. Each file previously declared its own — including a copy-pasted `"tsdoctor"` namespace literal. Two distinct layer references build twice, and a drifted namespace literal is permanent and silent: the caches move directory, every lookup misses, and a build that should hit a warm Twoslash cache goes cold forever with nothing in the output to notice.

### Effect v4 and the peer dependency closure

The plugin runs on **Effect v4** (`effect@4.0.0-rc.109`, pinned through the `catalog:effect` catalog supplied by `@effected/pnpm-plugin-effect`). Two v3 packages are gone because their contents merged into the `effect` core: `@effect/platform` (FileSystem is now the top-level `effect` `FileSystem` module) and `@effect/sql` (now `effect/unstable/sql`). `@effect/platform-node` and `@effect/sql-sqlite-node` remain as separate node-platform packages.

The v3 peer-closure block (`@effect/cluster`, `@effect/experimental`, `@effect/rpc`, `@effect/workflow`) has been **removed**: the v4 peer graph is small enough that issue #69's escaping-peer problem no longer applies in that form. The closure principle still holds, though — because the per-file plugin build leaves `dependencies` external, any unclosed non-optional peer escapes to the consuming workspace where pnpm `autoInstallPeers` can bind it unpredictably. As of phase 2 the closure lives in the plugin's `dependencies` block (only `@rspress/core`/`react`/`react-dom` remain peers):

- `ioredis` — non-optional peer of the `@effect/platform-node` v4 beta.
- The full `@effected` surface the four `@tsdoctor/*` workspaces ride on, all via `catalog:effected`: `@effected/semver`, `@effected/store`, `@effected/tsconfig-json`, `@effected/xdg` (registry closure) plus the phase-2 additions `@effected/github`, `@effected/glob`, `@effected/npm`, `@effected/package-json`, `@effected/walker` (bundle closure) and `@effected/yaml` (frontmatter handling), alongside `@typescript/vfs`. The released effected round-1 kit wave added two more: `@effected/jsonc` (canonical JSON-value hashing behind `@tsdoctor/bundle`'s `BundleHash.ts`) and `@effected/markdown` (frontmatter block assembly in `frontmatter.ts` and, transitively, `@tsdoctor/model`'s prose/render internals).
- The four core workspaces themselves: `@tsdoctor/registry`, `@tsdoctor/model`, `@tsdoctor/bundle`, `@tsdoctor/snapshot`, each `workspace:*`.

`@effect/sql-sqlite-node` and `gray-matter` are **gone** from the plugin manifest — SQLite moved behind `@tsdoctor/snapshot`'s `Store.layerSqlite`, and frontmatter parsing moved to `@effected/yaml` (see `frontmatter.ts` in [Key Source Files](#key-source-files)). Do not prune the closure entries as "unused"; the plugin imports some of them directly (see `layers/TypeRegistryServiceLive.ts`, `sync-node-fs.ts`, `frontmatter.ts`, `twoslash-transformer.ts`) and the rest exist to keep the dependency graph closed.

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
- `schemas/opengraph.ts` -- `OpenGraphImageConfig`
- `schemas/performance.ts` -- `PerformanceConfig`

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

The helpers no longer inject a default `baseRoute`. When the caller omits it the route is left unset and the plugin applies a context-aware default during resolution in `ConfigServiceLive`: under `api:` it mounts at `/api` (`baseRoute ?? "/"`), under `apis:` at `/{packageName}/api` (`baseRoute ?? "/${unscopedName(packageName)}"`), in both cases appending `apiFolder ?? "api"`. This fixes a bug where a single-API site using the helper generated docs at `/{dirname}/api` instead of `/api`. Callers can still pass an explicit `baseRoute` -- a `{dirname}` / `{packageName}` template string or an `(info: DirInfo) => string` callback -- to override.

The helper types (`DirInfo`, `BaseRoute`, `FromDirOptions`) are re-exported from `src/index.ts`; both helpers share `FromDirOptions`.

## Core Package Consumption

The plugin depends on all four `@tsdoctor/*` core workspaces via `workspace:*` and, since the phase-2 model redesign, consumes **`@tsdoctor/model`** directly — the four phase-1 delegation shims (`loader.ts`, the class-based `model-loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`) are **deleted**. The model's v4 surface is namespace modules: `Model` (Effect-typed loading with `ModelNotFoundError`/`ModelParseError`/`EmptyModelError`), `Tsdoc` (pure TSDoc accessors), `ApiItems` (categorization + namespace members), `EntryPoints`, `Routes`, `SyntheticBases`, `Signature` (de-classed formatting), `Render`, the `CrossLinker` class and the `@alpha` `StructuredData` stub.

How the former shim call sites consume it now:

| Concern | Now |
| --- | --- |
| Model loading | `model-loader.ts` is plain functions over `Model.load` (typed `ModelLoadError = Model.ModelNotFoundError \| Model.ModelParseError \| Model.EmptyModelError`); failures emit `ModelLoadFailed` via `Effect.tapError` in `ConfigServiceLive` (see `build-progress-and-issues.md`) |
| TSDoc extraction | page generators call `Tsdoc.summary`/`Tsdoc.params`/`Tsdoc.releaseTag`/`Tsdoc.deprecation` etc. directly |
| Signature formatting | `Signature.format(excerpt)` directly (the `TypeSignatureFormatter` class is gone) |
| Categorization | `ApiItems.categorize(items, categories)` returning `{ items, uncategorized }`; the adapter emits an `ItemSkipped` event per uncategorized item |
| Prose cross-linking | `markdown/prose-linker.ts`, a 15-line module-level holder (`setProseLinker(routes)` / `linkProse(text)` / `clearProseLinker()`) over the model `CrossLinker` (see `cross-linking-architecture.md`) |

**Not delegated — looks similar, is not.** `ApiExtractedPackage` (`api-extracted-package.ts`) keeps its OWN private `extractPlainText`. Despite the shared name with the library helper, it is a different algorithm for declaration reconstruction: it PRESERVES `{@link X.Y}` TSDoc syntax and reconstructs fenced code blocks for `.d.ts`/JSDoc output, whereas the library's prose extraction flattens `{@link}` to display text and drops code fences. The two are not interchangeable.

**`@tsdoctor/bundle`** supplies discovery for the config helpers (see [Config Helpers](#config-helpers)) plus the npm-tarball and GitHub-release fetchers (`bundle-spec.md`). **`@tsdoctor/snapshot`** supplies the snapshot service (`snapshot-tracking-system.md`). **`@tsdoctor/registry`** is unchanged in role (`type-loading-vfs.md`), with its tag ids renamed to `"@tsdoctor/registry/..."` in phase 2.

### Stage 2 output convergence (deferred)

A "Stage 2" that would emit the MDX pages on top of the library's `renderItem` body was evaluated and **deferred**. The page generators emit MDX with JSX components (`<ApiSignature>`, `<ParametersTable>`, `<ApiMember>`, `<ApiExample>`) carrying dual `code`/`source` props for Shiki + Twoslash, so the library's plain-markdown body is not a clean substring of the generated output. Converging would require the library to expose a structured `bodyParts(item)` API. The full diff and decision are recorded at `docs/superpowers/notes/2026-06-01-renderitem-vs-pagegen-diff.md`.

## Plugin Lifecycle

### Hook Execution Order

```text
1. ApiExtractorPlugin(rawOptions)  -- factory
   - Decode options via Effect Schema
   - Classify api/apis via classifyApiConfig -> isInert
   - Build BuildEnvLayer (References) + BaseLayer + EffectAppLayer
   - Build the main ManagedRuntime and the sync-emitter ManagedRuntime
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
    const configSvc = yield* ConfigService;
    const buildContext = yield* configSvc.resolve(rspressConfigSubset);

    yield* Effect.forEach(
      buildContext.apiConfigs,
      (apiConfig) => generateApiDocs(apiConfig, buildContext, fileContextMap),
      { concurrency: 2 },
    );
  }).pipe(Effect.scoped),
);
```

### Build Program (build-program.ts)

`generateApiDocs` orchestrates the 5 build stages for a single API:

1. **prepareWorkItems** -- Categorize items, build cross-link data
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

All of the plugin's on-disk artifacts live under `<cwd>/.api-docs/`, split into two lifecycle subfolders. The snapshot SQLite DB (`SnapshotServiceLive(dbPath)`) is `<cwd>/.api-docs/snapshot/api-docs.db` — the one artifact a production consumer site may choose to commit, for build idempotency between CI and local (see `snapshot-tracking-system.md`). Everything else the plugin writes for observability purposes — the JSONL trace and, on production builds, `issues.json` — lives under `<cwd>/.api-docs/build/` instead, since those are ephemeral per-build artifacts regenerated every run, never state to persist. This repo's fixture sites gitignore the whole `.api-docs/` directory in one line; a production site wanting DB idempotency instead gitignores only `.api-docs/build/` plus the snapshot dir's WAL sidecars and commits `.api-docs/snapshot/`. See `build-progress-and-issues.md` for both subfolders and the full gitignore story.

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

- `validateOptions` (`layers/ConfigServiceLive.ts`) treats null/empty as absent (`apis: []` is no longer an error on its own) and returns successfully on `disabled`, so `resolve()` produces an empty `ResolvedApiConfig` array.
- `plugin.ts` computes `const isInert = classifyApiConfig(options) === "disabled"` once at factory time and uses it to gate the lifecycle hooks — see [Hook Execution Order](#hook-execution-order).

When inert, `config()` never runs the doc generation Effect program at all: no model loading, no `ManagedRuntime` build and therefore no snapshot SQLite database. The empty `.api-docs/snapshot/` directory is still created, deliberately — a stray sync emitter (a deprecation warning, a user-authored `with-api` code block) can still force the runtime to build, and SQLite opens its file eagerly at layer construction, so it would fail without the directory. `afterBuild` likewise skips the build summary, the `issues.json` write and LLMs post-processing, and `config()` skips the LLMs `resolve.alias` plus the `themeConfig.apiExtractorScopes` / `globalUIComponents` injection (see `llms-integration.md`). The remark plugin registration and the runtime `source.include` entry still happen, because user-authored `with-api` code blocks work without any API model.

The classifier is covered by `__test__/config-utils.test.ts`; the empty-result resolution for each inert spelling is covered by `__test__/config-service.test.ts`.

### ConfigService.resolve()

`ConfigServiceLive` (`layers/ConfigServiceLive.ts`) resolves the raw plugin
options plus the RSPress config into the API configurations the pipeline runs
over.

**Inputs:**

- `PluginConfig` (the decoded `PluginOptions`, from the layer context)
- `RspressConfigSubset` (extracted from RSPress `UserConfig` at config time,
  passed to `resolve`)

**Output:** `ReadonlyArray<ResolvedApiConfig>` — fully resolved config per API
(model, paths, categories, source, theme, `siteUrl`/`ogImage`, docs roots).

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
`ConfigServiceLive(options, shikiCrossLinker, buildId, thresholds)`.

### Schema Types

Key config types defined via Effect Schema:

- `PluginOptions` -- Top-level plugin config; `api` and `apis` are each optional and nullable (see [Inert configuration](#inert-configuration))
- `SingleApiConfig` -- Config for single-API mode (`api:`)
- `MultiApiConfig` -- Config for multi-API mode (`apis:[]`)
- `CategoryConfig` -- API category definition (display name, folder, kinds)
- `ExternalPackageSpec` -- External package for type loading
- `VersionConfig` -- Multi-version configuration

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

| File | Purpose |
| --- | --- |
| `savvy.build.ts` | Build script: top-level `build()` call |
| `index.ts` | Public barrel: plugin, `serve` API, config schemas/types |
| `plugin.ts` | RSPress adapter, runtime management |
| `serve.ts` | `serve` dev/preview runner + pure config/readiness helpers |
| `build-program.ts` | Doc generation orchestration |
| `build-stages.ts` | Stream pipeline, page gen, file writes |
| `config-helpers.ts` | `fromDir` / `fromParentDir` config builders (delegating to `@tsdoctor/bundle` discovery) |
| `config-utils.ts` | `classifyApiConfig`, `mergeLlmsPluginConfig`, dependency extraction |
| `sync-node-fs.ts` | Sync `FileSystem` bridge for running bundle discovery under the sync helper API |
| `frontmatter.ts` | gray-matter-parity frontmatter split/join over `@effected/yaml` |
| `markdown/prose-linker.ts` | Per-build prose cross-linker holder over the model `CrossLinker` |
| `BuildEnv.ts` | The per-build `Context.Reference`s (`BuildId`, `Thresholds`, `PageConcurrency`, `SuppressExampleErrors`) |
| `twoslash-access.ts` | Module-level holder bridging RSPress's render pass to `TwoslashEnvironments` |
| `observability/sync-emitter.ts` | The one sync-island bridge (`installSyncEmitter` / `emitSync`) |
| `og-resolver.ts` | Pure, filesystem-free OG URL/MIME/metadata helpers behind `OgService` |
| `layers/xdg.ts` | `TSDOCTOR_NAMESPACE`, `PlatformLive`, `AppDirsLive` — one home for both cache-backed layers |
| `layers/ConfigServiceLive.ts` | Config resolution, model loading |
| `layers/ObservabilityLive.ts` | Metrics, logger, build summary |
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
