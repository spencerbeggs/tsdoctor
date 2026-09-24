---
type: Limitation
title: No external-package cross-links
description: Types owned by an undocumented package never get cross-links, because the route map both linkers share is built only from the APIs a build generates.
bounds: ../modules/tsdoctor-pages.md
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: c5608cd0b080066bd9be463e1cb4f6045c8562a426dfc0f7372cbda59a7142fc
status: stable
---

# No external-package cross-links

## Trigger

A signature, member, or example block references a type owned by a package
this build is not itself documenting — `ZodType` from `zod`, `Effect` from
`effect`, or any symbol reachable only through an `import type` the model's
`TypeReferenceExtractor` classified as external.[^1] Both linkers — the prose
`CrossLinker` and `ShikiCrossLinker` — are constructed from one route map that
`prepareWorkItems` builds from the categorized, resolved items of the APIs in
this build; it carries no entry for anything outside that set.[^2]

## Symptom

The reference renders as plain text (prose) or plain highlighted code with no
`<a>` wrapper (code blocks). A sibling package documented in the same
multi-API build is fine — the route map is shared across all APIs in one
`prepareWorkItems` call — but a type from an undocumented dependency never
gets a link, no matter how well-known the package.

## Why this is acceptable

The route map's only source of truth is "what did this build generate a page
for." Extending it to third-party symbols means inventing routes for pages
this build never produced — either fabricated URLs to a package's own docs
site (fragile, package-specific conventions) or no target at all (a link to
nowhere). Neither serves a reader better than plain text that is at least
honest about what it is.

## What a fix would take

A route source for external symbols — for example a per-package registry
mapping `packageName!symbolName` to a documentation URL, populated from
`package.json` `homepage` fields or a user-supplied config table — feeding
the same route map `prepareWorkItems` builds (`packages/pages/src/WorkItems.ts`).
Both linkers already consume routes generically, so the change is confined to
where the map is assembled, not to `CrossLinker` or `ShikiCrossLinker`
themselves.

[^1]: packages/model/src/TypeReferenceExtractor.ts:74-84
[^2]: packages/pages/src/WorkItems.ts
