# platforms/rspress/CLAUDE.source-map.md

File-by-file map of `src/`, plus the interactive frontend debugging loop.
Loaded from `platforms/rspress/CLAUDE.md`.

## Source Structure

- `src/index.ts` — main plugin entry (re-exports plugin.ts, serve.ts)
- `src/plugin.ts` — RSPress adapter: `makeAppLayers` → both `ManagedRuntime`s, installs the sync-emitter and Twoslash-access holders, `isInert` lifecycle gating
- `src/BuildEnv.ts` — the per-build `Context.Reference`s: `BuildId`, `Thresholds`, `PageConcurrency`, `SuppressExampleErrors`
- `src/twoslash-access.ts` — module-level holder bridging RSPress's render pass to `TwoslashEnvironments`; installed from inside a fiber, never bound to a runtime
- `src/path-derivation.ts` — `deriveOutputPaths` only, the `docs/{locale}/{version}/…` layout the adapter owns; the scope helpers live in `@tsdoctor/pages` and are imported from there (no re-export here; the former `PathDerivationService` is deleted)
- There is no `siteUrl` option: the canonical URL is RSPress's `siteOrigin` + `base` via `deriveSiteUrl`, falling back to root-relative with the tags still emitted (`sites/basic` exercises the full path); `services/OgService.ts` only probes a configured image
- `src/serve.ts` — public `serve(options?)` dev/preview runner (+ `ServeOptions`/`ServeMode`/`ResolvedServeConfig`/`isServerReady`/`resolveServeConfig`); used by the sites' `lib/scripts/dev.mts`/`preview.mts`
- `src/build-program.ts` — doc generation orchestration (5-stage pipeline); builds one `CrossLinker` per API and carries it in the pipeline context
- `src/build-stages.ts` — Stream pipeline, page gen, file writes. `prepareWorkItems` is a reporting wrapper over `@tsdoctor/pages`' (emits `ItemSkipped` / `RouteCollisionDetected`, throws `Routes.RouteCollisionError`); `WorkItem` is the pages type over `CategoryConfig`. `generateSinglePage` is `buildPage` → `emitMdxBody` → `generateFrontmatter`; `writeMetadata` is `buildNav` → `src/emit/meta.ts`. **`generateSinglePage` builds the head tags** (OG resolve → `deriveScriptBody` → `headTags`) and assembles the final frontmatter BEFORE hashing; `writeSingleFile` just writes `result.content`. Never move head-tag construction back into the write stage — that made head tags invisible to change detection
- `src/config-utils.ts` — pure config helpers: `classifyApiConfig` (inert detection), `mergeLlmsPluginConfig`, dep extraction
- `src/config-helpers.ts` — `fromDir`/`fromParentDir` config builders, delegating discovery to `@tsdoctor/bundle`
- `src/sync-node-fs.ts` — sync `FileSystem` bridge so bundle discovery runs under the sync helper API
- `src/model-loader.ts` — plain functions over `@tsdoctor/model`'s `Model.load` (typed `ModelLoadError`)
- `src/twoslash-transformer.ts` — the Shiki/Twoslash transformer per environment; calls `toProgrammaticCompilerOptions` (`@tsdoctor/vfs`), the **single** tsconfig→programmatic seam. Fingerprint environments on the ENCODED value, or the two spellings build two identical environments
- `src/observability/` — EventBus, PluginEvent taxonomy, sinks, heartbeat, span helpers, metric reporting
  - `events.ts` — `PluginEvent` taggedEnum, `EventLevel`, `EventContext`, `levelOf`. Every variant has an emit site and a sink case (the sweep removed those that did not) — read the file, not an older list
  - `EventBus.ts` — synchronous fan-out bus, `makeRuntimeEmitter`
  - `sync-emitter.ts` — the **one** sync-island bridge: `installSyncEmitter`, `emitSync`, `syncBuildId`, `syncSlowCodeBlockMs`
  - `sinks/` — `console-sink.ts`, `trace-sink.ts`, `metrics-sink.ts`, `issues-sink.ts`, `render-sink.ts`, `types.ts`
  - `metric-report.ts` — `seriesFor` / `codeBlockReport` over `Metric.snapshot`
  - `heartbeat.ts` — production-only `BuildProgress` heartbeat fiber
  - `spans.ts` — `withPhase` and `PHASE_THRESHOLD_KEY` (`withOp` is deleted — no production caller)
- `src/schemas/` — Effect Schema definitions (config, performance, observability); `opengraph.ts` is deleted into `@tsdoctor/seo` and re-exported from `src/index.ts`. Import the concrete module, there is no barrel
- `src/services/` — Effect service tags (`Context.Service`), each owning its live layer as a static plus, on five of them, `makeTest`/`layerTest` doubles. `ResolvedApiConfig` has no `docsDir` (written, never read — deleted); `TwoslashCacheService.ts` persists `@tsdoctor/vfs`'s cache into the XDG `twoslash.sqlite` the VitePress adapter also reads
- `src/layers/` — composition and shared layer pieces, no longer per-service `*Live` modules:
  - `AppLayer.ts` — `makeAppLayers(input)`, the tiered stack; returns both the `app` and `emitter` layers from one call
  - `config-resolution.ts` — `makeConfigService`, the effect behind `ConfigService.layer` (renamed from `ConfigServiceLive.ts`)
  - `api-results.ts` — merging one API's resolution result into the build-wide totals, plus its VFS event emission
  - `type-environment.ts` — registering the build's Twoslash environments (runs last, once the VFS is final)
  - `external-types.ts` — merging external package declarations into the VFS; degrades rather than fails
  - `build-metrics.ts` — `BuildMetrics`, `MetricStore`/`makeMetricStore`; the **only** import path for `BuildMetrics`
  - `observability.ts` — `buildEventBus`, `BuiltSinks`, `makeSummaryLoggerLayer`, `logBuildSummary` (renamed from `ObservabilityLive.ts`; it no longer re-exports `BuildMetrics`)
  - `xdg.ts` — `TSDOCTOR_NAMESPACE`, `PlatformLive`, `AppDirsLive` — one home for both cache-backed layers
- `src/internal-types.ts` — adapter-local types (`LoadedModel`, `PackageJson`) plus re-exports of the `@tsdoctor/vfs` compiler-options types
- `src/errors.ts` — `ConfigValidationError` and `TypeRegistryError` only; the `TaggedError` bases are not exported
- `src/emit/` — the IR emitters: `mdx.ts` (`emitMdxBody`, `escapeMdxGenerics`; no byte-parity shim — the kit serializes `_`/`&` minimally since 0.8.0) and `meta.ts` (`renderRootMeta`, `renderCategoryMeta`, `emitIndexPage`)
- `src/markdown/` — `helpers.ts` (`generateFrontmatter` only) and `shiki-utils.ts`; no barrel here either
- `src/runtime/`, `src/runtime/components/` — React components for SSG-compatible rendering (SignatureBlock, etc.)

Moved out, do not recreate here: the model shims (`loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`) and `multi-entry-resolver.ts`, `route-collisions.ts`, `synthetic-bases.ts`, `api-extracted-package.ts`, `type-reference-extractor.ts`, `frontmatter.ts` → `@tsdoctor/model`; `tsconfig-parser.ts`, `typescript-config.ts`, `twoslash-cache.ts` → `@tsdoctor/vfs`; `prepareWorkItems` and the scope helpers → `@tsdoctor/pages`; `content-hash.ts`, `migrations/` → `@tsdoctor/snapshot`; `og-resolver.ts`, `schemas/opengraph.ts` → `@tsdoctor/seo`. Deleted outright: `services/PathDerivationService.ts`, the `layers/*ServiceLive.ts` modules (every layer is a static on its service), `markdown/page-generators/`, `markdown/prose-linker.ts`, `twoslash-patterns.ts`, `code-post-processor.ts` (pages come from `@tsdoctor/pages`, rendered by `src/emit/`). `category-resolver.ts` stays plugin-local: sidebar presentation and multiVersion product policy, not model vocabulary.

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
