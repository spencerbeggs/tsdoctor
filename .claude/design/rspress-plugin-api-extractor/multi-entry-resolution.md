---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-05-26
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/multi-entry-point-support.md
  - rspress-plugin-api-extractor/multi-entry-vfs.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/cross-linking-architecture.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
dependencies: []
---

# Multi-Entry Resolution and Route Collisions

## Table of Contents

- [Overview](#overview)
- [EntryPoints resolution](#entrypoints-resolution)
- [Route collisions](#route-collisions)
- [Integration with prepareWorkItems](#integration-with-prepareworkitems)
- ["Available from" rendering](#available-from-rendering)
- [Data flow](#data-flow)
- [Test fixture](#test-fixture)
- [Known limitations](#known-limitations)
- [Related documentation](#related-documentation)

## Overview

When a package exposes more than one entry point (e.g. `.` and `./testing`), the same API item is often re-exported from several of them. The doc generation pipeline must deduplicate these re-exports into a single page, record which entry points each item is available from, and fail the build if two genuinely distinct items would write to the same output route. This is handled by two pure `@tsdoctor/model` modules feeding `prepareWorkItems`: `EntryPoints` (`packages/model/src/EntryPoints.ts`) and `Routes` (`packages/model/src/Routes.ts`) — the former plugin files `multi-entry-resolver.ts` and `route-collisions.ts`, migrated into the model package (under those new module names) in the phase-2 redesign.

For VFS `.d.ts` generation per entry point, see `multi-entry-vfs.md`.

## EntryPoints resolution

`EntryPoints.resolve(apiPackage)` (`packages/model/src/EntryPoints.ts`) is a pure function that flattens one or more `ApiEntryPoint` instances into deduplicated `ResolvedEntryItem` records:

```typescript
interface ResolvedEntryItem {
  readonly item: ApiItem;
  /** Which entry point defines this item (canonical owner) */
  readonly definingEntryPoint: string;
  /** All entry points that export this item (includes re-exports) */
  readonly availableFrom: string[];
}
```

Resolution groups members by the identity key `displayName::kind`:

- Items with the same key in multiple entry points are re-exports. They collapse to a single record, preferring the `"default"` entry point as the canonical owner; `availableFrom` lists every entry point that exports the item.
- Items that share a `displayName` but differ in `kind` (the Effect Schema companion pattern of a `const Variable` and a `TypeAlias`) are kept as separate records. They route to different category folders so they never collide.

The main entry point (empty `displayName` in the API model) is normalized to the string `"default"`.

## Route collisions

A route is `${categoryFolder}/${sanitized-lowercased-name}`. Two distinct items resolving to the same route is a user naming or category-config problem and fails the build immediately. `packages/model/src/Routes.ts` provides the pure surface:

- `Routes.RouteCandidate` — a `Schema.Class` record for each candidate route (identity, display name, folder, lowercased base name, kind, canonical reference).
- `Routes.detectCollisions(candidates)` — groups `RouteCandidate[]` by route key and returns the groups with more than one distinct item, ordered deterministically.
- `Routes.RouteCollisionError` — a `Schema.TaggedError` carrying `{ baseRoute, collisions }`; its message names each colliding item, its kind and canonical reference, plus guidance to rename the item or remap categories. The RSPress adapter's `prepareWorkItems` wrapper throws it when the `@tsdoctor/pages` step returns any collision (see below).
- `Routes.sanitizeId(displayName, prefix?)` — the single route-side sanitizer (member anchors, route segments).

Detection runs on the **lowercased** path so it catches what a case-insensitive filesystem (macOS, Windows) would silently merge. There is no synthetic `-kind` suffix, no `routeSuffix` field and no entry-point segment — the only outcomes are "distinct routes" or "build fails".

The companion `const`+`type` pattern routes to `/variable/<name>` and `/type/<name>` respectively, so it is never a collision. A bare cross-link to the shared name resolves to the value page via `crossLinkKindPriority`; see `cross-linking-architecture.md`.

## Integration with prepareWorkItems

Since phase 5 the per-API step from a loaded model to work items is `prepareWorkItems` in **`@tsdoctor/pages`** (`packages/pages/src/WorkItems.ts`), lifted out of the RSPress adapter once the VitePress adapter needed the same computation (`doc-ir-and-pages.md`). It is pure and reports nothing: `uncategorized` items and route `collisions` come back as DATA in its result, and each adapter decides what to do with them. The steps:

1. Call `EntryPoints.resolve` and build a lookup from `displayName::kind` to `ResolvedEntryItem`.
2. Filter out synthetic base declarations detected by `SyntheticBases.detect` (`@tsdoctor/model`) — unexported `Foo_base` items referenced by an exported class's extends clause get no page, no sidebar entry and no route candidate; see `page-generation-system.md`.
3. Categorize items and extract namespace members via `ApiItems.categorize` / `ApiItems.namespaceMembers` (`@tsdoctor/model`); `categorize` returns `{ items, uncategorized }` and the uncategorized items are passed through to the result.
4. Build `Routes.RouteCandidate[]` for all top-level items and namespace members and run `Routes.detectCollisions`; the collisions are returned on the result, not thrown.
5. Build the cross-link routes/kinds maps (lowercased paths, no suffix), with bare names owned by the highest-priority kind.
6. Compute `ApiItems.memberAnchors(item)` for each class and interface, so the cross-link route map's `#fragment` and the page's `id=` come from one computation (see `cross-linking-architecture.md`).
7. Construct `WorkItem[]`, attaching `availableFrom` from the resolved data (plus `syntheticBase` on classes whose extends clause references a detected base, and `memberAnchors` on classes and interfaces).

```typescript
interface PrepareWorkItemsResult<C extends WorkItemCategory = WorkItemCategory> {
  readonly workItems: WorkItem<C>[];
  readonly crossLinkData: CrossLinkData;          // { routes, kinds }
  readonly uncategorized: ReadonlyArray<ApiItem>;
  readonly collisions: ReadonlyArray<Routes.RouteCollision>;
}

interface WorkItem<C extends WorkItemCategory = WorkItemCategory> {
  readonly item: ApiItem;
  readonly categoryKey: string;
  readonly categoryConfig: C;
  readonly namespaceMember?: ApiItems.NamespaceMember;
  /** Entry points this item is available from */
  readonly availableFrom?: string[];
  /** Unexported base declaration to inline on this class page */
  readonly syntheticBase?: ApiItem;
  /** Anchor id per member, keyed by canonical reference (classes/interfaces) */
  readonly memberAnchors?: ReadonlyMap<string, string>;
}
```

`WorkItem` is generic in its category type: `WorkItemCategory` is the neutral `ApiItems.CategorySpec` plus `displayName` / `singularName` / `folderName`, and each adapter instantiates it with its own config shape (the RSPress adapter's `WorkItem` is `WorkItem<CategoryConfig>`).

There is no `entryPointSegment` and no per-item collision flag on `WorkItem`. The route and file path are always the plain lowercased `category/name`, and the navigation label is the plain display name.

### What each adapter does with the data

- **RSPress** (`platforms/rspress/src/build-stages.ts`) keeps a reporting wrapper of the same name, `prepareWorkItems`, over the package function. It emits an `ItemSkipped` event per uncategorized item and a `RouteCollisionDetected` event per collision through the sync-island bridge, then throws `Routes.RouteCollisionError` when any collision exists — so the fatal path still reaches `issues.json` (`build-progress-and-issues.md`).
- **VitePress** (`platforms/vitepress/src/Generate.ts`) calls the package function directly, dies (`Effect.die`) with a message naming each colliding route and its items, and reports the uncategorized items' display names on its `GenerateResult.uncategorized`.

## "Available from" rendering

The line is a block in the page IR, not a helper. `buildPage` (`packages/pages/src/Build.ts`) pushes an `AvailableFrom` block (`Blocks.ts`; `kind: "available-from"`, carrying `packageName` and `entryPoints`) when the work item's `availableFrom` lists more than one entry point; a single-entry item gets no block. Each emitter spells it — the RSPress MDX emitter (`src/emit/mdx.ts`) and the VitePress markdown emitter (`src/emit/markdown.ts`) both render the same paragraph:

```text
Available from: `package-name`, `package-name/testing`
```

The `"default"` entry maps to the bare package name; named entries become subpath imports. The former `generateAvailableFrom()` helper and the page generators' trailing `availableFrom` parameter are gone with the generators (phase 5).

## Data flow

```text
ApiPackage (1+ entry points)
         |
EntryPoints.resolve()   [@tsdoctor/model]
  → deduplicate re-exports by displayName::kind
  → ResolvedEntryItem[] (availableFrom per item)
         |
prepareWorkItems()   [@tsdoctor/pages, WorkItems.ts]
  → filter out synthetic base declarations (SyntheticBases.detect)
  → categorize items + namespace members (ApiItems)
  → build Routes.RouteCandidate[] → Routes.detectCollisions()
  → build cross-link routes/kinds maps (lowercased, no suffix), with member
    anchors and keys from ApiItems.memberAnchors / memberRouteKeys
  → construct WorkItem[] with availableFrom + memberAnchors
  → return { workItems, crossLinkData, uncategorized, collisions }
         |
adapter reporting
  → RSPress: ItemSkipped per uncategorized item, RouteCollisionDetected
    per collision, then throw Routes.RouteCollisionError
  → VitePress: die on any collision; report uncategorized names
         |
buildPage()   [@tsdoctor/pages, Build.ts]
  → AvailableFrom block when availableFrom lists > 1 entry point
  → route = lowercased category/name
         |
emitter   [adapter: rspress src/emit/mdx.ts | vitepress src/emit/markdown.ts]
  → "Available from: `pkg`, `pkg/entry`" paragraph
  → nav label = plain display name
```

## Test fixture

The `modules/kitchensink/` module declares a `./testing` entry point (`src/testing.ts`) in its `package.json` exports, producing a real multi-entry `.api.json` model that exercises deduplication, collision detection and "Available from" rendering end-to-end.

## Known limitations

- **Collision scope** — detection is by final `folder/name` route. Same name in different folders is never a collision; same `displayName::kind` across entries is a re-export, not a collision.
- **API Extractor coverage** — for packages where API Extractor does not natively emit multiple entry points, model merging or custom extraction is still required.

## Related documentation

- **Multi-Entry Point Support:** `multi-entry-point-support.md` — overview linking the resolution and VFS subsystems
- **Multi-Entry VFS:** `multi-entry-vfs.md` — per-entry `.d.ts` generation
- **Page Generation System:** `page-generation-system.md` — Stream pipeline consuming work items
- **Cross-Linking Architecture:** `cross-linking-architecture.md` — `crossLinkKindPriority` and companion routing
- **Doc IR and `@tsdoctor/pages`:** `doc-ir-and-pages.md` — the `prepareWorkItems` lift, the `AvailableFrom` block and the emitters
