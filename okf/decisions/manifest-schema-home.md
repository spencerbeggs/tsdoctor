---
type: Decision
status: stable
title: The bundle manifest schema ships from @effected/manifest
description: "The spec-1 bundle.json schema lives in the kit package @effected/manifest; @tsdoctor/manifest is a deprecated re-export and @tsdoctor/bundle re-exports the kit's names."
supersedes: manifest-below-bundle.md
tags: [architecture, compat, deps]
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
sources:
  - id: kit-manifest
    resource: npm:@effected/manifest
  - id: manifest-shim
    resource: ../../packages/manifest/src/index.ts
  - id: bundle-index
    resource: ../../packages/bundle/src/index.ts
  - id: rspress-manifest
    resource: ../../platforms/rspress/package.json
  - id: bundler-meta
    resource: npm:@effected/bundler
verified:
  - by: human:spencer
    at: 2026-11-09T18:10:29Z
integrity:
  generated:
    body: 9993f80933da7df6
  verified:
    by: human:spencer
    at: 2026-11-09T18:10:29Z
    content: 8676e6bd5559879d
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
`tsdoctor.json` to `bundle.json` in the same move.

## Decision

The spec-1 schema — `BundleManifest`, `MANIFEST_SPEC`,
`BUNDLE_MANIFEST_FILENAME`, `encodeBundleManifest` /
`decodeBundleManifest`, `ManifestSource` / `decodeManifestSource` and the
component schemas — ships from `@effected/manifest`, whose only peer is
`effect`.[^kit-manifest] `@tsdoctor/bundle` depends on it and re-exports
every name, so readers inside this repository keep importing from
`@tsdoctor/bundle`.[^bundle-index] Both adapters list `@effected/manifest`
directly in `dependencies`.[^rspress-manifest] `@tsdoctor/manifest` stays
for one more release as a deprecated, thin re-export of
`@effected/manifest` so an existing import keeps working.[^manifest-shim]

## Alternatives rejected

- **Keep the schema in `@tsdoctor/manifest` and have the kit's bundler
  depend on it.** Rejected: the kit would depend on a downstream
  repository's package, inverting the `@effected`-is-the-foundation
  layering.
- **Delete `@tsdoctor/manifest` outright.** Rejected: it is published, and
  a deprecation release that re-exports the kit's names gives existing
  consumers a release to move their imports.

## Consequences

- Schema changes are made in the `effected` repository and reach this repo
  through the `catalog:effected` catalog, not through a workspace edit.
- Do not add new names to `@tsdoctor/manifest`; it only mirrors
  `@effected/manifest` until it is removed.
- The planned SchemaStore JSON Schema for `bundle.json` belongs with the
  kit package now, not with this repository.

See [the `bundle.json` manifest interface](../interfaces/bundle-json-manifest.md)
and [the `@tsdoctor/manifest` module](../modules/tsdoctor-manifest.md).

[^kit-manifest]: `npm:@effected/manifest`
[^bundle-index]: `packages/bundle/src/index.ts`
[^rspress-manifest]: `platforms/rspress/package.json`
[^manifest-shim]: `packages/manifest/src/index.ts`
[^bundler-meta]: `npm:@effected/bundler`
