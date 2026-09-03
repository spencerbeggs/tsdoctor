---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/plugin-lifecycle.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
  - rspress-plugin-api-extractor/rspress-mdx-emitter.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/cross-linking-architecture.md
  - rspress-plugin-api-extractor/multi-entry-resolution.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
---

# Page generation system

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Stream pipeline](#stream-pipeline)
- [Stage 0: prepareWorkItems](#stage-0-prepareworkitems)
- [Stage 1: generateSinglePage](#stage-1-generatesinglepage)
- [Stage 2: writeSingleFile](#stage-2-writesinglefile)
- [Stage 3: writeMetadata](#stage-3-writemetadata)
- [Stage 4: cleanupAndCommit](#stage-4-cleanupandcommit)
- [Frontmatter](#frontmatter)
- [Integration points](#integration-points)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

The page generation system turns an API Extractor model into MDX files for RSPress through a Stream-based pipeline in `build-stages.ts`. What a page contains is decided by the framework-neutral `@tsdoctor/pages` builders and the adapter only emits: `buildPage` lifts an `ApiItem` into a typed `Page`, `src/emit/mdx.ts` renders it as MDX and the snapshot system decides whether the result needs writing.

## Current state

| Concern | Where it lives |
| --- | --- |
| Pipeline definition and the five stages | `platforms/rspress/src/build-stages.ts` |
| Per-API orchestration, linker construction, VFS registration | `platforms/rspress/src/build-program.ts` |
| Builders (`buildPage`, `buildIndexPage`) and `prepareWorkItems` | `@tsdoctor/pages` (`packages/pages/src/Build.ts`, `WorkItems.ts`) |
| MDX body and `_meta.json` emission | `platforms/rspress/src/emit/mdx.ts`, `emit/meta.ts` |
| Frontmatter | `platforms/rspress/src/markdown/helpers.ts` over `@tsdoctor/model`'s `Frontmatter.ts` |
| Member-signature display transformer | `platforms/rspress/src/hide-cut-transformer.ts` |

## Stream pipeline

`buildPipelineForApi` runs `Stream.fromIterable(workItems)` through `generateSinglePage` (concurrent), a null filter for unsupported item kinds, `writeSingleFile` (concurrent) and a fold into `FileWriteResult[]`. Concurrency is the `PageConcurrency` `Context.Reference` (`src/BuildEnv.ts`), which `plugin.ts` provides as `os.cpus().length`. The cardinal types — `WorkItem` (the pages `WorkItem<CategoryConfig>`), `GeneratedPageResult` and `FileWriteResult` — are declared at the top of `build-stages.ts`.

## Stage 0: prepareWorkItems

Runs before the Stream, synchronously. The computation is `@tsdoctor/pages`'s `prepareWorkItems`, which orchestrates the model's `EntryPoints`, `SyntheticBases`, `ApiItems` and `Routes` namespaces and returns work items, the cross-link route map, `uncategorized` items and route `collisions` as data. The adapter's wrapper of the same name in `build-stages.ts` emits an `ItemSkipped` event per uncategorized item and a `RouteCollisionDetected` event per collision through the sync-island bridge, then throws `Routes.RouteCollisionError`, so the fatal path still reaches `issues.json`. What the step computes — entry-point deduplication, synthetic base detection, member anchors, categorization, collision detection and the route map — is documented in `multi-entry-resolution.md` and `cross-linking-architecture.md`.

Synthetic bases matter to this stage's output: an unexported `Foo_base` that an exported class's extends clause references gets no page and no sidebar entry. The owning class's `WorkItem` carries it as `syntheticBase`, and the class page renders the declaration inline in a "Base Class" section at `SyntheticBases.BASE_CLASS_ANCHOR`, where the base name's cross-link route points.

## Stage 1: generateSinglePage

For each work item:

1. **`buildPage`** takes the work item's facts plus the per-API `linker` and returns `Option<Page>`. `None` is an unsupported item kind: the stage emits `ItemSkipped` and returns `null`. Prettier failures degrade through `onExampleFormatError`, where the stage emits `PrettierError`. A namespace member's route is decided by the builder from the qualified name, so the file path equals the cross-link route by construction.
2. **`emitMdxBody`** renders the blocks; the stage prepends `generateFrontmatter(...)` so the text has the frontmatter-plus-body shape the rest of the stage reads.
3. `parseFrontmatter` separates the two, the body is spacing-normalized and hashed with `hashContent`.
4. **The SEO head tags are built here** — the OG image through `OgService`, the JSON-LD through `@tsdoctor/seo`'s `deriveScriptBody`, then `headTags` — and the final frontmatter is assembled from them and hashed with `hashFrontmatter`.
5. The hashes are compared against the pre-loaded snapshot map, falling back to disk when no snapshot exists, and the timestamps are resolved (`snapshot-tracking-system.md`).
6. The result's `content` is the assembled final text.

Step 4 lives in the generate stage so step 5 can see it. It used to live in the write stage, one step after the hash was taken, which made every head-tag change invisible to change detection. The stage builds a local `finalFrontmatter(published, modified)` and calls it twice — once with the build time to hash, once with the resolved timestamps to write — which is sound only because `hashFrontmatter` strips timestamps recursively.

Both SEO failure paths degrade: an `OgImageError` or a `StructuredDataError` is emitted as a `ConfigValidationWarning` and the page renders without that tag. `GenerateSinglePageContext` therefore carries `siteUrl`, `docsRoot`, `ogImage` and the per-API `structuredDataPkg`, and the stage requires `OgService`.

## Stage 2: writeSingleFile

Unchanged results increment metrics and return without touching disk. Otherwise the stage creates the directory, writes `result.content`, increments the new/modified metric and returns the `FileWriteResult` with its snapshot. It writes what it is handed; nothing is regenerated here.

## Stage 3: writeMetadata

Runs after the Stream. The navigation is IR output: `buildNav` (`@tsdoctor/pages`) builds one tree per API from the resolved categories and one `NavEntry` per written page, and `emit/meta.ts` renders the root `_meta.json`, the category `_meta.json` files and `index.mdx` (skipped when the file already exists, so a site can hand-author its landing page). All writes are snapshot-tracked, with JSON normalization for the disk-fallback comparison.

## Stage 4: cleanupAndCommit

Batch-upserts every changed snapshot in one transaction, deletes stale rows and their files, deletes orphan files on disk that no snapshot tracks, then sweeps directories left empty — seeded from both deletion lists, deepest first, each verified empty before removal (`snapshot-tracking-system.md`).

## Frontmatter

`generateFrontmatter` (`markdown/helpers.ts`) is the one helper left in that module. It takes a neutral `ReadonlyArray<HeadTag>` from `@tsdoctor/seo` and renders each into an RSPress `[tagName, attrs]` head pair; a `script` tag's body becomes the `children` attribute, the name unhead maps onto `innerHTML` and the only spelling that reaches the browser. The block is emitted via `emitFrontmatterBlock` (`@tsdoctor/model`), which double-quotes only the scalars a YAML 1.1 resolver would coerce. The page-side `sanitizeId` that once lived here is gone: `Routes.sanitizeId` is the only anchor algorithm (`cross-linking-architecture.md`).

`MemberFormatTransformer` (`hide-cut-transformer.ts`) formats member signature blocks at render time by hiding the class wrapper lines around a member and removing the member's indentation; `HideCutLinesTransformer` hides everything up to and including a `// ---cut---` line.

## Integration points

`build-program.ts` builds one immutable `CrossLinker.fromRoutes(routes)` per API for the pipeline context and one `ShikiCrossLinker.fromRoutes(routes, apiScope)` for the remark plugins, registers the latter with the highlighter, transformers and theme in `VfsRegistry` under the API scope, and adds the routes to the Twoslash type-route map (cleared per build). The highlighter comes from the runtime-lifetime `HighlighterService`, so it is never absent and registration is unconditional. `remarkWithApi` (user-authored `with-api` fences) and `remarkApiCodeblocks` (generated blocks) read the registry during RSPress's render pass.

## Rationale

- **Why the adapter only emits:** what a page contains must be identical across adapters or llms output and routes diverge; that knowledge lives once in `@tsdoctor/pages` (`doc-ir-and-pages.md`).
- **Why head tags are built in the generate stage:** the frontmatter hash must cover the final frontmatter; producing content in the write stage that the hash is supposed to cover is the wrong place by definition.
- **Why the null filter rather than a builder error:** an unsupported kind is a reportable event, not a build failure — the builder's error channel is `never` on purpose.

## Related documentation

- **Plugin lifecycle and the build program:** `plugin-lifecycle.md`
- **The IR and builders:** `doc-ir-and-pages.md`
- **The MDX emitter:** `rspress-mdx-emitter.md`
- **Snapshot tracking:** `snapshot-tracking-system.md`
- **Cross-linking:** `cross-linking-architecture.md`
- **Entry-point resolution and route collisions:** `multi-entry-resolution.md`
- **The `@tsdoctor/seo` seam stage 1 consumes:** `structured-data-and-og.md`
