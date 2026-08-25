# platforms/rspress/CLAUDE.source-map.md

File-by-file map of `src/`, plus the interactive frontend debugging loop.
Loaded from `platforms/rspress/CLAUDE.md`.

## Source Structure

- `src/index.ts` — main plugin entry (re-exports plugin.ts, serve.ts)
- `src/plugin.ts` — RSPress adapter (~570 lines): calls `makeAppLayers` and builds both `ManagedRuntime`s over the returned stacks, installs the sync emitter and Twoslash access holders, `isInert` lifecycle gating
- `src/BuildEnv.ts` — the per-build `Context.Reference`s: `BuildId`, `Thresholds`, `PageConcurrency`, `SuppressExampleErrors`
- `src/twoslash-access.ts` — module-level holder bridging RSPress's render pass to `TwoslashEnvironments`; installed from inside a fiber, never bound to a runtime
- `src/path-derivation.ts` — pure route/output path functions, imported directly (the former `PathDerivationService` is deleted)
- `src/og-resolver.ts` — pure, filesystem-free OG URL/MIME helpers behind `OgService`, plus `deriveSiteUrl(siteOrigin, base)`. The plugin's `siteUrl` option is **removed**: the canonical URL comes from RSPress's own `siteOrigin` + `base` (both on `RspressConfigSubset`). With no `siteOrigin` the URLs fall back to root-relative and the tags are still emitted — `sites/basic` sets `siteOrigin` + `ogImage`, so this path is exercised end to end
- `src/serve.ts` — public `serve(options?)` dev/preview RSPress server runner (exports `ServeOptions`/`ServeMode`/`ResolvedServeConfig`/`isServerReady`/`resolveServeConfig`); used by the sites' `lib/scripts/dev.mts` and `preview.mts`
- `src/build-program.ts` — doc generation orchestration (5-stage pipeline)
- `src/build-stages.ts` — Stream pipeline, page gen, file writes (~1415 lines)
- `src/config-utils.ts` — pure config helpers shared by `layers/config-resolution.ts` and `plugin.ts`: `classifyApiConfig` (inert detection), `mergeLlmsPluginConfig`, dependency extraction
- `src/config-helpers.ts` — `fromDir`/`fromParentDir` config builders, delegating discovery to `@tsdoctor/bundle`
- `src/sync-node-fs.ts` — sync `FileSystem` bridge so bundle discovery runs under the sync helper API
- `src/model-loader.ts` — plain functions over `@tsdoctor/model`'s `Model.load` (typed `ModelLoadError`)
- `src/frontmatter.ts` — gray-matter-parity frontmatter split/join over `@effected/yaml` (the `gray-matter` dep is gone); the parse side deliberately keeps the hand-rolled gray-matter-parity split (`@effected/markdown`'s `FrontmatterSource.split` was evaluated and rejected — its strict fence grammar conflicts with the pinned gray-matter quirks), while emission uses `FrontmatterSource.join` + `Yaml.stringify({ quoteCompat: "yaml-1.1", quoteStyle: "double" })` to quote only the scalars a YAML 1.1 resolver would coerce
- `src/tsconfig-parser.ts` — reads a `tsconfig.json` through `@effected/tsconfig-json`'s `TsconfigLoaderSync`; does **not** import the TypeScript compiler. It reports the tsconfig spelling (`target: "es2025"`, `lib: ["esnext"]`), never the programmatic form — `toProgrammaticCompilerOptions` (`twoslash-transformer.ts`) stays the single conversion seam
- `src/twoslash-cache.ts` — persisted Twoslash result cache: env fingerprint, sync cache object, gzip codec
- `src/observability/` — EventBus, PluginEvent taxonomy, sinks, heartbeat, span helpers, metric reporting
  - `events.ts` — `PluginEvent` taggedEnum, `EventLevel`, `EventContext`, `levelOf`
  - `EventBus.ts` — synchronous fan-out bus, `makeRuntimeEmitter`
  - `sync-emitter.ts` — the **one** sync-island bridge: `installSyncEmitter`, `emitSync`, `syncBuildId`, `syncSlowCodeBlockMs`
  - `sinks/` — `console-sink.ts`, `trace-sink.ts`, `metrics-sink.ts`, `issues-sink.ts`, `render-sink.ts`, `types.ts`
  - `metric-report.ts` — `seriesFor` / `codeBlockReport` over `Metric.snapshot`
  - `heartbeat.ts` — production-only `BuildProgress` heartbeat fiber
  - `spans.ts` — `withPhase`, `withOp`, `PHASE_THRESHOLD_KEY`
- `src/schemas/` — Effect Schema definitions (config, opengraph, performance, observability); import the concrete module, there is no barrel
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
- `src/internal-types.ts` — internal type definitions
- `src/errors.ts` — tagged error types: `ConfigValidationError` and `TypeRegistryError` only. The four never-constructed classes (`ApiModelLoadError`, `PageGenerationError`, `TwoslashProcessingError`, `PrettierFormatError`) are deleted and the two surviving `TaggedError` bases are no longer exported
- `src/markdown/` — page generators (class, enum, function, interface, etc.) plus `prose-linker.ts`, the module-level holder over the `@tsdoctor/model` `CrossLinker` (`setProseLinker`/`linkProse`); no barrel here either
- `src/runtime/` — React components for SSG-compatible rendering
- `src/runtime/components/` — UI components (SignatureBlock, etc.)

The former shims over `@tsdoctor/model` (`loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`, the class-based `model-loader.ts`) are **deleted** — call sites consume the model's namespace modules directly. `multi-entry-resolver.ts`, `route-collisions.ts` and `synthetic-bases.ts` migrated into `@tsdoctor/model` (`EntryPoints`/`Routes`/`SyntheticBases`); `content-hash.ts` and `migrations/` moved to `@tsdoctor/snapshot`. `services/PathDerivationService.ts` and its live layer are **deleted**, as are the five `layers/*ServiceLive.ts` modules (and `@tsdoctor/snapshot`'s `SnapshotServiceLive.ts`) — every service's layer is now a static on the service class. Page generators and `ApiExtractedPackage.extractPlainText` (a distinct `.d.ts` algorithm preserving `{@link}` and code fences) stay plugin-local.

Barrel modules are avoided in this package. A barrel counts as a consumer of everything it re-exports, so it hides unused exports from any reachability check — deleting `schemas/index.ts` and `markdown/index.ts` immediately surfaced an orphan a first scan had scored as live. Do not add one back.

## Interactive Frontend Debugging

For CSS and component debugging with Playwright MCP browser inspection:

```bash
# 1. Build plugin + modules first
pnpm run build

# 2. Start the basic site dev server (suppresses browser auto-open)
NO_OPEN=1 pnpm dev:basic

# 3. Use Playwright MCP to navigate to http://localhost:4173/api/...
```

**Iteration loop for CSS/component changes:**

1. Edit CSS in `src/runtime/components/`
2. Rebuild plugin: `pnpm --filter rspress-plugin-api-extractor run build:dev`
3. Kill and restart the dev server (the RSPress dev server does NOT
   hot-reload when the plugin's dist files change — it must be restarted)
4. Navigate in Playwright to verify

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
