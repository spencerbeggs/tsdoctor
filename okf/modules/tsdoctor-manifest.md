---
type: Module
title: "@tsdoctor/manifest"
description: "Deleted: the former thin re-export of @effected/manifest; the workspace is gone and only its published versions remain on npm."
kind: package
resource: npm:@tsdoctor/manifest
status: deprecated
tags: [architecture, compat]
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-09T00:00:00Z
  - id: published
    resource: npm:@tsdoctor/manifest
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:33:27Z
integrity:
  generated:
    body: 47ebd42235b426ce
---

# @tsdoctor/manifest

## Boundary and purpose

Deleted. The `packages/manifest` workspace was removed outright on the
branch that moved every workspace to `effected package build`; nothing in
this repository provides `@tsdoctor/manifest` any more.[^owner] Before the
deletion it was a thin re-export of `@effected/manifest`, the kit package
that owns the spec-1 `bundle.json` sidecar manifest schema. Its last
published versions stay on npm for anyone still pinned to them, and
deprecating them there is a manual registry step.[^published]

This concept is kept, deprecated, so links to it resolve to an
explanation rather than to nothing.

## Where the names live now

- Inside this monorepo, import every manifest name from `@tsdoctor/bundle`,
  which re-exports `@effected/manifest` (its peer).
- Outside it, import from `@effected/manifest` directly.
- Both adapters list `@effected/manifest` in `dependencies`.

## Links

- [Decision: the manifest schema ships from `@effected/manifest`](../decisions/manifest-schema-home.md)
- [Decision (superseded): the manifest sits below the bundle package](../decisions/manifest-below-bundle.md)
- [Module: `@tsdoctor/bundle`](tsdoctor-bundle.md)
- [Interface: the bundle.json manifest contract](../interfaces/bundle-json-manifest.md)

[^owner]: conversation with the repository owner
[^published]: `npm:@tsdoctor/manifest`
