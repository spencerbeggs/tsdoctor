# platforms/rspress/CLAUDE.source-map.md

File-by-file map of `src/`, plus the interactive frontend debugging loop.
Loaded from `platforms/rspress/CLAUDE.md`.

## Source Structure

- `src/index.ts` — main plugin entry (re-exports plugin.ts, serve.ts)
- `src/plugin.ts` — RSPress adapter: calls `makeAppLayers`, builds both `ManagedRuntime`s over the returned stacks, installs the sync-emitter and Twoslash-access holders, `isInert` lifecycle gating
- `src/BuildEnv.ts` — the per-build `Context.Reference`s: `BuildId`, `Thresholds`, `PageConcurrency`, `SuppressExampleErrors`
- `src/twoslash-access.ts` — module-level holder bridging RSPress's render pass to `TwoslashEnvironments`; installed from inside a fiber, never bound to a runtime
- `src/path-derivation.ts` — pure route/output path functions, imported directly (the former `PathDerivationService` is deleted)
- `src/og-resolver.ts` is **deleted** (phase 4) — its pure URL/MIME/alt helpers moved to `@tsdoctor/seo` (`Canonical.ts`, `OpenGraph.ts`), along with `schemas/opengraph.ts`. The adapter keeps only `services/OgService.ts`, which is genuinely I/O (filesystem probing of a configured local image). The plugin's `siteUrl` option is **removed**: the canonical URL comes from RSPress's own `siteOrigin` + `base` (both on `RspressConfigSubset`) via `deriveSiteUrl`. With no `siteOrigin` the URLs fall back to root-relative and the tags are still emitted — `sites/basic` sets `siteOrigin` + `ogImage`, so this path is exercised end to end
- `src/serve.ts` — public `serve(options?)` dev/preview RSPress server runner (also exports `ServeOptions`/`ServeMode`/`ResolvedServeConfig`/`isServerReady`/`resolveServeConfig`); used by the sites' `lib/scripts/dev.mts`/`preview.mts`
- `src/build-program.ts` — doc generation orchestration (5-stage pipeline)
- `src/build-stages.ts` — Stream pipeline, page gen, file writes. **`generateSinglePage` builds the page's head tags** (OG resolve → `deriveScriptBody` → `headTags`) and assembles the final frontmatter BEFORE hashing it; `writeSingleFile` just writes `result.content`. Do not move head-tag construction back into the write stage — that is what made head tags invisible to change detection
- `src/config-utils.ts` — pure config helpers shared by `layers/config-resolution.ts` and `plugin.ts`: `classifyApiConfig` (inert detection), `mergeLlmsPluginConfig`, dep extraction
- `src/config-helpers.ts` — `fromDir`/`fromParentDir` config builders, delegating discovery to `@tsdoctor/bundle`
- `src/sync-node-fs.ts` — sync `FileSystem` bridge so bundle discovery runs under the sync helper API
- `src/model-loader.ts` — plain functions over `@tsdoctor/model`'s `Model.load` (typed `ModelLoadError`)
- `src/frontmatter.ts` — gray-matter-parity frontmatter split/join over `@effected/yaml` (the `gray-matter` dep is gone). The parse side keeps a hand-rolled split (`@effected/markdown`'s `FrontmatterSource.split` was rejected — its strict fence grammar conflicts with the pinned gray-matter quirks); emission uses `FrontmatterSource.join` + `Yaml.stringify({ quoteCompat: "yaml-1.1", quoteStyle: "double" })`
- `src/tsconfig-parser.ts` — reads a `tsconfig.json` through `@effected/tsconfig-json`'s `TsconfigLoaderSync`; does **not** import the TypeScript compiler. It reports the tsconfig spelling (`lib: ["esnext"]`), never the programmatic form — `toProgrammaticCompilerOptions` (`twoslash-transformer.ts`) is the single conversion seam
- `src/twoslash-cache.ts` — persisted Twoslash result cache: env fingerprint, sync cache object, gzip codec
- `src/observability/` — EventBus, PluginEvent taxonomy, sinks, heartbeat, span helpers, metric reporting
  - `events.ts` — `PluginEvent` taggedEnum, `EventLevel`, `EventContext`, `levelOf`
  - `EventBus.ts` — synchronous fan-out bus, `makeRuntimeEmitter`
  - `sync-emitter.ts` — the **one** sync-island bridge: `installSyncEmitter`, `emitSync`, `syncBuildId`, `syncSlowCodeBlockMs`
  - `sinks/` — `console-sink.ts`, `trace-sink.ts`, `metrics-sink.ts`, `issues-sink.ts`, `render-sink.ts`, `types.ts`
  - `metric-report.ts` — `seriesFor` / `codeBlockReport` over `Metric.snapshot`
  - `heartbeat.ts` — production-only `BuildProgress` heartbeat fiber
  - `spans.ts` — `withPhase`, `withOp`, `PHASE_THRESHOLD_KEY`
- `src/schemas/` — Effect Schema definitions (config, performance, observability); `opengraph.ts` is deleted into `@tsdoctor/seo` and re-exported from `src/index.ts`. Import the concrete module, there is no barrel
- `src/services/` — Effect service tags (`Context.Service`), each owning its live layer as a static plus, on five of them, `makeTest`/`layerTest` doubles
- `src/layers/` — composition and shared layer pieces, no longer per-service `*Live` modules:
  - `AppLayer.ts` — `makeAppLayers(input)`, the tiered stack; returns both the `app` and `emitter` layers from one call
  - `config-resolution.ts` — `makeConfigService`, the effect behind `ConfigService.layer` (renamed from `ConfigServiceLive.ts`)
  - `api-results.ts` — merging one API's resolution result into the build-wide totals, plus its VFS event emission
  - `type-environment.ts` — registering the build's Twoslash environments (runs last, once the VFS is final)
  - `external-types.ts` — merging external package declarations into the VFS; degrades rather than fails
  - `build-metrics.ts` — `BuildMetrics`, `MetricStore`/`makeMetricStore`; the **only** import path for `BuildMetrics`
  - `observability.ts` — `buildEventBus`, `BuiltSinks`, `makeSummaryLoggerLayer`, `logBuildSummary` (renamed from `ObservabilityLive.ts`; it no longer re-exports `BuildMetrics`)
  - `xdg.ts` — `TSDOCTOR_NAMESPACE`, `PlatformLive`, `AppDirsLive` — one home for both cache-backed layers
- `src/internal-types.ts` — internal types
- `src/errors.ts` — `ConfigValidationError` and `TypeRegistryError` only; the four never-constructed classes are deleted and the surviving `TaggedError` bases are no longer exported
- `src/markdown/` — page generators (class, enum, function, interface, etc.) plus `prose-linker.ts`, the module-level holder over the `@tsdoctor/model` `CrossLinker` (`setProseLinker`/`linkProse`); no barrel here either
- `src/runtime/`, `src/runtime/components/` — React components for SSG-compatible rendering (SignatureBlock, etc.)

The former `@tsdoctor/model` shims (`loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`, the class-based `model-loader.ts`) are **deleted** — call sites use the model's namespace modules directly. `multi-entry-resolver.ts`, `route-collisions.ts` and `synthetic-bases.ts` moved into `@tsdoctor/model`; `content-hash.ts` and `migrations/` into `@tsdoctor/snapshot`; `og-resolver.ts` and `schemas/opengraph.ts` into `@tsdoctor/seo`. `services/PathDerivationService.ts` and the five `layers/*ServiceLive.ts` modules are **deleted** — every layer is a static on its service class. Page generators and `ApiExtractedPackage.extractPlainText` (a distinct `.d.ts` algorithm preserving `{@link}` and code fences) stay plugin-local.

Barrel modules are avoided here. A barrel counts as a consumer of everything it re-exports, hiding unused exports from any reachability check — deleting `schemas/index.ts` and `markdown/index.ts` immediately surfaced an orphan a first scan had scored live. Do not add one back.

## Interactive Frontend Debugging

For CSS and component debugging with Playwright MCP browser inspection:

```bash
pnpm run build            # plugin + modules first
NO_OPEN=1 pnpm dev:basic  # then browse http://localhost:4173/api/...
```

**Iteration loop:** edit CSS in `src/runtime/components/`, rebuild
(`pnpm --filter rspress-plugin-api-extractor run build:dev`), then **kill and
restart** the dev server — it does NOT hot-reload plugin dist changes — and
re-verify in Playwright.

**Key patterns:**

- Twoslash popup CSS is global (not CSS modules) in
  `src/runtime/components/shared/_twoslash.css` — targets Shiki-generated
  class names
- SignatureCode CSS is a CSS module in
  `src/runtime/components/SignatureCode/index.module.css` — CSS module
  selectors have higher specificity than global selectors; use
  `.twoslash .twoslash-popup-container .twoslash-popup-docs` (3 classes)
  to beat `.code-xxx code` (1 class + 1 element)
- Twoslash popups use `position: fixed` when visible (escapes scroll
  containers); JS in `SignatureCode/index.tsx` sets `--popup-top`,
  `--popup-left`, `--popup-max-width` CSS custom properties on hover
- Hidden popups collapse to `width: 0; height: 0; overflow: hidden` to
  avoid expanding the `<pre>` scroll area
- The `<pre>` element uses `overflow-x: auto` for horizontal code
  scrolling; per CSS spec this forces `overflow-y: auto` too
