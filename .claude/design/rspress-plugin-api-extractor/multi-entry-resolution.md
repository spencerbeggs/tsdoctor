---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-05-26
updated: 2026-08-24
last-synced: 2026-08-24
completeness: 90
related:
  - rspress-plugin-api-extractor/multi-entry-point-support.md
  - rspress-plugin-api-extractor/multi-entry-vfs.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/cross-linking-architecture.md
dependencies: []
---

# Multi-Entry Resolution and Route Collisions

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
- `Routes.RouteCollisionError` — a `Schema.TaggedError` carrying `{ baseRoute, collisions }`; its message names each colliding item, its kind and canonical reference, plus guidance to rename the item or remap categories. `prepareWorkItems` throws it when `detectCollisions` returns anything.
- `Routes.sanitizeId(displayName, prefix?)` — the single route-side sanitizer (member anchors, route segments).

Detection runs on the **lowercased** path so it catches what a case-insensitive filesystem (macOS, Windows) would silently merge. There is no synthetic `-kind` suffix, no `routeSuffix` field and no entry-point segment — the only outcomes are "distinct routes" or "build fails".

The companion `const`+`type` pattern routes to `/variable/<name>` and `/type/<name>` respectively, so it is never a collision. A bare cross-link to the shared name resolves to the value page via `crossLinkKindPriority`; see `cross-linking-architecture.md`.

## Integration with prepareWorkItems

`prepareWorkItems` (`src/build-stages.ts`) drives the pipeline:

1. Call `EntryPoints.resolve` and build a lookup from `displayName::kind` to `ResolvedEntryItem`.
2. Filter out synthetic base declarations detected by `SyntheticBases.detect` (`@tsdoctor/model`) — unexported `Foo_base` items referenced by an exported class's extends clause get no page, no sidebar entry and no route candidate; see `page-generation-system.md`.
3. Categorize items and extract namespace members via `ApiItems.categorize` / `ApiItems.namespaceMembers` (`@tsdoctor/model`); `categorize` returns `{ items, uncategorized }` and the adapter emits an `ItemSkipped` event per uncategorized item.
4. Build `Routes.RouteCandidate[]` for all top-level items and namespace members, run `Routes.detectCollisions`, and throw `Routes.RouteCollisionError` on any collision.
5. Build the cross-link routes/kinds maps (lowercased paths, no suffix), with bare names owned by the highest-priority kind.
6. Construct `WorkItem[]`, attaching `availableFrom` from the resolved data (and `syntheticBase` on classes whose extends clause references a detected base).

```typescript
interface WorkItem {
  readonly item: ApiItem;
  readonly categoryKey: string;
  readonly categoryConfig: CategoryConfig;
  readonly namespaceMember?: ApiItems.NamespaceMember;
  /** Entry points this item is available from */
  readonly availableFrom?: string[];
  /** Unexported base declaration to inline on this class page */
  readonly syntheticBase?: ApiItem;
}
```

There is no `entryPointSegment` and no per-item collision flag on `WorkItem`. The route and file path are always the plain lowercased `category/name`, and the `_meta.json` navigation label is the plain display name.

## "Available from" rendering

Every page generator accepts an optional `availableFrom?: string[]` as a trailing argument of `generate()` (`ClassPageGenerator` takes one further trailing `syntheticBase?: ApiItem` — see `page-generation-system.md`). When it lists more than one entry point, `generateAvailableFrom()` (`src/markdown/helpers.ts`) renders a line:

```text
Available from: `package-name`, `package-name/testing`
```

The `"default"` entry maps to the bare package name; named entries become subpath imports. A single-entry item renders no line.

## Data flow

```text
ApiPackage (1+ entry points)
         |
EntryPoints.resolve()   [@tsdoctor/model]
  → deduplicate re-exports by displayName::kind
  → ResolvedEntryItem[] (availableFrom per item)
         |
prepareWorkItems()
  → filter out synthetic base declarations (SyntheticBases.detect)
  → categorize items + namespace members (ApiItems; ItemSkipped per
    uncategorized item)
  → build Routes.RouteCandidate[] → Routes.detectCollisions()
    (throws Routes.RouteCollisionError on collision)
  → build cross-link routes/kinds maps (lowercased, no suffix)
  → construct WorkItem[] with availableFrom
         |
Stream pipeline (buildPipelineForApi)
  → generateSinglePage dispatches to the page generator with availableFrom
  → route/file path = lowercased category/name
  → writeSingleFile: _meta.json label = plain display name
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
