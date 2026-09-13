---
type: Decision
status: draft
title: One anchor algorithm, never a second spelling
description: Routes.sanitizeId is the single spelling for every member anchor and cross-link key; anchors are computed once and carried as data.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 04e059000f1210bccbebf5cb43ccc82b05f35ba5638ba7aba61d7767803aec03
---

# One anchor algorithm, never a second spelling

## Context

A class or interface member's URL fragment (`#addTransport`) and the
cross-link key the prose linker and the code-block linker use to resolve
`Registry.create` to the right member must agree, or a cross-link and the
anchor it points at drift apart. Two independent computations of the same
fact — one to render the anchor, one to resolve the link — is exactly the
shape that drifts silently.

## Decision

`Routes.sanitizeId`[^1] is the only anchor-sanitization spelling in the
codebase: lowercase, spaces and underscores to hyphens, other specials
stripped. `Routes.memberAnchor` is a thin alias over it that names the
call-site intent; `Routes.memberAnchors(members)` computes the anchor for
every member of a class in one pass, keyed by the member's canonical
reference, so a collision (two members sanitizing to the same anchor) is
resolved once, consistently: the highest-priority slot (static method,
static property, instance method, getter, instance property — static
ranked first) keeps the bare anchor and the rest are prefixed. Because
TypeScript forbids two members sharing a name within the same static-ness,
a collision is always one static and one instance member, so only the
`instance-` prefix is ever actually emitted.

`Routes.memberRouteKeys(className, members)` decides which member a
qualified name (`Registry.create`) means: it resolves to the static member
when both exist, since that is the static access expression in TypeScript,
with `Registry.(create:static)` / `Registry.(create:instance)` TSDoc
selector keys emitted only when a collision exists — every extra key is one
more pattern the prose linker has to test against every string.
`Class#member` is deliberately never emitted as a key: `#` is the URL
fragment delimiter and also denotes a private field in modern TypeScript, so
using it as a selector would be ambiguous with both.

Anchors are computed once, in `prepareWorkItems`[^2] via
`ApiItems.memberAnchors`, and carried on the `WorkItem` as data rather than
recomputed by any downstream consumer — the page's `id=` attribute and the
route map's `#fragment` come from the identical map. The invariant is pinned
by a dedicated regression test[^3].

## Alternatives rejected

- **A page-side anchor sanitizer, independent of the route computation.**
  This was tried and reverted: a sanitizer that kept `_` and mapped `$`
  differently from `Routes.sanitizeId` made every member whose name
  contained those characters a dead cross-link, because the anchor the page
  rendered no longer matched the fragment the link pointed at.
- **Recompute the anchor at render time in each emitter.** Rejected because
  it reintroduces the exact two-computations-of-one-fact shape that caused
  the dead-link regression; the builder falls back to recomputing only for
  out-of-pipeline callers that never receive the precomputed map, not for
  the generation pipeline itself.

## Consequences

- Adding a second member-naming concern (for example a different anchor
  style for a future framework) is a change to `Routes.sanitizeId`'s single
  call site, not a new sanitizer — a divergent spelling has already broken
  cross-links once.
- Any adapter or emitter that needs a member anchor must read it off the
  work item's precomputed map; introducing a local anchor computation is a
  regression class this decision exists to forbid.
- `platforms/rspress/__test__/markdown/anchor-invariant.test.ts` is the pin
  that would fail first if the anchor and the page id ever diverged again.

[^1]: [packages/model/src/Routes.ts](../../packages/model/src/Routes.ts) — `sanitizeId`, `memberAnchor`, `memberAnchors`, `memberRouteKeys`
[^2]: [packages/pages/src/WorkItems.ts](../../packages/pages/src/WorkItems.ts) — `prepareWorkItems`
[^3]: [platforms/rspress/**test**/markdown/anchor-invariant.test.ts](../../platforms/rspress/__test__/markdown/anchor-invariant.test.ts)
