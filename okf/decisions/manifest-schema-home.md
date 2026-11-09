---
type: Decision
status: stable
title: The bundle manifest schema ships from @effected/manifest
description: "The spec-1 bundle.json schema lives in the kit package @effected/manifest; @tsdoctor/bundle re-exports the kit's names and the @tsdoctor/manifest workspace is deleted."
supersedes: manifest-below-bundle.md
tags: [architecture, compat, deps]
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:33:27Z
sources:
  - id: kit-manifest
    resource: npm:@effected/manifest
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-09T00:00:00Z
  - id: published-shim
    resource: npm:@tsdoctor/manifest
  - id: bundle-index
    resource: ../../packages/bundle/src/index.ts
  - id: rspress-manifest
    resource: ../../platforms/rspress/package.json
  - id: bundler-meta
    resource: npm:@effected/bundler
verified:
  - by: human:spencer
    at: 2026-11-09T18:10:29Z
  - by: human:spencer
    at: 2026-11-09T18:52:17Z
integrity:
  generated:
    body: 650f65becb6b0e24
  verified:
    by: human:spencer
    at: 2026-11-09T18:52:17Z
    content: 3b44f19f00065e37
---

# The bundle manifest schema ships from `@effected/manifest`

## Context

The sidecar manifest's writer moved from `@savvy-web/bundler` to
`effected package build`, whose meta pass lives in `@effected/bundler`
inside the `@effected` kit.[^bundler-meta] A kit package cannot depend on a
`@tsdoctor/*` package to reach the schema, so the schema had to move to the
kit for the writer to keep encoding through the same boundary the readers
decode through. The superseded decision's reason — a writer needs the
schema without the bundle package's fetch, cache and discovery stack —
still holds; the kit package now satisfies it. The file was renamed from
`tsdoctor.json` to `bundle.json` in the same move. A first cut kept
`@tsdoctor/manifest` as a deprecated re-export for one release; the owner
then had the workspace deleted outright on the same branch.[^owner]

## Decision

The spec-1 schema — `BundleManifest`, `MANIFEST_SPEC`,
`BUNDLE_MANIFEST_FILENAME`, `encodeBundleManifest` /
`decodeBundleManifest`, `ManifestSource` / `decodeManifestSource` and the
component schemas — ships from `@effected/manifest`, whose only peer is
`effect`.[^kit-manifest] `@tsdoctor/bundle` depends on it and re-exports
every name, so readers inside this repository keep importing from
`@tsdoctor/bundle`.[^bundle-index] Both adapters list `@effected/manifest`
directly in `dependencies`.[^rspress-manifest] The `packages/manifest`
workspace is deleted: nothing in this repository provides
`@tsdoctor/manifest` any more, and its already-published versions stay on
npm for existing pins.[^published-shim]

## Alternatives rejected

- **Keep the schema in `@tsdoctor/manifest` and have the kit's bundler
  depend on it.** Rejected: the kit would depend on a downstream
  repository's package, inverting the `@effected`-is-the-foundation
  layering.
- **Keep `@tsdoctor/manifest` for one more release as a deprecated
  re-export of `@effected/manifest`.** Rejected: the repository conforms to
  the kit package directly, and the published versions already on npm keep
  resolving for anyone still pinned to them.[^owner]

## Consequences

- Schema changes are made in the `effected` repository and reach this repo
  through the `catalog:effected` catalog, not through a workspace edit.
- Do not reintroduce a `@tsdoctor/manifest` workspace or a local copy of
  the schema; import the names from `@tsdoctor/bundle` inside this
  repository, or from `@effected/manifest` outside it.
- Deprecating the published `@tsdoctor/manifest` versions on npm is a
  manual registry step, outside the repository.
- The planned SchemaStore JSON Schema for `bundle.json` belongs with the
  kit package now, not with this repository.

See [the `bundle.json` manifest interface](../interfaces/bundle-json-manifest.md)
and [the deleted `@tsdoctor/manifest` module](../modules/tsdoctor-manifest.md).

[^kit-manifest]: `npm:@effected/manifest`
[^bundle-index]: `packages/bundle/src/index.ts`
[^rspress-manifest]: `platforms/rspress/package.json`
[^owner]: conversation with the repository owner
[^published-shim]: `npm:@tsdoctor/manifest`
[^bundler-meta]: `npm:@effected/bundler`
