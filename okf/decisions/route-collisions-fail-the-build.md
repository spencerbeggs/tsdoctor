---
type: Decision
status: draft
title: A route collision fails the build, never a synthetic suffix
description: Two distinct items resolving to the same lowercased route stop the build; there is no auto-disambiguation.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: dc4b4e120b09624c2fc4c1875dabe02e195dea4e1b251ec60df327cf74be60b5
---

# A route collision fails the build, never a synthetic suffix

## Context

A generated route is `{categoryFolder}/{sanitized lowercased name}`. Two
distinct API items can resolve to the same route — a naming collision within
a category, or two names that only differ by case, which a case-insensitive
filesystem would silently merge into one file.

## Decision

`Routes.detectCollisions`[^1] groups route candidates by their lowercased
route key and returns every group with more than one distinct item.
Detection runs on the lowercased path specifically so it catches what a
case-insensitive filesystem would otherwise merge without complaint.
`Routes.RouteCollisionError`[^1] is a typed error whose message names each
colliding item, its kind, and its canonical reference, with guidance to
rename the item or remap its category. There is no synthetic suffix, no
`routeSuffix` option, and no entry-point segment appended to break a tie —
the only two outcomes are "the routes are distinct" or "the build fails."

`prepareWorkItems`[^2] itself stays neutral: it returns `uncategorized` items
and `collisions` back to the caller as plain data rather than reporting them
itself, because the two adapters want to report differently. The RSPress
adapter's wrapper of the same name in `build-stages.ts`[^3] emits an
`ItemSkipped` event per uncategorized item and a `RouteCollisionDetected`
event per collision through the sync-island bridge, then throws
`Routes.RouteCollisionError` when any collision exists — so the fatal path
still reaches the `issues.json` artifact before the process exits. The
VitePress adapter calls `prepareWorkItems` directly and dies with a message
naming each colliding route.

## Alternatives rejected

- **Append a synthetic suffix to disambiguate colliding routes.** Rejected:
  the resulting route would depend on iteration order, which is not a
  property an author can predict or control, and it would hide a genuine
  naming or category-configuration problem the author needs to fix instead.
- **A `routeSuffix` or entry-point segment appended automatically.**
  Rejected for the same reason — automatic disambiguation converts an
  authoring mistake into a silently-accepted, order-dependent route.
- **Have `prepareWorkItems` itself report and throw.** Rejected because the
  two adapters need different reporting vocabularies (RSPress's event bus
  plus a thrown error vs. VitePress's direct die), and baking one adapter's
  vocabulary into the neutral computation would leak framework concerns into
  `@tsdoctor/pages`.

## Consequences

- A route collision is always an authoring-time failure to fix (rename the
  item, or remap category configuration), never a runtime ambiguity a reader
  might silently get routed around.
- Detection is scoped to the final `folder/name` route only: the same
  display name in two different category folders is never a collision, and
  the same `displayName::kind` appearing in several entry points is treated
  as a re-export, not a collision — both are accepted trade-offs of scoping
  collision detection to the route rather than the symbol identity.
- Any new adapter that consumes `prepareWorkItems` must decide its own
  collision-reporting posture; the function guarantees only that collisions
  come back as data, not that they are reported.

[^1]: [packages/model/src/Routes.ts](../../packages/model/src/Routes.ts) — `detectCollisions`, `RouteCollisionError`
[^2]: [packages/pages/src/WorkItems.ts](../../packages/pages/src/WorkItems.ts) — `prepareWorkItems`
[^3]: [platforms/rspress/src/build-stages.ts](../../platforms/rspress/src/build-stages.ts)
