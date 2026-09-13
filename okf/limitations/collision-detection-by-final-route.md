---
type: Limitation
title: Route collision detection sees only the final folder/name key
description: Routes.detectCollisions groups by the lowercased folder/baseName route, so the same name in different category folders is never flagged and neither is a re-export sharing displayName::kind across entry points.
bounds: ../modules/tsdoctor-model.md
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 736cf28f5fd063db79273027f0c3c21a413deffe9c6ee3d43ef878ebd1ca8597
---

# Collision detection sees only the final route

## Trigger

Two API items would write to the same generated file: `Routes.detectCollisions`
groups `RouteCandidate` records by the key `${candidate.folder}/${candidate.baseName}`,
lowercased so a case-insensitive filesystem is caught too.[^1]

## Symptom

Two conditions never surface as a collision, both by design of the grouping
key:

- **Different category folders, same name.** An item named `Logger` in the
  `class` folder and a different item also named `Logger` in the `interface`
  folder produce distinct keys (`class/logger` vs `interface/logger`), so no
  `RouteCollisionError` fires even though a category-config change could
  later route both to the same folder and silently overwrite one page with
  the other.
- **Re-exports across entry points.** The same `displayName::kind` pair
  showing up from more than one entry point is treated as one re-exported
  item by `EntryPoints.resolve` before collision detection ever runs, so it
  is never a collision candidate — by design, since deduplicating re-exports
  is the whole point of that pass, but it means a package that legitimately
  wants two distinct doc pages for two entry points sharing a name has no
  way to express that.

Separately, a package where API Extractor does not natively emit multiple
entry points still requires manual model merging or custom extraction before
either detection path applies at all — `detectCollisions` and `EntryPoints`
both assume the `ApiPackage` already reflects every entry point correctly.

## Why this is acceptable

Detecting by final route is exactly what matters for the actual failure mode
— two distinct pages that would overwrite each other on disk — and nothing
more. Widening the key to include, say, item kind before categorization
would flag configurations that are correct today (two items with the same
display name in different categories are simply different pages) as errors
they are not.

## What a fix would take

A cross-folder name-collision warning (not a build failure) would need a
second, non-fatal pass over `RouteCandidate`s grouped by `baseName` alone,
run after category resolution but reported as an advisory rather than
`RouteCollisionError`, since it flags a configuration hazard, not an actual
route collision. Handling packages without native multi-entry-point model
support is a separate, larger feature: a model-merging step ahead of
`EntryPoints.resolve` that synthesizes the entry-point structure API
Extractor did not.

[^1]: packages/model/src/Routes.ts:57-67
