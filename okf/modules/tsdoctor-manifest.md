---
type: Module
title: "@tsdoctor/manifest"
description: "The tsdoctor.json sidecar manifest schema: spec, encode/decode boundaries and the ManifestSource authoring-file shape."
kind: package
layer: L1
resource: ../../packages/manifest
status: stable
tags: [architecture, compat]
sources:
  - id: src
    resource: ../../packages/manifest/src
    last_modified: 2026-09-13T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 2f97c1b9b61b01878c1ac5064ea0100e1962cd4fc4fce6265aa3e8d9cae59b9f
---

# @tsdoctor/manifest

## Boundary and purpose

`@tsdoctor/manifest` is the schema for the `tsdoctor.json` sidecar
manifest — display identity, Open Graph metadata, an SBOM pointer and
registry links — and nothing else. It depends on `effect` alone, so a
build tool that only needs to *write* the file through
`encodeBundleManifest` never drags in the fetch/cache/discovery stack a
reader like `@tsdoctor/bundle` needs, and a reader that only needs to
*decode* the file through `decodeBundleManifest` never drags in a writer's
concerns either.[^src] `@tsdoctor/bundle` re-exports every name this
package exports; consumers inside this monorepo import from
`@tsdoctor/bundle`, and only writers (a build tool emitting the file)
import this package directly.

## Layer cake

No workspace dependency at all — its only dependency is `effect`. It sits
below `@tsdoctor/bundle` in the layer cake for the same reason
`@tsdoctor/vfs` sits below `@tsdoctor/registry`: a package that needs the
schema without the rest of a heavier sibling's peer stack gets one. The
one known writer outside this repository is a bundler's build-time meta
pass, which decodes/encodes through this package's boundary functions
without depending on bundle discovery, resolution or fetching at all.

## Public surface

All exported from `src/index.ts`:[^src]

- `BundleManifest`, `MANIFEST_SPEC`, `TSDOCTOR_MANIFEST_FILENAME`,
  `decodeBundleManifest`, `encodeBundleManifest`, `BundleManifestError` —
  `src/BundleManifest.ts`. The manifest schema and its typed decode/encode
  boundary.
- `OpenGraphConfig`, `OpenGraphImage`, `ProjectIdentity`, `RegistryRef`,
  `SbomRef` — `src/BundleManifest.ts`, the manifest's component schemas.
- `KNOWN_REGISTRY_TYPES`, `KnownRegistryType`, `isKnownRegistryType` —
  `src/BundleManifest.ts`. `KNOWN_REGISTRY_TYPES` is `["npm", "jsr"] as
  const`; a registry `type` value is deliberately **not** constrained to
  this list at the schema level — an unrecognized value still decodes and
  is expected to degrade to link-only rendering, checked at read time via
  `isKnownRegistryType` rather than rejected at decode time.
- `ManifestSource`, `decodeManifestSource` — `src/ManifestSource.ts`.

## Invariants

- `spec` is `1` and the only field `BundleManifest` requires. Additive
  fields are minor revisions to the schema.
- Every enum-shaped field (`registries[].type`, an SBOM format) degrades
  on an unrecognized value rather than failing decode — see
  `isKnownRegistryType`'s doc comment: "never a validation failure."
- `ManifestSource` (`src/ManifestSource.ts`) is `BundleManifest` minus
  `spec` and `project` — the shape an author checks in at a package root
  (leaf tier) or a workspace root (project tier). A source file never
  declares its own spec version or its inherited tier; a writer supplies
  both when it flattens the tier hierarchy into the emitted
  `tsdoctor.json`. `ManifestSource` is decoded only by writers; a reader
  in this repository never sees this shape directly.
- This package depends on `effect` alone; do not add a workspace
  dependency here — that is what would defeat the split.

## Links

- [Decision: the manifest sits below the bundle package](../decisions/manifest-below-bundle.md)
- [Interface: the tsdoctor.json manifest contract](../interfaces/tsdoctor-json-manifest.md)

[^src]: `packages/manifest/src/index.ts`,
`packages/manifest/src/BundleManifest.ts`,
`packages/manifest/src/ManifestSource.ts`.
