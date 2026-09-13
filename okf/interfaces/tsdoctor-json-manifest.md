---
type: Interface
title: tsdoctor.json manifest
description: The spec-1 sidecar manifest schema, its authoring shape, and who writes and reads it.
kind: config
resource: ../../packages/manifest/src/BundleManifest.ts
tags: [compat, release]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: d38e2ab46c0df3d2fc83edcb77eee568fc2fc333ffb61adf4cbfd0e122f85a7c
sources:
  - id: manifest-src
    resource: ../../packages/manifest/src/BundleManifest.ts
  - id: manifest-source-src
    resource: ../../packages/manifest/src/ManifestSource.ts
  - id: bundle-discovery-src
    resource: ../../packages/bundle/src/BundleDiscovery.ts
  - id: bundle-resolver-src
    resource: ../../packages/bundle/src/BundleResolver.ts
  - id: root-manifest
    resource: ../../tsdoctor.json
  - id: kitchensink-build
    resource: ../../modules/kitchensink/savvy.build.ts
---

# tsdoctor.json manifest

A `tsdoctor.json` sidecar file, written beside a bundle's `<name>.api.json` /
`package.json` / `tsconfig.json` trio, is bundle layer 3: display identity,
Open Graph assets, an SBOM pointer and registry links. Its presence is
optional at every layer above 0 — a bundle with only the `.api.json` still
resolves, falling back to an inferred manifest carrying just the package
name.[^manifest-src]

## The contract a consumer can depend on

- `spec` is a `Schema.Literal(1)` and the **only** required field. This
  reader understands spec 1; a manifest with an unrecognized `spec` value
  fails to decode.[^manifest-src]
- Every other field is `Schema.optionalKey`: `name` (display name — the SEO
  string, distinct from the dry npm name), `tagline`, `description`
  (overrides `package.json`'s when present), `project` (a nested
  `{ name?, tagline? }` identity block flattened in by the writer, never by
  hand), `openGraph.images[]` (each an XOR of bundle-relative `path` or
  absolute `url`, plus optional `type`, `width`, `height`, `alt`),
  `openGraph.themeColor`, `sbom` (`{ path, format? }`) and
  `registries[]` (each `{ type, name, url }`).[^manifest-src]
- Additive top-level fields are minor spec revisions and are ignored on
  decode by an older reader. Enum-ish values that are not yet known —
  `registries[].type` beyond `"npm"` / `"jsr"`, `sbom.format` — decode
  successfully and degrade to link-only rendering rather than rejecting the
  manifest; `isKnownRegistryType` is the only supported way to branch on
  `type`.[^manifest-src]
- Absence of `tsdoctor.json` is never an error — `BundleManifestError` is
  reserved for a manifest that exists on disk and fails to parse or decode.
  A missing sidecar is the ordinary case and reads as `Option.none()` by the
  reader, never surfaced as a failure.[^manifest-src]

## The two decode/encode boundaries

`decodeBundleManifest(input, path?)` and `encodeBundleManifest(manifest)`
are the only crossing points between an `unknown` JSON value and a typed
`BundleManifest`. A writer that serializes through `encodeBundleManifest`
rather than `JSON.stringify` produces a file that
`decodeBundleManifest` is, by construction, guaranteed to accept.[^manifest-src]

## The authoring shape: `ManifestSource`

A `tsdoctor.json` an author checks in — at a package root (the leaf tier) or
a workspace root (the project tier) — is decoded as `ManifestSource`, not
`BundleManifest`. `ManifestSource` is `BundleManifest` minus `spec` and
`project`: a source file never declares its own spec version, and it never
declares the tier it will be inherited into — the bundler supplies both when
it flattens the tier hierarchy at emit time. `decodeManifestSource` is the
one function that reads this shape; ordinary readers of an emitted manifest
never see it.[^manifest-source-src] The root `tsdoctor.json` in this repo is
one such source file — only `name` and `tagline`, no `spec`, no
`project`.[^root-manifest]

## Who writes it

`@savvy-web/bundler`'s meta pass is the one writer, composing three tiers
per field — `meta.tsdoctor` in a package's `savvy.build.ts` (config, highest
rank), a leaf `tsdoctor.json` beside that package's `package.json`, and a
project `tsdoctor.json` at the workspace root — each source file decoded as
`ManifestSource`. `modules/kitchensink/savvy.build.ts` is the live example:
its `meta.tsdoctor` block sets `name`, `tagline` and an `openGraph.generate`
satori renderer.[^kitchensink-build] After the bundler, `silk-release-action`
upserts the `sbom` field into the emitted `meta/tsdoctor.json` — the bundler
itself never writes `sbom`.

## Who reads it

`@tsdoctor/bundle`'s `loadBundle` (`BundleDiscovery.ts`) locates and decodes
the manifest for a given model directory, pinning the model it was already
handed rather than re-running candidate selection.[^bundle-discovery-src]
`resolveBundleFrom(bundle, platform?)` (`BundleResolver.ts`) then ranks an
optional platform-tier override (an adapter's own data-override object)
above whatever `tsdoctor.json` supplied, producing a `ResolvedBundle` whose
every field carries its `Provenanced` source.[^bundle-resolver-src]

## Posture

Presence-lenient, shape-strict: a field that is absent decodes to nothing
and degrades the consumer's rendering; a field that is present but does not
satisfy its schema fails the whole decode as a typed `BundleManifestError`
rather than silently dropping just that field.[^manifest-src]

## Planned but unscheduled

A versioned JSON Schema for this file, generated from `BundleManifest`
through `@effected/schemastore` and emitted to the repo root under
`schemas/<version>/tsdoctor-<version>.json`, is recorded as follow-up work
for submission to SchemaStore. No script or schema file exists yet.

[^manifest-src]: `packages/manifest/src/BundleManifest.ts`
[^manifest-source-src]: `packages/manifest/src/ManifestSource.ts`
[^bundle-discovery-src]: `packages/bundle/src/BundleDiscovery.ts:335` (`loadBundle`)
[^bundle-resolver-src]: `packages/bundle/src/BundleResolver.ts:319` (`resolveBundleFrom`)
[^root-manifest]: `tsdoctor.json` (repo root)
[^kitchensink-build]: `modules/kitchensink/savvy.build.ts:17-22` (`meta.tsdoctor` block)

See also [tsdoctor-manifest module](../modules/tsdoctor-manifest.md),
[tsdoctor-bundle module](../modules/tsdoctor-bundle.md) and the
[bundle glossary entry](../glossary/bundle.md).
