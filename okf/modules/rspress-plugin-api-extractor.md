---
type: Module
kind: package
title: rspress-plugin-api-extractor
description: The RSPress adapter over the @tsdoctor/* core — hooks, Effect service layer, page pipeline, emitters, cross-linking, observability, and LLMs wiring.
resource: ../../platforms/rspress
layer: L3
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T20:28:47Z
  body_sha256: 82f3a1dbe6dc3332b02bb226f1bb5d28c668bd995ef9e2b8ac4dc5ac3c5f7736
tags:
  - architecture
  - observability
  - performance
  - dx
status: stable
---

# rspress-plugin-api-extractor

## Boundary and purpose

`rspress-plugin-api-extractor` (`platforms/rspress/`) is the RSPress adapter
over the `@tsdoctor/*` core packages — the first adapter, and the one that
keeps its original npm name for equity even though the role underneath
changed from "the plugin" to "a thin adapter". It has two emitted halves: a
Node.js plugin that generates pages during RSPress's `config()` hook, and a
browser-side React runtime that renders them. An Effect service layer
orchestrates generation; `src/plugin.ts` wires RSPress lifecycle hooks to
that layer and delegates every step of doc generation to
`src/build-program.ts` and `src/build-stages.ts`.

The repo-root `plugin/` directory is the unrelated api-docs Claude Code
plugin — not a pnpm workspace, not this package.

What stays adapter-side, framework-coupled, and never moves to a core
package: the React runtime components (SSG-MD dual-mode rendering, Twoslash
tooltips); the remark and HAST pipeline (`remark-with-api.ts`,
`remark-api-codeblocks.ts`, `ShikiCrossLinker`); and RSPress lifecycle
wiring (hooks, the llms.txt post-processing I/O, `category-resolver.ts`'s
multiVersion product policy, `path-derivation.ts`'s `docs/{locale}/{version}/…`
layout). Everything else — model loading, route and cross-link computation,
type registry and VFS construction, the snapshot system, page content — is
consumed from a core `@tsdoctor/*` package, not reimplemented here.

`src/index.ts` is the package's only barrel. There are no barrel modules
inside `src/` otherwise: every internal import names a concrete module, so a
reachability check sees real consumers rather than a re-export that counts
as one for everything it re-exports.

## Dependencies

Core package consumption (every edge `workspace:*`):

| Package | What the adapter consumes |
| --- | --- |
| `@tsdoctor/model` | `Model.load`, the `Tsdoc` / `ApiItems` / `EntryPoints` / `Routes` / `SyntheticBases` / `Signature` namespaces, the `CrossLinker`, `ApiExtractedPackage`, `TypeReferenceExtractor`, the `Frontmatter` contract |
| `@tsdoctor/vfs` | The `Vfs` currency type, `VirtualPackage`, `TsEnvironment`, the compiler-options seam, the Twoslash result cache |
| `@tsdoctor/registry` | External type loading into a `Vfs`, behind `src/services/TypeRegistryService.ts` |
| `@tsdoctor/bundle` | `discoverBundle` for the config helpers, plus npm-tarball and GitHub-release fetchers |
| `@tsdoctor/manifest` | The `tsdoctor.json` schema `loadBundle` / `publishBundleAssets` decode and encode through |
| `@tsdoctor/snapshot` | `SnapshotService` and the content hashers |
| `@tsdoctor/seo` | `deriveSiteUrl`, `attributionFacts`, `packageContext`, `deriveScriptBody`, `headTags` — every `<head>` decision |
| `@tsdoctor/pages` | `prepareWorkItems`, `buildPage` / `buildIndexPage`, `buildNav`, example preparation, the scope helpers, the llms.txt text transforms |

`Routes.sanitizeId` is consumed as the single anchor algorithm; the adapter
never spells a second one (`src/emit/mdx.ts` carries no `sanitizeId`
equivalent).

Non-`@tsdoctor` dependencies of note: `@effect/platform-node` (`NodeFileSystem`),
the full `@effected/*` closure (`github`, `glob`, `jsonc`, `markdown`, `npm`,
`package-json`, `schema-org`, `semver`, `spdx`, `store`, `tsconfig-json`,
`walker`, `xdg`, `yaml` — all `catalog:effected`, covering the core
packages' public-surface peers and internal dependencies alike; see
[core-peers-follow-public-surface](../decisions/core-peers-follow-public-surface.md)),
`@typescript/vfs`, `@microsoft/api-extractor-model`,
`@shikijs/twoslash`, `shiki`, `mdast-util-to-hast` (runtime), `open`. These
are declared in `dependencies`, not `peerDependencies` — see
[rspress-dependency-closure](../conventions/rspress-dependency-closure.md).
Peers are `@rspress/core`, `react`, `react-dom` only.

## Public surface

Three export conditions (`platforms/rspress/package.json`):

- `.` → `src/index.ts` — the main plugin entry, re-exporting `plugin.ts` and
  `serve.ts`
- `./runtime` → `src/runtime/index.tsx` — React components for SSG-compatible
  rendering, emitted bundleless per-file
- `./tsconfig/rspress.json` → a published RSPress tsconfig sites extend from

Key modules under `src/`:

- `src/plugin.ts` — the RSPress adapter: `makeAppLayers` → both
  `ManagedRuntime`s, installs the sync-emitter and Twoslash-access holders,
  `isInert` lifecycle gating
- `src/BuildEnv.ts` — the per-build `Context.Reference`s
- `src/build-program.ts` — doc generation orchestration (the five-stage
  pipeline); builds one `CrossLinker` per API
- `src/build-stages.ts` — the Stream pipeline, page generation, file writes
- `src/config-helpers.ts` / `src/config-utils.ts` — `fromDir` /
  `fromParentDir` config builders and pure config classification
- `src/emit/mdx.ts`, `src/emit/meta.ts` — the MDX body and `_meta.json` /
  sidebar emitters
- `src/markdown/helpers.ts` — `generateFrontmatter`, the one frontmatter
  assembly helper left in that module
- `src/services/`, `src/layers/` — Effect services and layer composition
- `src/observability/` — the event bus, sinks, heartbeat, span helpers
- `src/llms-program.ts` — llms.txt post-processing orchestration
- `src/serve.ts` — the dev/preview runner

See the full interface contract at
[rspress-plugin-options](../interfaces/rspress-plugin-options.md) and
[rspress-package-exports](../interfaces/rspress-package-exports.md).

## Mechanisms

### Lifecycle

```text
1. ApiExtractorPlugin(rawOptions)  -- factory
   - Decode options via Effect Schema
   - classifyApiConfig -> isInert
   - makeAppLayers(...) once; ManagedRuntime.make for both stacks
   - installSyncEmitter(emitterRuntime)

2. config(config, utils, isProd)  -- BEFORE route scanning
   - Pre-create output directories
   - Run the Effect program (skipped when inert):
     VfsRegistry.clear(), clearTypeRoutes(), clearTwoslashAccess()
     ConfigService.resolve() -> ReadonlyArray<ResolvedApiConfig>
     installTwoslashAccess(yield* TwoslashEnvironments)
     generateApiDocs() per API config, concurrently
     heartbeat forked when isProd
   - Register remark plugins (remarkWithApi, remarkApiCodeblocks)
   - Add the runtime to builderConfig.source.include
   - LLMs resolve.alias, scope and globalUIComponents injection (skipped when inert)
   - On failure: best-effort issues.json write (isProd only), then rethrow

3. beforeBuild()  -- intentionally empty

4. afterBuild(config, isProd)
   - Build summary and render-phase report (first build only)
   - issues.json and render-phase.json (isProd, first build only)
   - LLMs post-processing
   - Dispose the runtime in production
```

Doc generation runs in `config()`, not `beforeBuild`, because RSPress scans
routes before `beforeBuild` fires — pages written there would not be routed
on a cold start
(see [generate-docs-in-config-hook](../decisions/generate-docs-in-config-hook.md)).
`beforeBuild` stays intentionally empty to document that decision at the
point a future reader would otherwise "fix" it. `afterBuild` consumes the
real `isProd` flag RSPress passes, not a `NODE_ENV` heuristic, to gate the
heartbeat fork and every artifact write.

The main `ManagedRuntime` is created once at factory time and shared across
hooks. Production builds dispose it in `afterBuild`, running the scope
finalizers (the SQLite WAL checkpoint, the highlighter release); in dev mode
the runtime stays alive across HMR rebuilds — disposing it would destroy the
snapshot DB connection and break the next build.

All on-disk artifacts live under `<cwd>/.api-docs/`: `snapshot/api-docs.db`
(the incremental-build database, the one artifact a production site may
commit for build idempotency — `plugin.ts` creates the directory
unconditionally at factory time, since SQLite does not create intermediate
directories and a stray sync emitter can force the runtime to build even on
the inert path) and `build/` (per-build observability output regenerated
every run: `issues.json`, `render-phase.json`, the opt-in
`trace-<buildId>.jsonl`).

### Configuration resolution

`ConfigService.resolve` turns the decoded plugin options plus a subset of
RSPress's own config (`RspressConfigSubset`) into
`ReadonlyArray<ResolvedApiConfig>`: loaded model, output paths, categories,
source, theme, the derived site URL, `ogImage`, docs roots, two views of
`package.json` (the loose `packageJson` and the typed `manifest?:
PackageManifest`), and a resolved `@tsdoctor/bundle` — `bundle:
ResolvedBundle` (always present, falling back to an inferred bundle carrying
only the package name), `siteName?: string`, and `bundleOgImage?:
PublishedOpenGraphImage`. `ConfigService.layer` is a zero-argument static,
not a factory — layers memoize by reference, so a factory called twice would
capture two distinct `TypeRegistry`s. The implementation is
`makeConfigService` in `src/layers/config-resolution.ts`, split across
`src/layers/api-results.ts` (the pure/effectful per-API accumulator seam),
`src/layers/type-environment.ts` (per-scope environment registration), and
`src/layers/external-types.ts` (the one phase that degrades rather than
fails).

**Inert configuration.** `api: null`, `apis: null` and `apis: []` are valid
options that make the plugin inert — options are validated and the RSPress
wiring installed, but nothing is generated. `classifyApiConfig` collapses the
option shapes into `configured` / `disabled` / `missing`: a populated option
wins over an empty sibling, an explicit `undefined` is `missing` (not
`disabled`, since `undefined` is what a spread or conditional yields when it
produces nothing — indistinguishable from a forgotten key). Omitting both
keys remains a configuration error. When inert, no model is loaded, no
`ManagedRuntime` is built, and no snapshot database is opened.

**Resolving the bundle.** `resolveApiBundle` calls `loadBundle` on the
model's directory per API — a loader-function or URL-based model has no
directory to discover a `tsdoctor.json` sidecar beside, so it falls back to
an inferred bundle carrying only the package name — resolves it with an
empty platform tier (this adapter has no platform-override tier of its own),
and, when a `siteUrl` and an `openGraph` block both exist, publishes the
images through `publishBundleAssets` into
`<rspressRoot>/public/tsdoctor/<unscopedName>/` (a `VersionConfig` entry
passes its version as the `subdir`, so per-version images do not collide).
`loadBundle` pins the model it was already handed
(`overrides: { modelPath, name: packageName }`) rather than letting
discovery re-pick an `*.api.json` candidate in the directory. Only a
malformed `tsdoctor.json` fails typed as `ConfigValidationError` with
`field: "bundle"`; a discovery or layer-read failure degrades to a
`ConfigValidationWarning` with `field: "bundle"` plus the inferred bundle. An
asset-publish failure separately degrades to a `ConfigValidationWarning` with
`field: "openGraph"`.

**The canonical site URL is derived, not configured.** There is no `siteUrl`
option; `resolve` reads RSPress's own `siteOrigin` and `base` and joins them
through `@tsdoctor/seo`'s `deriveSiteUrl` in the documented
`siteOrigin + base + routePath` order. With no `siteOrigin` the prefix is
`""` and URLs are root-relative, so head tags are still emitted and
inspectable under `rspress dev` — the head-tag block is therefore gated on
`packageName`, not on a non-empty site URL. See
[site-url-is-derived-not-configured](../decisions/site-url-is-derived-not-configured.md).

**Error channel.** `ConfigValidationError` only; the requirement channel is
`TwoslashCacheService | TwoslashEnvironments | FileSystem.FileSystem |
Path.Path`. Model-load failures emit `ModelLoadFailed` and are
`Effect.orDie`d; external type loading degrades rather than fails. A bad
`package.json`, an `externalPackages` conflict, and a malformed tsconfig each
fail as a typed `ConfigValidationError` carrying `field`, `reason` and the
original `cause`, so they reach `issues.json` rather than escaping as
defects. A malformed tsconfig stays fatal rather than degrading to default
compiler options, which would type-check every example against a
configuration the user did not ask for.

`VersionConfig` carries no `tsconfig` or `compilerOptions` field — those
levels of the resolution cascade were never read, so a multi-version site
silently type-checked every version against the defaults; the unwired levels
were deleted rather than wired.

### Service layer

The plugin runs on Effect v4. `makeAppLayers(input)`
(`src/layers/AppLayer.ts`) returns both runtime stacks from a single call,
tiered by what each tier may reach: `PlatformLayer` (`NodeFileSystem.layer`),
`ObservabilityLayer` (event bus sinks, the metrics layer, the summary logger
gate), `CoreLayer` (`TypeRegistryService`, `TwoslashCacheService`,
`SnapshotService.layer(dbPath)`, `OgService` — services that own a resource
and need only the platform), and `BuildLayer` (`PluginConfig`,
`HighlighterService.layer(themes)`, `TwoslashEnvironments`, `BuildEnvLayer` —
scoped to this build's configuration). `app = ConfigService.layer` over
`mergeAll(BuildLayer, CoreLayer, ObservabilityLayer, NodeFileSystem.layer)`;
`emitter = mergeAll(ObservabilityLayer, BuildEnvLayer)`.

Returning both stacks from one call is deliberate: the two runtimes must
share `metrics.layer` and the `BuildEnv` references by reference, and both
halves fail silently when they do not — a split metric registry reports
every count as zero, a split `BuildId` mislabels every event a sync island
emits. See
[two-managed-runtimes](../decisions/two-managed-runtimes.md).

**Why two runtimes.** The main runtime's layer opens two SQLite databases at
construction (the snapshot store and the Twoslash result cache), so it is
asynchronous to build; `runtime.runSync` builds a runtime's layer before
running anything, so a sync emit from a remark plugin during RSPress's
render pass would die with `AsyncFiberError` — invisible to every unit test.
The sync-island emitters therefore run on `appLayers.emitter`, whose every
member is `Layer.succeed` and synchronously buildable.

**Per-build references** (`src/BuildEnv.ts`): `BuildId` (default `""`),
`Thresholds` (the resolved observability defaults), `PageConcurrency`
(default `1`; `plugin.ts` provides `os.cpus().length`), and
`SuppressExampleErrors` (default `true`). A `Context.Reference` carries a
default, so a wiring mistake succeeds quietly with the default rather than
failing loudly — use one only where the default is merely conservative,
never where it would be silently wrong (which is why the decoded plugin
options are a `Context.Service`, not a Reference — there is no sensible
default for "which APIs is this site documenting").

**Services and their layers** (each service owns its layer as a static, no
separate `*ServiceLive.ts` modules):

| Service | Module | Layer | Key dependencies |
| --- | --- | --- | --- |
| `ConfigService` | `src/services/ConfigService.ts` | `ConfigService.layer` | `TypeRegistryService`, `PluginConfig` |
| `PluginConfig` | `src/services/PluginConfig.ts` | `Layer.succeed` in `AppLayer.ts` | none |
| `HighlighterService` | `src/services/HighlighterService.ts` | `HighlighterService.layer(themes)` | none |
| `TwoslashEnvironments` | `src/services/TwoslashEnvironments.ts` | `TwoslashEnvironments.layer` | none |
| `OgService` | `src/services/OgService.ts` | `OgService.layer` | `FileSystem`, `Path` |
| `TwoslashCacheService` | `src/services/TwoslashCacheService.ts` | `TwoslashCacheService.layer` | `@effected/store` `Cache`, `src/layers/xdg.ts` |
| `TypeRegistryService` | `src/services/TypeRegistryService.ts` | `TypeRegistryService.layer` | `@tsdoctor/registry`, `@effected/store`, `src/layers/xdg.ts` |
| `SnapshotService` | `@tsdoctor/snapshot` | `SnapshotService.layer(dbPath)` | `@effected/store` |
| `EventBus` | `src/observability/EventBus.ts` | `buildEventBus` (`src/layers/observability.ts`) | the synchronous fan-out sinks |

A static initializer runs while the module body is still evaluating, so a
static naming a `const` declared further down throws at import time while
typechecking clean — the only symptom is vitest reporting "0 tests passed"
with exit code 0. `Layer.suspend(() => …)` for a layer, `Effect.suspend(() =>
make())` for an effect body, wherever a service's static names something
defined after it (`TypeRegistryService.layer`, `TwoslashCacheService.layer`,
`ConfigService.layer`, `OgService.layer` all do this).

`ConfigService`, `OgService`, `TwoslashCacheService`, `TypeRegistryService`
and `SnapshotService` ship `makeTest(overrides)` / `layerTest(overrides)`
doubles, each defaulting to the shape a build takes when nothing is
configured. `ConfigService.resolve` and `OgService.resolveImage` have no
default and throw naming themselves — their natural defaults (an empty
array, `Option.none`) are indistinguishable from a real answer.

`TypeRegistryService.layer` and `TwoslashCacheService.layer` acquire their
stacks once at `ManagedRuntime` construction, not inside each method body —
in Effect v4, `provideLayer` forks a child `MemoMap` per call, so per-method
provision built and tore down the registry stack and the Twoslash cache
twice per build. Both cache-backed layers degrade to a cache miss via
`@effected/store`'s `Cache.degrading` rather than `Layer.catchCause`, which
absorbs interruption along with every other cause. `SnapshotService.layer`
is the deliberate counter-example: its `StoreError | StoreMigrationError`
channel stays in the error channel and stops the build
(see [caches-degrade-snapshot-store-fails](../decisions/caches-degrade-snapshot-store-fails.md)).

### Page pipeline

`generateApiDocs` in `src/build-program.ts` orchestrates one API:
`prepareWorkItems` (the adapter's reporting wrapper over `@tsdoctor/pages`'s
— `ItemSkipped` / `RouteCollisionDetected` events, then
`Routes.RouteCollisionError` thrown on any collision); `buildPipelineForApi`
(the Stream pipeline); `writeMetadata` (the root `_meta.json`, the index
page, each category's `_meta.json`); `cleanupAndCommit` (batch snapshot
upsert, stale and orphan deletion, empty-directory sweep).

`buildPipelineForApi` runs `Stream.fromIterable(workItems)` through
`generateSinglePage` (concurrent), a null filter for unsupported item kinds,
`writeSingleFile` (concurrent), and a fold into `FileWriteResult[]`.
Concurrency is `PageConcurrency`, which `plugin.ts` provides as
`os.cpus().length`.

**Stage 1 — `generateSinglePage`.** `buildPage` returns `Option<Page>`; `None`
(an unsupported item kind) emits `ItemSkipped` and returns `null`. `emitMdxBody`
renders the blocks; the stage prepends `generateFrontmatter(...)`. `parseFrontmatter`
separates frontmatter from body; the body is spacing-normalized and hashed
with `hashContent`. **The SEO head tags are built here** — the OG image
through `OgService`, the JSON-LD through `@tsdoctor/seo`'s
`deriveScriptBody`, then `headTags` — and the final frontmatter is assembled
from them and hashed with `hashFrontmatter`, so the snapshot hash covers the
same frontmatter the page writes. See
[head-tags-built-in-generate-stage](../decisions/head-tags-built-in-generate-stage.md).
Both SEO failure paths degrade: an `OgImageError` or `StructuredDataError` is
emitted as `ConfigValidationWarning` and the page renders without that tag.

**Stage 2 — `writeSingleFile`.** Unchanged results increment metrics and
return without touching disk; otherwise the stage creates the directory,
writes `result.content`, increments the new/modified metric, and returns the
`FileWriteResult`.

**Stage 3 — `writeMetadata`.** `buildNav` (`@tsdoctor/pages`) builds one tree
per API; `src/emit/meta.ts` renders the root `_meta.json`, the category
`_meta.json` files, and `index.mdx` (skipped when the file already exists,
so a site can hand-author its landing page).

**Stage 4 — `cleanupAndCommit`.** Batch-upserts every changed snapshot in one
transaction, deletes stale rows and files, deletes orphan files no snapshot
tracks, then sweeps directories left empty — deepest first, each verified
empty before removal.

`generateFrontmatter` (`src/markdown/helpers.ts`) takes a neutral
`ReadonlyArray<HeadTag>` and renders each into an RSPress `[tagName, attrs]`
head pair — a `script` tag's body becomes the `children` attribute. The
block is emitted via `emitFrontmatterBlock` (`@tsdoctor/model`).

`build-program.ts` builds one immutable `CrossLinker.fromRoutes(routes)` per
API for the pipeline context and one `ShikiCrossLinker.fromRoutes(routes,
apiScope)` for the remark plugins, registers the latter with the
highlighter, transformers and theme in `VfsRegistry` under the API scope,
and adds the routes to the Twoslash type-route map (cleared per build).

### Emitters

`src/emit/mdx.ts`'s `emitMdxBody` renders a `@tsdoctor/pages` `Page` as MDX:
component import lines chosen from `Page.kind`, `ApiSignature` / `ApiMember`
/ `ApiExample` as JSX elements carrying JSON-encoded `code` and `source`
props, `ParametersTable` / `EnumMembersTable` as JSON props, and the prose
between them. `src/emit/meta.ts` owns the sidebar files and the landing page.
`emitMdxBody` returns a `Result` — a stringify failure is typed, not thrown.

Four byte-parity decisions keep this emitter producing the byte-identical
output of the generator classes it replaced — per-top-level-node
serialization with the emitter owning the joins (the kit's MDX-presence
escaping is tree-wide, so the moment any `MdxJsxFlowElement` is present it
rewrites `{` in every prose node; serializing one node at a time and letting
prose stay raw avoids that), generics escaping done on the mdast tree (a
`<T>` run in a `Text` node becomes an `InlineCode` node so the kit's
backtick serialization handles it, applied to the same subset of prose the
prior generators applied it to and deliberately not to member-level
parameter descriptions), prose entering the IR already linked, and nothing
post-processing the kit's emitted bytes. See
[per-node-mdx-serialization](../decisions/per-node-mdx-serialization.md) and
[byte-parity-emitter-changes](../conventions/byte-parity-emitter-changes.md).

### Cross-linking in code blocks

`src/shiki-transformer.ts`'s `ShikiCrossLinker.fromRoutes(routes, apiScope)`
post-processes Shiki's HAST output — rather than modifying spans during
rendering, because Twoslash's popup positioning depends on the original HAST
structure. It holds the routes and a `classMembersMap` grouping member names
by parent, and `transformHast(hast)` walks the tree in three phases per
line: class/namespace member linking via a scope stack tracking nested
bodies by brace matching; Twoslash tooltip method extraction from
`.twoslash-hover` spans matched against declaration forms; and top-level type
reference linking, splitting text nodes at reference boundaries and
inserting `<a class="api-type-link" data-api-processed>` elements. Both
linkers — the prose `CrossLinker` and `ShikiCrossLinker` — sort registered
names by length descending so longer names match first, and match on word
boundaries so a longer name is never matched as a substring of a shorter
one's prefix.

`src/vfs-registry.ts`'s `VfsRegistry` stores one `VfsConfig` per API scope —
highlighter, cross-linker, Twoslash and hide-cut transformers, package name,
scope, theme — with `register`, `get`, `clear` (called at the start of each
build). The remark plugins (`src/remark-with-api.ts`,
`src/remark-api-codeblocks.ts`) resolve the scope from the file being
rendered and read everything they need from that entry. A linker is a scope:
there is no mutable "current scope" and no `reinitialize` — scope isolation
is a property of the value the caller picks, which is load-bearing because
`generateApiDocs` runs per API concurrently. See
[linker-is-a-scope](../decisions/linker-is-a-scope.md).

### Observability

Build observability is a synchronous fan-out `EventBus`
(`src/observability/EventBus.ts`) feeding five sinks — console, issues,
trace (opt-in JSONL), metrics, render — rather than an async PubSub:
`emit` fans out to every sink inline, so by the time the emitting fiber
resumes, every sink has finished, keeping metrics exact when the build
summary reads them in `afterBuild`. See
[synchronous-event-bus](../decisions/synchronous-event-bus.md).

`PluginEvent` (`src/observability/events.ts`) is a `Data.TaggedEnum` whose
variants span lifecycle, config resolution, model loading, type loading and
VFS, routing, page generation and code blocks, write and cleanup, and LLMs.
A variant with no emit site is deleted, not kept — a taxonomy entry the code
cannot produce is a promise the trace and `issues.json` cannot keep.

Every event carries an `EventContext` envelope (`buildId`, `apiScope`,
`packageName`, `version`, `locale`, `entryPoint`, `route`, `file`,
`symbol`), every field optional; `emit` fills `buildId` from the `BuildId`
`Context.Reference` whenever the caller left it empty. Levels rank `error`
(0) through `trace` (4); a sink with `minLevel: "info"` admits ranks 0–2.

Sinks: console (human-readable or JSON at `debug` level), issues
(accumulates diagnostics into `.api-docs/build/issues.json`, collection
always on, write production-gated), trace (`minLevel: "trace"`, one
synchronous `appendFileSync` per event), metrics (writes through
`metric.updateUnsafe` with the build's own `MetricStore.context`, since the
sink runs outside any fiber), render (sample-shaped per-file and slowest-block
data too high-cardinality for the metric registry).

`withPhase(phase, ctx, effect)` (`src/observability/spans.ts`) wraps an
Effect in `Effect.withSpan`, emits `PhaseStarted` / `PhaseCompleted` with the
measured duration, and emits `SlowOperation` when duration exceeds the
threshold for that phase, read from the `Thresholds` `Context.Reference`.
The spans are OpenTelemetry-compatible but no exporter is wired — a dormant
seam.

Each build gets its own `Metric.MetricRegistry` via
`makeMetricStore()` rather than the process-wide default, which dev HMR
rebuilds and same-process test runs would otherwise accumulate into — but
this isolation only covers metrics recorded *with attributes*; undimensioned
counters resolve their registry entry once and cache it on the metric
object, so they remain process-wide.

`logBuildSummary` reads the metric snapshots at the end of `afterBuild`
(first build only) and prints file counts, pages, external packages, phase
timing, slow code blocks, and Twoslash/Prettier error totals.

**Sync-island bridge.** Remark visitors, Shiki's `preprocess` hook, Prettier
callbacks, and the page-generation reporting wrapper all run outside any
Effect fiber. They reach the bus through one module,
`src/observability/sync-emitter.ts`: `installSyncEmitter(runtime)` once in
`plugin.ts`, then `emitSync(event)`, `syncBuildId()`, and
`syncSlowCodeBlockMs()` from any sync site. The runtime handed to
`installSyncEmitter` must be synchronously buildable — `runSync` builds the
runtime's layer before running anything, so a runtime whose layer opens a
database fails with `AsyncFiberError` at the first emit, invisible to unit
tests. See [sync-island](../glossary/sync-island.md).

**Progress heartbeat.** `config()` holds a `Ref<ProgressPhase>` it flips
around `ConfigService.resolve()` and the per-API `Effect.forEach`. When
`isProd` and `progressIntervalMs` is set, a heartbeat fiber is forked with
`Effect.forkScoped`, sleeping first each tick so a build that finishes before
the first interval emits nothing. The heartbeat does not cover the phase
where Twoslash dominates — RSPress's own `node_md` render pass, which
invokes the remark plugins and therefore Twoslash, runs after `config()`
returns, once the scope hosting the heartbeat has closed. See
[heartbeat-misses-render-phase](../limitations/heartbeat-misses-render-phase.md).

**Render-phase attribution.** The Twoslash/Shiki split matters because
`@shikijs/twoslash`'s transformer runs the entire type-check inside its
`preprocess` hook; `createTwoslashTimingWrapper` wraps `preprocess` fresh per
block, closing over that block's own accumulator so concurrently-rendering
blocks on a page do not race. Spans must not cross an `await` —
`unist-util-visit` starts every block's async IIFE on a page before any
resumes from its first await, so a span measured across the await reports
the page's batch window, not the block's own cost. Bounded dimensions
(scope, component, whether Twoslash ran) are recorded as dimensioned
metrics; unbounded ones (file paths) stay sample-shaped in the render sink.
Production builds write `.api-docs/build/render-phase.json`.

### LLMs

`processLlmsFiles` (`src/llms-program.ts`) runs in `afterBuild`, once, when
`rspressLlmsEnabled && resolvedLlmsPlugin.enabled`: it reads the global
`llms.txt` / `llms-full.txt` RSPress's own `@rspress/plugin-llms` already
wrote, builds the API route map and discovers version/locale path prefixes,
then per prefix concurrently rewrites the global llms.txt (structured when
scoping is on, filtered otherwise), filters API sections out of
`llms-full.txt`, and, when scoping is on, generates four per-package files
(`llms.txt`, `llms-full.txt`, `llms-docs.txt`, `llms-api.txt`) at each
package's route. The transforms themselves are the pure `@tsdoctor/pages`
functions; this module supplies the I/O, the prefix discovery, and the
per-package/per-prefix collection logic. See
[llms-post-process-not-generate](../decisions/llms-post-process-not-generate.md).

With scoping on, the global llms.txt becomes a `## Others` section plus a
`## Packages` section with one `### {name} {version}` heading per package
carrying its description, guide links, and an API Reference pointer.

Two runtime UI components: `ApiLlmsPackageActions`, registered as a
`globalUIComponent` by absolute path to its transpiled `.js`; and
`ApiLlmsViewOptions`, which replaces RSPress's own `LlmsViewOptions` through a
`resolve.alias`. Both registrations are gated on the plugin not being inert.

### Build output

Built via `build()` from `@savvy-web/rspress-builder` (`savvy.build.ts`).
Two emitted halves: the plugin half (Node.js) — every `src/*.ts` becomes its
own `.js` under the package root, `dependencies` left external; and the
runtime half (browser) — emitted bundleless, each component transpiled
1:1 into its own `.js` beside its CSS module under `runtime/`, `react` /
`@theme` external, `import.meta.env` left as a runtime expression so RSPress
does the final per-site compile. A single bundle once froze
`import.meta.env.SSG_MD` to `undefined` and broke the SSG-MD dual-mode
branch. See
[bundleless-per-file-runtime](../decisions/bundleless-per-file-runtime.md).

The dev build writes `dist/dev/pkg`; `publishConfig` (`directory:
"dist/dev/pkg"`, `linkDirectory: true`) makes that directory the workspace
link target — sites depending on the plugin via `workspace:*` import the
built per-file JS, not `src/`. Production emits the published root under
`dist/prod/`, recorded in `dist/prod/targets.json`.

The plugin's own `tsconfig.json` uses `"module": "esnext"` and
`"moduleResolution": "bundler"` because API Extractor requires bundler
resolution. The package also publishes
`rspress-plugin-api-extractor/tsconfig/rspress.json`, a standard RSPress
React-JSX bundler-resolution config sites extend from.

`serve(options?)` (`src/serve.ts`) is exported from the main entry: frees the
target port (best-effort `lsof`), spawns `pnpm rspress dev|preview`, streams
output, and opens a browser once the server is ready, detected from
RSPress's `Local:` address line.

## Invariants

- `Routes.sanitizeId` is the only anchor algorithm reachable from this
  package; never spell a second one.
- The two `ManagedRuntime`s share `metrics.layer` and the `BuildEnv`
  references by reference — never construct them from different inputs.
- Every service's layer is a static on the service class; no
  `layers/*ServiceLive.ts` module is reintroduced.
- Head-tag construction happens in the generate stage, before the snapshot
  hash is taken, never in the write stage.
- A linker (prose or Shiki) is a scope — never a mutable "current scope"
  swapped per API.
- No barrel module exists inside `src/` besides `src/index.ts`.

## Links

- [core-adapter-boundary](../decisions/core-adapter-boundary.md)
- [generate-docs-in-config-hook](../decisions/generate-docs-in-config-hook.md)
- [two-managed-runtimes](../decisions/two-managed-runtimes.md)
- [caches-degrade-snapshot-store-fails](../decisions/caches-degrade-snapshot-store-fails.md)
- [site-url-is-derived-not-configured](../decisions/site-url-is-derived-not-configured.md)
- [bundleless-per-file-runtime](../decisions/bundleless-per-file-runtime.md)
- [single-anchor-algorithm](../decisions/single-anchor-algorithm.md)
- [linker-is-a-scope](../decisions/linker-is-a-scope.md)
- [route-collisions-fail-the-build](../decisions/route-collisions-fail-the-build.md)
- [import-namespace-root-not-leaf](../decisions/import-namespace-root-not-leaf.md)
- [head-tags-built-in-generate-stage](../decisions/head-tags-built-in-generate-stage.md)
- [per-node-mdx-serialization](../decisions/per-node-mdx-serialization.md)
- [synchronous-event-bus](../decisions/synchronous-event-bus.md)
- [persisted-twoslash-result-cache](../decisions/persisted-twoslash-result-cache.md)
- [per-scope-typescript-environments](../decisions/per-scope-typescript-environments.md)
- [llms-post-process-not-generate](../decisions/llms-post-process-not-generate.md)
- [effected-is-the-foundation](../conventions/effected-is-the-foundation.md)
- [services-own-their-layers](../conventions/services-own-their-layers.md)
- [rspress-dependency-closure](../conventions/rspress-dependency-closure.md)
- [core-peers-follow-public-surface](../decisions/core-peers-follow-public-surface.md)
- [no-internal-barrels](../conventions/no-internal-barrels.md)
- [runtime-component-authoring](../conventions/runtime-component-authoring.md)
- [observability-events-not-logs](../conventions/observability-events-not-logs.md)
- [render-phase-spans](../conventions/render-phase-spans.md)
- [byte-parity-emitter-changes](../conventions/byte-parity-emitter-changes.md)
- [compiler-options-decode-not-cast](../conventions/compiler-options-decode-not-cast.md)
- [rspress-plugin-options](../interfaces/rspress-plugin-options.md)
- [rspress-package-exports](../interfaces/rspress-package-exports.md)
- [snapshot-database](../models/snapshot-database.md)
- [issues-json-artifact](../models/issues-json-artifact.md)
- [static-initializer-zero-tests](../gotchas/static-initializer-zero-tests.md)
- [twoslash-fallback-hides-scope-bugs](../gotchas/twoslash-fallback-hides-scope-bugs.md)
- [zero-typechecked-means-holder-missing](../gotchas/zero-typechecked-means-holder-missing.md)
- [undimensioned-metrics-are-process-wide](../gotchas/undimensioned-metrics-are-process-wide.md)
- [warm-rspack-cache-hides-twoslash](../gotchas/warm-rspack-cache-hides-twoslash.md)
- [unit-test-passes-on-input-no-caller-produces](../gotchas/unit-test-passes-on-input-no-caller-produces.md)
- [heartbeat-misses-render-phase](../limitations/heartbeat-misses-render-phase.md)
- [collision-detection-by-final-route](../limitations/collision-detection-by-final-route.md)
- [imports-do-not-trace-re-exports](../limitations/imports-do-not-trace-re-exports.md)
- [twoslash-cache-invalidates-per-vfs](../limitations/twoslash-cache-invalidates-per-vfs.md)
- [with-api-scope-inference-never-fires](../limitations/with-api-scope-inference-never-fires.md)
- [plugin-vs-platforms](../glossary/plugin-vs-platforms.md)
- [sync-island](../glossary/sync-island.md)
- [display-and-source](../glossary/display-and-source.md)
- [measure-hover-parity](../runbooks/measure-hover-parity.md)
