---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-05-26
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/multi-entry-point-support.md
  - rspress-plugin-api-extractor/multi-entry-vfs.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/cross-linking-architecture.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
---

# Multi-entry resolution and route collisions

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Entry point resolution](#entry-point-resolution)
- [Route collisions](#route-collisions)
- [prepareWorkItems](#prepareworkitems)
- [What each adapter does with the data](#what-each-adapter-does-with-the-data)
- [The "Available from" block](#the-available-from-block)
- [Known limitations](#known-limitations)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

When a package exposes more than one entry point, the same API item is often re-exported from several. The pipeline deduplicates those re-exports into one page, records which entry points each item is available from and fails the build if two genuinely distinct items would write to the same route. Two pure `@tsdoctor/model` modules feed `@tsdoctor/pages`'s `prepareWorkItems`: `EntryPoints` and `Routes`.

## Current state

| Concern | Where it lives |
| --- | --- |
| `EntryPoints.resolve`, `ResolvedEntryItem` | `packages/model/src/EntryPoints.ts` |
| `RouteCandidate`, `detectCollisions`, `RouteCollisionError`, `sanitizeId` | `packages/model/src/Routes.ts` |
| `prepareWorkItems`, `WorkItem`, `crossLinkKindPriority` | `packages/pages/src/WorkItems.ts` |
| The RSPress reporting wrapper | `platforms/rspress/src/build-stages.ts` |
| The VitePress consumer | `platforms/vitepress/src/Generate.ts` |
| The `AvailableFrom` block | `packages/pages/src/Blocks.ts`, spelled by each adapter's emitter |
| Fixture | `modules/kitchensink/` (declares `./testing`) |

## Entry point resolution

`EntryPoints.resolve(apiPackage)` flattens the entry points into deduplicated `ResolvedEntryItem` records — the item, its canonical `definingEntryPoint` and every entry point it is `availableFrom`. Items are grouped by the identity key `displayName::kind`: the same key in several entry points is a re-export and collapses to one record, preferring the `"default"` entry as owner; the same `displayName` with a different `kind` (the Effect Schema companion pattern of a `const` and a type alias) stays separate, since the two route to different category folders. The main entry point (an empty `displayName` in the model) is normalized to `"default"`.

## Route collisions

A route is `{categoryFolder}/{sanitized lowercased name}`. Two distinct items resolving to the same route is a naming or category-config problem and fails the build. `Routes.detectCollisions` groups `RouteCandidate` records by route key and returns the groups with more than one distinct item, ordered deterministically; `Routes.RouteCollisionError` is a `Schema.TaggedError` whose message names each item, its kind and canonical reference, with guidance to rename or remap categories. Detection runs on the lowercased path so it catches what a case-insensitive filesystem would silently merge. There is no synthetic suffix, no `routeSuffix` and no entry-point segment — the outcomes are "distinct routes" or "build fails".

## prepareWorkItems

`prepareWorkItems` (`@tsdoctor/pages`) is pure and reports nothing: `uncategorized` items and route `collisions` come back as data on its result, and each adapter decides what to do with them. It resolves entry points, filters out synthetic base declarations (`SyntheticBases.detect`), categorizes items and extracts namespace members (`ApiItems.categorize` / `namespaceMembers`), builds route candidates and detects collisions, builds the cross-link routes and kinds maps (bare names owned by the highest-priority kind — `cross-linking-architecture.md`), computes `ApiItems.memberAnchors` for each class and interface and constructs the `WorkItem[]`, each carrying `availableFrom` plus `syntheticBase` and `memberAnchors` where they apply. See `WorkItems.ts` for the result and work item shapes.

`WorkItem` is generic in its category type: `WorkItemCategory` is the neutral `ApiItems.CategorySpec` plus display, singular and folder names, and each adapter instantiates it with its own config shape. The route and file path are always the plain lowercased `category/name` and the navigation label is the plain display name.

## What each adapter does with the data

- **RSPress** keeps a reporting wrapper of the same name in `build-stages.ts`: an `ItemSkipped` event per uncategorized item and a `RouteCollisionDetected` event per collision through the sync-island bridge, then `Routes.RouteCollisionError` thrown when any collision exists, so the fatal path reaches `issues.json` (`build-progress-and-issues.md`).
- **VitePress** calls the function directly, dies with a message naming each colliding route and reports the uncategorized items' names on its `GenerateResult`.

## The "Available from" block

`buildPage` pushes an `AvailableFrom` block (`packageName` plus `entryPoints`) when the work item's `availableFrom` lists more than one entry point; a single-entry item gets none. Each emitter spells the same paragraph — ``Available from: `package-name`, `package-name/testing` `` — with `"default"` mapped to the bare package name and named entries to subpath imports.

## Known limitations

- Detection is by final `folder/name` route: the same name in different folders is never a collision, and the same `displayName::kind` across entries is a re-export, never a collision.
- For packages where API Extractor does not natively emit multiple entry points, model merging or custom extraction is still required.

## Rationale

- **Why fail rather than disambiguate:** a silent suffix would make the route depend on iteration order and hide a naming problem the author should fix.
- **Why the pages function returns collisions as data:** the adapters report differently (events versus a die), and reporting inside the neutral step would pick one framework's vocabulary.
- **Why the block is IR:** both adapters must render the line identically, and a helper the emitters each call is two spellings waiting to drift.

## Related documentation

- **Overview linking both subsystems:** `multi-entry-point-support.md`
- **Per-entry `.d.ts` generation:** `multi-entry-vfs.md`
- **The pipeline that runs the step:** `page-generation-system.md`
- **`crossLinkKindPriority` and companion routing:** `cross-linking-architecture.md`
- **The `AvailableFrom` block and the emitters:** `doc-ir-and-pages.md`
