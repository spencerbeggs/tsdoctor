---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 88
related:
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/cross-linking-architecture.md
  - rspress-plugin-api-extractor/component-development.md
  - rspress-plugin-api-extractor/multi-entry-resolution.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
dependencies: []
---

# Page Generation System

## Table of Contents

- [Overview](#overview)
- [Stream Pipeline Architecture](#stream-pipeline-architecture)
- [Build Stages](#build-stages)
- [Page builders and emitters](#page-builders-and-emitters)
- [Metadata Generation](#metadata-generation)
- [Integration Points](#integration-points)

## Overview

The page generation system transforms Microsoft API Extractor models into markdown/MDX files for RSPress. It uses a Stream-based pipeline in `build-stages.ts` composed of Effect programs. Since phase 5 (2026-09-02) what a page CONTAINS is decided by the framework-neutral `@tsdoctor/pages` builders and the adapter only EMITS: `buildPage` lifts an `ApiItem` into a typed `Page`, and `src/emit/mdx.ts` spends it as RSPress MDX. The eight generator classes are deleted. See `doc-ir-and-pages.md` for the IR and the golden gate the switch was made behind.

**Key Features:**

- **Effect Stream pipeline** for concurrent page generation and writing
- **5-stage build process** orchestrated by `build-program.ts`
- **Multi-entry point resolution** via `@tsdoctor/model`'s `EntryPoints`
  module for deduplication and collision detection
- **`@tsdoctor/pages` builders** (`buildPage`, one per item kind) producing a typed `Page`, and the adapter's MDX emitter (`emitMdxBody`) rendering it
- **Snapshot-tracked writes** for incremental builds (`@tsdoctor/snapshot`)
- **Cross-linking** via ShikiCrossLinker and the `@tsdoctor/model`
  `CrossLinker`, built once per API and carried in the pipeline context
- **Effect Metrics** for build statistics

## Stream Pipeline Architecture

### Pipeline Definition (build-stages.ts)

The core pipeline is defined in `buildPipelineForApi`:

```typescript
return Stream.fromIterable(input.workItems).pipe(
  // Stage 1: Generate page content + hashes + timestamps
  Stream.mapEffect(
    (workItem) => generateSinglePage(workItem, generateCtx),
    { concurrency: input.pageConcurrency },
  ),
  // Filter nulls (unsupported item kinds)
  Stream.filter(
    (result): result is GeneratedPageResult => result !== null,
  ),
  // Stage 2: Write file to disk (no-op for unchanged)
  Stream.mapEffect(
    (result) => writeSingleFile(result, writeCtx),
    { concurrency: input.pageConcurrency },
  ),
  // Fold: accumulate all results.
  // Effect v4 takes the initial value as a lazy thunk.
  Stream.runFold(
    () => [] as FileWriteResult[],
    (acc, result) => [...acc, result],
  ),
);
```

**Concurrency:** Controlled by the `PageConcurrency` `Context.Reference`
(`src/BuildEnv.ts`), which `plugin.ts` provides as `os.cpus().length`.
`build-program.ts` reads it and passes it into the pipeline input.

### Data Types

```typescript
interface WorkItem {
  item: ApiItem;
  categoryKey: string;
  categoryConfig: CategoryConfig;
  namespaceMember?: ApiItems.NamespaceMember;  // from @tsdoctor/model
  /** Entry points this item is available from */
  availableFrom?: string[];
  /** Unexported base declaration to inline on this class page */
  syntheticBase?: ApiItem;
  /**
   * Anchor id per member, keyed by the member's canonical reference.
   * Computed once in prepareWorkItems so the route map's `#fragment` and
   * the page's `id=` come from ONE computation. Classes and interfaces.
   */
  memberAnchors?: ReadonlyMap<string, string>;
}

interface GeneratedPageResult {
  workItem: WorkItem;
  content: string;
  bodyContent: string;
  frontmatter: Record<string, unknown>;
  contentHash: string;
  frontmatterHash: string;
  routePath: string;
  relativePathWithExt: string;
  publishedTime: string;
  modifiedTime: string;
  isUnchanged: boolean;
}

interface FileWriteResult {
  relativePathWithExt: string;
  absolutePath: string;
  status: "new" | "modified" | "unchanged";
  snapshot: FileSnapshot;
  categoryKey: string;
  label: string;
  routePath: string;
}
```

## Build Stages

### Stage 0: prepareWorkItems (sync, pure)

**Location:** `build-stages.ts` `prepareWorkItems()`

Runs before the Stream pipeline. Since phase 5 (`b09db83`) the computation is `@tsdoctor/pages`'s `prepareWorkItems` (`WorkItems.ts`), lifted out of this adapter once the VitePress adapter needed the same step; it orchestrates `@tsdoctor/model`'s namespace modules (`EntryPoints`, `SyntheticBases`, `ApiItems`, `Routes`) and returns `uncategorized` items and route `collisions` as DATA. The adapter's `prepareWorkItems` in `build-stages.ts` is a reporting wrapper of the same name over that result: it emits an `ItemSkipped` event per uncategorized item and a `RouteCollisionDetected` event per collision before throwing `Routes.RouteCollisionError`, so the fatal path still reaches `issues.json`. The adapter's `WorkItem` is the pages `WorkItem<CategoryConfig>`. Produces:

1. **Multi-entry resolution** -- `EntryPoints.resolve(apiPackage)`
   deduplicates re-exports across entry points. Each item receives
   `availableFrom`.
2. **Synthetic base detection** -- `SyntheticBases.detect()` finds unexported items (hoisted into the model via `includeForgottenExports`, `isExported === false` per `ApiExportedMixin`) that an exported class's extends clause references — the `Foo_base` declarations TypeScript emits for class-factory heritage (Effect `Schema.Class`, `Data.TaggedError`, mixins). Detected bases are **excluded** from categorization, collision detection and work items: they get no page and no sidebar entry. Instead the owning class's `WorkItem` carries `syntheticBase`, and the class page renders the declaration inline in a "Base Class" section (anchor `SyntheticBases.BASE_CLASS_ANCHOR` = `#base-class`). The base's cross-link route points at that anchor, so the `extends Foo_base` reference in signatures stays clickable. Unexported items NOT referenced by a class extends clause (genuine forgotten exports) keep the previous behavior, as do dangling extends references whose base is absent from the model.
3. **Member anchors** -- `ApiItems.memberAnchors(item)` for each class and interface, carried on the `WorkItem` and consumed by BOTH the cross-link route map and the page builder, so a member's `#fragment` and its `id=` cannot drift (see `cross-linking-architecture.md`)
4. **Categorized items** -- API items grouped by category key via
   `ApiItems.categorize(items, categories)`, which returns
   `{ items, uncategorized }`; the adapter emits an `ItemSkipped`
   event for each uncategorized item (see
   `performance-observability.md`). Namespace members come from
   `ApiItems.namespaceMembers(items)`.
5. **Route collision detection** -- `Routes.RouteCandidate` records are
   built for all top-level items and namespace members and checked with
   `Routes.detectCollisions()`; the pages function returns the collisions,
   and the adapter wrapper **throws**
   `Routes.RouteCollisionError` (a `Schema.TaggedError`) with a clear
   message naming both items, their kinds, canonical references, and the
   shared lowercased `categoryFolder/name` route, with guidance to
   rename the items or remap categories. There is no automatic suffix
   or silent disambiguation.
6. **Cross-link routes** -- Map of type name to route path (always the lowercased path, never suffixed); synthetic base names map to the owner class route plus `#base-class`
7. **Cross-link kinds** -- Map of type name to API item kind
8. **Namespace member extraction** with collision detection
9. **Flat WorkItem array** -- Each item carries `availableFrom` (plus `syntheticBase` on classes with a detected base, and `memberAnchors` on classes and interfaces)

### Stage 1: generateSinglePage (Effect)

**Location:** `build-stages.ts` `generateSinglePage()`

For each WorkItem:

1. **`buildPage`** (`@tsdoctor/pages`, `Build.ts`) — the work item's facts (`item`, category key/singular/folder, `availableFrom`, `syntheticBase`, `memberAnchors`, the namespace member's qualified name, the source-link target, `suppressExampleErrors`) plus the per-API `linker` go in; an `Option<Page>` comes out. `None` means an unsupported item kind, and the stage emits `ItemSkipped` and returns `null`. A namespace member's route is decided by the builder from the qualified name (`.../type/compileroptions.type`), so the file path equals the cross-link route built in `prepareWorkItems` by construction. Prettier failures inside the builder degrade through `onExampleFormatError`, which is where the stage emits its `PrettierError` event; the builder's error channel is `never`
2. **`emitMdxBody`** (`src/emit/mdx.ts`) renders the page's blocks as the MDX body — import lines chosen from `Page.kind`, JSX elements as `@effected/markdown` MDX nodes, prose serialized by the kit. The stage then prepends `generateFrontmatter(...)` (`markdown/helpers.ts`) so the text downstream has exactly the frontmatter-plus-body shape the generators produced
3. Parse generated content with `parseFrontmatter` (`@tsdoctor/model`'s `Frontmatter.ts`, moved out of the adapter in the Tier 1 core moves — `@effected/markdown`'s `FrontmatterSource.split` for the fence grammar plus `@effected/yaml` for the YAML; the hand-rolled gray-matter-parity split it replaced is gone, the digests it produced are unchanged, and the four boundary tests that pinned gray-matter's quirks are re-pinned to the strict grammar)
4. Normalize markdown spacing
5. Hash the body via `hashContent`
6. **Build the page's SEO head tags** — resolve the OG image through `OgService`, derive the JSON-LD via `@tsdoctor/seo`'s `deriveScriptBody`, and call `headTags` — then assemble the FINAL frontmatter from them
7. Hash that final frontmatter via `hashFrontmatter`
8. Compare hashes against pre-loaded snapshot map
9. If no snapshot exists, fall back to disk comparison
10. Determine timestamps (new/modified/unchanged)
11. Return `GeneratedPageResult`, whose `content` is the assembled final text

Steps 1–2 replaced a single "dispatch to the page generator" step in phase 5; everything from step 3 on is untouched, which is what let the switch be made behind a byte-identity gate (`doc-ir-and-pages.md`).

**Step 6 is here, not in the write stage, and that placement is load-bearing.** Head tags used to be built in `writeSingleFile`, one stage after the hash was taken — so the hash was computed over the page generator's own frontmatter, which carries no `head` at all, and every `og:image`, canonical URL and JSON-LD change was invisible to change detection. See the head-tag section of `snapshot-tracking-system.md` for the full defect and its measured fix.

The stage builds a local `finalFrontmatter(published, modified)` and calls it **twice** — once with the build time to hash, once with the resolved timestamps to write. The two hash identically only because `hashFrontmatter` strips timestamps recursively; without that, the hash would depend on the timestamps the hash itself decides.

`GenerateSinglePageContext` therefore carries `siteUrl`, `docsRoot`, `ogImage` and `structuredDataPkg` (the per-API `PackageContext` derived once in `build-program.ts`), and the stage's requirement channel gained `OgService`. Both SEO failure paths **degrade**: an `OgImageError` or a `StructuredDataError` is emitted as a `ConfigValidationWarning` (reaching `issues.json`) and the page renders without that tag.

### Stage 2: writeSingleFile (Effect)

**Location:** `build-stages.ts` `writeSingleFile()`

For each GeneratedPageResult:

1. If unchanged, increment metrics and return immediately (no disk write)
2. Create directory if needed (`FileSystem.makeDirectory`)
3. Write `result.content` (`FileSystem.writeFileString`)
4. Increment file metrics (new/modified)
5. Return `FileWriteResult` with snapshot data

**OG resolution and frontmatter regeneration used to happen here and no longer do.** The generate stage assembles the final text, head tags included — that is what makes the frontmatter hash cover them. This stage writes what it is handed.

### Stage 3: writeMetadata (Effect)

**Location:** `build-stages.ts` `writeMetadata()`

Writes three groups of metadata after the Stream pipeline. The navigation is IR output: the stage builds one `NavTree` per API with `buildNav` (`@tsdoctor/pages`, from the resolved categories and one `NavEntry` per written page) and renders it through `src/emit/meta.ts`, which owns the RSPress sidebar defaults (`collapsible` / `collapsed` true, `overviewHeaders: [2]`) and the tab-indented JSON spelling the snapshot system compares against:

1. **Root `_meta.json`** -- `renderRootMeta(navTree)`, one `dir` entry per category group that received a page
2. **Main index page** (`index.mdx`) -- `buildIndexPage` → `emitIndexPage`, frontmatter only with `overview: true` (skipped if the file already exists)
3. **Category `_meta.json` files** -- `renderCategoryMeta(group)` per nav group, pages in the tree's label-sorted order

All writes use snapshot tracking for incremental builds.

### Stage 4: cleanupAndCommit (Effect)

**Location:** `build-stages.ts` `cleanupAndCommit()`

1. **Batch upsert** -- All changed snapshots in a single transaction
2. **Stale cleanup** -- Delete DB rows and disk files for items no
   longer in the API model
3. **Orphan cleanup** -- Delete disk files not tracked in
   `generatedFiles` set

## Page builders and emitters

### Builders (`@tsdoctor/pages`)

`packages/pages/src/Build.ts` exports `buildPage`, `buildIndexPage` and `isPageKind`. `buildPage` is one builder per item kind (class, interface, function, type alias, enum, variable, namespace), lifted from the generator classes as a characterization — same blocks, same order, same text — so the golden gate could be the oracle. Its input, `BuildPageInput`, is framework-neutral and carries exactly the facts the work item and the API config contribute; its output is a `Page` (`Page.ts`): title parts, description, route, `headTags`, the ordered `blocks` and the page's `NavEntry`, plus a required `kind` so an emitter can pick imports and layout without re-inspecting the item. The landing page is a separate, blockless `IndexPage`. See `doc-ir-and-pages.md` for the vocabulary and the decisions.

Three properties of the builders matter to the pipeline:

- **Anchors are data.** `memberAnchors` from the work item is the source of every member `id`; only the fixed constructor and call/construct/index-signature anchors are spelled in the builder, through the model's `Routes.memberAnchor`. Assert that the pipeline path passes the map — the builder falls back to recomputing anchors only for out-of-pipeline callers (tests), and a dropped argument would silently revert route/page agreement to two computations matching.
- **Prose is linked, then parsed.** Every prose field goes through the per-API `CrossLinker` and is parsed as commonmark mdast before it enters a block, so links are baked into the IR (`cross-linking-architecture.md`).
- **The error channel is `never`.** Example formatting runs through `formatExampleCode` (`Examples.ts`, Prettier, Effect-typed `ExampleFormatError`); a failure invokes the caller's `onExampleFormatError` hook and the example carries its unformatted code.

The class builder renders a detected `syntheticBase` as a `BaseClass` block after the signature — the emitter spells it as the `## Base Class` section whose slug is `SyntheticBases.BASE_CLASS_ANCHOR` (`@tsdoctor/model`), where the base name's cross-link route points.

### Emitters (`platforms/rspress/src/emit/`)

`mdx.ts` — `emitMdxBody(page, { apiScope, llmsEnabled })` returns the MDX body as a `Result`: the import lines, `ApiSignature` / `ApiMember` / `ApiExample` as `MdxJsxFlowElement`s with JSON-encoded `code` / `source` props, `ParametersTable` / `EnumMembersTable` as JSON props, and the prose between them. Every node is `@effected/markdown` mdast serialized by the kit; the emitter owns only the joining of top-level nodes (each serialized as its own document, because the kit's MDX-presence escaping is tree-wide), and the tree-form generics escaping where the generators applied `escapeMdxGenerics`. The labelled `unescapeLiteral` byte-parity shim it once carried is deleted since `@effected/markdown` 0.8.0 escapes minimally. Both, and the kit round behind the deletion, are recorded in `doc-ir-and-pages.md`.

`meta.ts` — `renderRootMeta` / `renderCategoryMeta` over the `NavTree`, and `emitIndexPage` over the `IndexPage`. Pure functions of the IR, consumed by `writeMetadata`.

### Page Structure

Generated MDX files follow this structure:

```markdown
---
title: "ItemName | Category | API | PackageName"
description: "Brief summary"
head:
  - - meta
    - property: "article:published_time"
      content: "2026-01-15T12:00:00.000Z"
  - - meta
    - property: "article:modified_time"
      content: "2026-01-17T10:30:00.000Z"
---

import { SignatureBlock, ParametersTable }
  from "rspress-plugin-api-extractor/runtime";

# ItemName

Available from: `package-name`, `package-name/testing`

Summary text.

## Signature

<SignatureBlock>
...signature code block...
</SignatureBlock>

## Members / Parameters / Values
...
```

The "Available from" line appears only when the item is exported from
more than one entry point.

### Helper Functions

**Location:** `markdown/helpers.ts` — frontmatter only, since phase 5

- `generateFrontmatter()` -- YAML frontmatter, taking a neutral `ReadonlyArray<HeadTag>` from `@tsdoctor/seo` and rendering each into an RSPress `[tagName, attrs]` head pair. A `script` tag's body becomes the `children` attribute — the name unhead maps onto `innerHTML`, and the only spelling that reaches the browser (any other emits an empty `<script>` and fails silently at runtime rather than in the build). The block itself is emitted via
  `emitFrontmatterBlock` (`@tsdoctor/model`'s `Frontmatter.ts`, `@effected/yaml`
  `Yaml.stringify` with `quoteCompat: "yaml-1.1"` + `quoteStyle: "double"` --
  double-quoting only the scalars a YAML 1.1 resolver would coerce
  (timestamps, `yes`/`no`/`on`/`off`, legacy numbers) -- then assembled into
  the fenced block via `@effected/markdown`'s `FrontmatterSource.join`)
Everything else the module used to hold has moved: example preparation (`prepareExampleCode`, `stripTwoslashDirectives`, `prependHiddenImports`, `formatExampleCode`) lives in `@tsdoctor/pages`'s `Examples.ts`, the "Available from" line is an `AvailableFrom` block the emitter spells, and `escapeMdxGenerics` lives in `src/emit/mdx.ts` beside its mdast-tree form. `remark-with-api.ts` imports `stripTwoslashDirectives` from the package directly.

`sanitizeId()` and `escapeYamlString()` are **deleted**. The page-side
`sanitizeId` was a second, subtly different anchor algorithm and is replaced by
`Routes.sanitizeId` / `Routes.memberAnchor` from `@tsdoctor/model` — see
`cross-linking-architecture.md` for the dead cross-links it produced.
`escapeYamlString` was a hand-written YAML quoting heuristic with a single
caller (`index-pages.ts`, which hand-built its frontmatter as a template
literal) and zero test coverage; that block now goes through
`emitFrontmatterBlock` like every other page, so `index.mdx`'s frontmatter is
double-quoted — semantically identical, byte-different, and only visible on a
fresh site since `writeMetadata` skips an existing `index.mdx`.

### MemberFormatTransformer

**Location:** `hide-cut-transformer.ts`

Formats member signature blocks by hiding the class/interface wrapper:

```typescript
// Input (3-line structure):
class Foo {
  memberSignature(): void;
}

// Output (after transformer):
memberSignature(): void;
```

Hides line 0 (class opening) and last line (closing brace), removes
left padding from line 1.

## Metadata Generation

### _meta.json Structure

**Root `_meta.json`:**

```json
[
  {
    "type": "dir",
    "name": "class",
    "label": "Classes",
    "collapsible": true,
    "collapsed": true,
    "overviewHeaders": [2]
  }
]
```

**Category `_meta.json`:**

```json
[
  { "type": "file", "name": "myclass", "label": "MyClass" },
  { "type": "file", "name": "otherclass", "label": "OtherClass" }
]
```

Entries are sorted alphabetically by label.

## Integration Points

### Cross-Linking

Cross-linkers are initialized in `build-program.ts` with data from
`prepareWorkItems`:

```typescript
const linker = CrossLinker.fromRoutes(crossLinkData.routes);  // → pipeline context, into buildPage
const shikiCrossLinker = ShikiCrossLinker.fromRoutes(
  crossLinkData.routes,
  crossLinkData.kinds,
  apiScope,
);                                     // a NEW immutable linker per API
addTypeRoutes(crossLinkData.routes);   // cleared per build by clearTypeRoutes()
```

### VFS Registry

Each API registers its VFS config for the remark plugin:

```typescript
VfsRegistry.register(apiScope, {
  highlighter,          // from HighlighterService — never absent
  crossLinker: shikiCrossLinker,
  packageName,
  apiScope,
  twoslashTransformer,  // environments.transformerFor(apiScope)
  hideCutTransformer,   // MemberFormatTransformer, imported directly
  hideCutLinesTransformer,
  theme,
});
```

The `vfs` field is gone (one write, zero reads), and the `if (highlighter)`
guard that used to wrap this registration is gone with it — the highlighter now
comes from the runtime-lifetime `HighlighterService`, so it can never be absent
and the guard could only ever have skipped a whole scope silently.

### Remark Plugins

Two remark plugins process code blocks in the RSPress build phase:

- `remarkWithApi` -- User-authored `with-api` code blocks
- `remarkApiCodeblocks` -- Generated API doc code blocks

Both use the VfsRegistry to access the highlighter and transformers.

## Related Documentation

- **Build Architecture:**
  `build-architecture.md` -- Plugin structure and service layer
- **Multi-Entry Resolution:**
  `multi-entry-resolution.md` -- Entry point resolution, deduplication
  and route collision detection
- **Snapshot Tracking System:**
  `snapshot-tracking-system.md` -- Incremental build tracking
- **Cross-Linking Architecture:**
  `cross-linking-architecture.md` -- Type reference linking
- **Component Development:**
  `component-development.md` -- Runtime components used in generated pages
- **SSG-Compatible Components:**
  `ssg-compatible-components.md` -- Dual-mode components
- **Structured Data and Head Metadata:**
  `structured-data-and-og.md` -- the `@tsdoctor/seo` seam Stage 1 consumes
- **Doc IR and `@tsdoctor/pages`:**
  `doc-ir-and-pages.md` -- the builders Stage 1 calls, the emitter decisions and the golden gate
- **LLMs Integration:**
  `llms-integration.md` -- LLMs file generation and UI
