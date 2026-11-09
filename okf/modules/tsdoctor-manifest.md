---
type: Module
title: "@tsdoctor/manifest"
description: "Deprecated: a thin re-export of @effected/manifest, the kit package that now owns the bundle.json sidecar manifest schema."
kind: package
layer: L1
resource: ../../packages/manifest
status: deprecated
tags: [architecture, compat]
sources:
  - id: src
    resource: ../../packages/manifest/src/index.ts
  - id: pkg
    resource: ../../packages/manifest/package.json
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
integrity:
  generated:
    body: afea45836eec4850
---

# @tsdoctor/manifest

## Boundary and purpose

Deprecated. `@tsdoctor/manifest` is now a thin re-export of
`@effected/manifest`, the kit package that owns the spec-1 `bundle.json`
sidecar manifest schema — display identity, Open Graph metadata, an SBOM
pointer and registry links.[^src] Its only dependency is
`@effected/manifest` and its only peer `effect`.[^pkg] It exists so an
existing import keeps working for one more release; new code imports from
`@effected/manifest`, or, inside this monorepo, from `@tsdoctor/bundle`,
which re-exports the same names.

## Public surface

Every name re-exports `@effected/manifest` unchanged:[^src]
`BUNDLE_MANIFEST_FILENAME`, `BundleManifest`, `BundleManifestError`,
`MANIFEST_SPEC`, `decodeBundleManifest`, `encodeBundleManifest`,
`ManifestSource`, `decodeManifestSource`, `OpenGraphConfig`,
`OpenGraphImage`, `ProjectIdentity`, `RegistryRef`, `SbomRef`,
`KNOWN_REGISTRY_TYPES`, `KnownRegistryType` and `isKnownRegistryType`. The
schema's contract is documented on the interface concept below.

## Invariants

- Add nothing here. A schema change is made in `@effected/manifest` and
  arrives through the `catalog:effected` catalog.
- No workspace dependency: the package depends on `@effected/manifest`
  alone.

## Links

- [Decision: the manifest schema ships from `@effected/manifest`](../decisions/manifest-schema-home.md)
- [Decision (superseded): the manifest sits below the bundle package](../decisions/manifest-below-bundle.md)
- [Interface: the bundle.json manifest contract](../interfaces/bundle-json-manifest.md)

[^src]: `packages/manifest/src/index.ts`
[^pkg]: `packages/manifest/package.json`
