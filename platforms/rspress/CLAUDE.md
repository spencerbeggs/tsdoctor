# platforms/rspress/CLAUDE.md

The publishable `rspress-plugin-api-extractor` package. It is an RSPress plugin,
but it lives in `platforms/rspress/` — the repo-root `plugin/` folder is the
unrelated api-docs Claude Code plugin, and `packages/` holds the core
`@tsdoctor/*` libraries this plugin consumes.

## Architecture

Built via `build()` from `@savvy-web/rspress-builder` (`platforms/rspress/savvy.build.ts`, a self-executing script). The config passes `runtime: true`, `bundledPackages`, and `meta.tsdoc.suppressWarnings` (the `ae-forgotten-export` rules). The runtime emission lives in `@savvy-web/rspress-builder`, not here. Published via `publishConfig.directory` (`dist/dev/pkg`, npm-only targets) — there is no `files` field.

| Artifact | Entry | Target | Output |
| -------- | ----- | ------ | ------ |
| Plugin | `src/index.ts` | Node.js | per-file `.js` under `dist/<mode>/pkg/` (`index.js`, `serve.js`, etc.) |
| Runtime | `src/runtime/` | bundleless per-file JS | `dist/<mode>/pkg/runtime/` (RSPress does the final per-site compile) |
| API model | — | `.api.json` | `dist/<mode>/meta/` |

The React runtime ships **bundleless** (per-file compiled JS), not as raw `.tsx`. The builder transpiles each component to its own `.js` under `runtime/`, mirroring `src/runtime/...`, with `react`/`@theme` external and `import.meta.env.SSG_MD` left unresolved for RSPress to fill in per build. It also emits a bundled `runtime/index.d.ts`. The published `./runtime` export is `{ types: "./runtime/index.d.ts", import: "./runtime/index.js" }`.

### Runtime ships bundleless

Per-file compiled JS (not a single bundled chunk) is required because `import.meta.env.SSG_MD` is resolved only when RSPress compiles the component per site build; the bundleless output keeps the import-meta reference unresolved (external `react`/`@theme`, no inlining) so RSPress's compile produces the correct dual-mode (HTML vs markdown) rendering. `ApiLlmsPackageActions` (`globalUIComponents`) and `ApiLlmsViewOptions` (`resolve.alias`) register against these transpiled component files and use RSPress runtime hooks.

The component paths in `plugin.ts` are a **zero-level** resolve to the published `.js` — `path.resolve(pluginDir, "runtime/components/<Name>/index.js")`, e.g. `runtime/components/ApiLlmsViewOptions/index.js` — not `src/runtime/.../index.tsx`. It is layout-invariant because the runtime sits next to `index.js` in both the dev (`dist/dev`) and published (flat root) layouts. The old `../../src/runtime/` path only worked in the linked dev layout; in the published flat layout it overshot and broke `llms: true` builds for external consumers. Do not reintroduce the `../../` prefix.

### Effect Service Layer

The plugin runs on **Effect v4** (`effect@4.0.0-rc.109`, pinned via `catalog:effect`). `plugin.ts` is a thin RSPress adapter (~530 lines) that wires an Effect `ManagedRuntime` with a composed `Layer` stack:

- `ConfigServiceLive` — resolves plugin options + RSPress config into build
  context (model loading, type resolution, highlighter creation)
- `SnapshotServiceLive` — from `@tsdoctor/snapshot`; SQLite via
  `@effected/store`'s `Store.layerSqlite` (migrations applied at layer
  construction, WAL checkpoint finalizer)
- `TypeRegistryServiceLive` — external package type loading; edge-composes the
  `@tsdoctor/registry` stack itself (the library ships no platform layer)
- `PathDerivationServiceLive` — route and output path computation
- `EventBus` layer (from `buildEventBus`) — synchronous fan-out event bus
  wiring console, metrics, issues, and optional JSONL trace sinks
- `NodeFileSystem.layer` (`@effect/platform-node`) — Node implementation of the
  core `effect` FileSystem service

Write v4 idioms: declare service tags as
`Context.Service<Self, Shape>()("id")`; use `Schema.Literals`/`Schema.Union`/
`Schema.Record` with array args, `Schema.withDecodingDefault(Effect.succeed(v))`
for defaults, `typeof X.Type`/`typeof X.Encoded` for extraction,
`Metric.histogram(name, { boundaries })` + `Metric.update`, `Effect.result`
(not `Effect.either`) and `Effect.catch` (not `Effect.catchAll`).

Doc generation runs as a `Stream` pipeline in `build-stages.ts`:
`Stream.fromIterable -> Stream.mapEffect(generateSinglePage) ->
Stream.mapEffect(writeSingleFile) -> Stream.runFold`

### Inert configuration

`api: null`, `apis: null` and `apis: []` are valid `PluginOptions` that make the plugin **inert**. `classifyApiConfig` (`config-utils.ts`) returns `"disabled"`, `plugin.ts` computes `isInert` once at factory time, and `config()` / `afterBuild()` then skip the doc-generation Effect program, the LLMs alias + scope/`globalUIComponents` injection, the build summary, `issues.json` and LLMs post-processing. Remark plugin registration and the runtime `source.include` entry still run so user-authored `with-api` blocks keep working. Omitting BOTH keys remains a configuration error, as does an explicit `undefined` — only a present, non-`undefined` empty value is an opt-in.

Keep creating the empty `.api-docs/snapshot/` directory on the inert path: no runtime is built there, but a stray sync emitter can still force one and SQLite opens its file eagerly. Details in `build-architecture.md`.

### Observability

The plugin emits structured `PluginEvent` values through a **synchronous
fan-out EventBus** (`src/observability/EventBus.ts`) rather than writing
directly to the console or incrementing metrics inline.

`buildEventBus(obs)` (`layers/ObservabilityLive.ts`) composes four sinks:

- **Console sink** — human-readable one-liners (or JSON at `logLevel: "debug"`),
  filtered by the configured level
- **Metrics sink** — translates events to `BuildMetrics` counters/histograms
  via `Effect.runSync`; exact counts are available when `logBuildSummary` runs
  in `afterBuild`
- **Issues sink** — accumulates diagnostic events; written to
  `.api-docs/build/issues.json` on production builds
- **Trace sink** (opt-in) — full-fidelity JSONL under `.api-docs/build/`;
  `minLevel: "trace"`, independent of console level

Twoslash and Prettier error callbacks fire outside Effect fibers.
`makeRuntimeEmitter(runtime)` creates a sync bridge (`runtime.runSync(emit(event))`);
`plugin.ts` injects it into both modules via `setEventEmitter(emitSync)`.

A best-effort stream tee (`src/observability/stream.ts`) is exported but not
wired into the live plugin — available for custom integrations.

OpenTelemetry spans (`Effect.withSpan`) exist in the span substrate
(`src/observability/spans.ts`) but no OTLP exporter is wired. This is a dormant
seam for future integration.

See `performance-observability.md` and `error-observability.md` in the design
docs for the full architecture.

## Key Dependencies

- `effect` (v4, `catalog:effect`) — core runtime plus the merged-in `FileSystem`
  and `effect/unstable/sql` modules. `@effect/platform` and `@effect/sql` no
  longer exist as separate packages; do not add them back.
- `@effect/platform-node` — Node platform implementation (`NodeFileSystem`).
  `@effect/sql-sqlite-node` is **gone** — SQLite moved behind
  `@tsdoctor/snapshot`; `gray-matter` is gone too (see `src/frontmatter.ts`)
- `ioredis` + the `@effected/*` closure (`semver`/`store`/`tsconfig-json`/
  `xdg`/`github`/`glob`/`npm`/`package-json`/`walker`/`yaml`/`jsonc`/
  `markdown`) + `@typescript/vfs` — peer-closure deps (some imported
  directly, e.g. by `layers/TypeRegistryServiceLive.ts`, `sync-node-fs.ts`,
  `frontmatter.ts`).
  Do NOT prune as "unused" — see the peer dependency closure section in
  `build-architecture.md`. `@effected/*` deps are declared as
  `catalog:effected` (supplied by `@effected/pnpm-plugin-effect`; see
  "@effected Distribution and Dogfooding" in the root CLAUDE.md) — never
  hand-pin an `@effected` version range.
- `@tsdoctor/registry` (`workspace:*`) — npm package type definition loading;
  tag ids read `"@tsdoctor/registry/..."` and the XDG cache namespace is
  `"tsdoctor"` since phase 2
- `@tsdoctor/model` (`workspace:*`) — consumed **directly** as Effect v4
  namespace modules (`Model`, `Tsdoc`, `ApiItems`, `EntryPoints`, `Routes`,
  `SyntheticBases`, `Signature`, `CrossLinker`); the four phase-1 shims are
  deleted (see "Core Package Consumption" in `build-architecture.md`)
- `@tsdoctor/bundle` (`workspace:*`) — bundle discovery for the
  `fromDir`/`fromParentDir` config helpers, plus npm/GitHub bundle fetchers
- `@tsdoctor/snapshot` (`workspace:*`) — `SnapshotService`/`SnapshotServiceLive`
  and the `hashContent`/`hashFrontmatter` helpers
- `@microsoft/api-extractor-model` — `.api.json` model parsing (direct dep;
  model loading flows through `@tsdoctor/model`'s `Model.load`)
- `@shikijs/twoslash` — syntax highlighting with type information
- `open` — best-effort browser launch for the `serve()` dev/preview runner

## Biome Override

`platforms/rspress/biome.jsonc` disables `useImportExtensions` for CSS and runtime
component files. This is required because the runtime imports `.css` files
which the global biome rule would rewrite to `.js`.

## Source Structure

- `src/index.ts` — main plugin entry (re-exports plugin.ts, serve.ts)
- `src/plugin.ts` — RSPress adapter (~530 lines), runtime management, `isInert` lifecycle gating
- `src/serve.ts` — public `serve(options?)` dev/preview RSPress server runner (exports `ServeOptions`/`ServeMode`/`ResolvedServeConfig`/`isServerReady`/`resolveServeConfig`); used by the sites' `lib/scripts/dev.mts` and `preview.mts`
- `src/build-program.ts` — doc generation orchestration (5-stage pipeline)
- `src/build-stages.ts` — Stream pipeline, page gen, file writes (~1380 lines)
- `src/config-utils.ts` — pure config helpers shared by `ConfigServiceLive` and `plugin.ts`: `classifyApiConfig` (inert detection), `mergeLlmsPluginConfig`, dependency extraction
- `src/config-helpers.ts` — `fromDir`/`fromParentDir` config builders, delegating discovery to `@tsdoctor/bundle`
- `src/sync-node-fs.ts` — sync `FileSystem` bridge so bundle discovery runs under the sync helper API
- `src/model-loader.ts` — plain functions over `@tsdoctor/model`'s `Model.load` (typed `ModelLoadError`)
- `src/frontmatter.ts` — gray-matter-parity frontmatter split/join over `@effected/yaml` (the `gray-matter` dep is gone); the parse side deliberately keeps the hand-rolled gray-matter-parity split (`@effected/markdown`'s `FrontmatterSource.split` was evaluated and rejected — its strict fence grammar conflicts with the pinned gray-matter quirks), while emission uses `FrontmatterSource.join` + `Yaml.stringify({ quoteCompat: "yaml-1.1", quoteStyle: "double" })` to quote only the scalars a YAML 1.1 resolver would coerce
- `src/observability/` — EventBus, PluginEvent taxonomy, sinks, heartbeat, span helpers, stream tee
  - `events.ts` — `PluginEvent` taggedEnum, `EventLevel`, `EventContext`, `levelOf`
  - `EventBus.ts` — synchronous fan-out bus, `makeRuntimeEmitter`, `EventBusNoop`
  - `sinks/` — `console-sink.ts`, `trace-sink.ts`, `metrics-sink.ts`, `issues-sink.ts`, `types.ts`
  - `heartbeat.ts` — production-only `BuildProgress` heartbeat fiber
  - `spans.ts` — `withPhase`, `withOp`, `PHASE_THRESHOLD_KEY`
  - `stream.ts` — best-effort sliding-queue stream tee (exported, not wired to live plugin)
- `src/schemas/` — Effect Schema definitions (config, opengraph, performance, observability)
- `src/services/` — Effect service interfaces (`Context.Service`)
- `src/layers/` — Effect Layer implementations
- `src/internal-types.ts` — internal type definitions
- `src/errors.ts` — tagged error types
- `src/markdown/` — page generators (class, enum, function, interface, etc.) plus `prose-linker.ts`, the module-level holder over the `@tsdoctor/model` `CrossLinker` (`setProseLinker`/`linkProse`)
- `src/runtime/` — React components for SSG-compatible rendering
- `src/runtime/components/` — UI components (SignatureBlock, etc.)

The former shims over `@tsdoctor/model` (`loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`, the class-based `model-loader.ts`) are **deleted** — call sites consume the model's namespace modules directly. `multi-entry-resolver.ts`, `route-collisions.ts` and `synthetic-bases.ts` migrated into `@tsdoctor/model` (`EntryPoints`/`Routes`/`SyntheticBases`); `content-hash.ts` and `migrations/` moved to `@tsdoctor/snapshot`. Page generators and `ApiExtractedPackage.extractPlainText` (a distinct `.d.ts` algorithm preserving `{@link}` and code fences) stay plugin-local.

## Testing

All tests live in `__test__/`, mirroring the `src/` subtree — there are no colocated `*.test.ts` files under `src/`.

```bash
pnpm vitest run platforms/rspress/            # Run all plugin tests
pnpm vitest run platforms/rspress/__test__/   # Run only the canonical test directory
```

`__test__/**/*.ts` is in this workspace's `tsconfig.json` `include`, so tests are typechecked by `pnpm typecheck`. Fixtures in `__test__/__fixtures__/`. Mock layers in `__test__/utils/layers.ts`. Fixture-regeneration scripts in `__test__/scripts/` (e.g. `regenerate-declarations.ts`, run via `pnpm exec tsx`).

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

## Design Docs

**Build & infrastructure** — load when modifying services, layers, or
plugin lifecycle:

- @../../.claude/design/rspress-plugin-api-extractor/build-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/snapshot-tracking-system.md

**Page generation & markdown** — load when modifying Stream pipeline,
page generators, or cross-linking:

- @../../.claude/design/rspress-plugin-api-extractor/page-generation-system.md
- @../../.claude/design/rspress-plugin-api-extractor/cross-linking-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/import-generation-system.md
- @../../.claude/design/rspress-plugin-api-extractor/source-mapping-system.md

**Runtime components & SSG** — load when modifying React components or
SSG-MD rendering:

- @../../.claude/design/rspress-plugin-api-extractor/component-development.md
- @../../.claude/design/rspress-plugin-api-extractor/ssg-compatible-components.md

**Type loading, VFS & multi-entry points** — load when modifying Twoslash,
external package types, VFS generation, or multi-entry point resolution:

- @../../.claude/design/rspress-plugin-api-extractor/type-loading-vfs.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-point-support.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-resolution.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-vfs.md

**LLMs integration** — load when modifying llms.txt post-processing,
per-package file generation, or scope-aware UI components:

- @../../.claude/design/rspress-plugin-api-extractor/llms-integration.md

**Observability** — load when modifying metrics, logging, error tracking, the
progress heartbeat, or the `issues.json` artifact:

- @../../.claude/design/rspress-plugin-api-extractor/performance-observability.md
- @../../.claude/design/rspress-plugin-api-extractor/error-observability.md
- @../../.claude/design/rspress-plugin-api-extractor/build-progress-and-issues.md
