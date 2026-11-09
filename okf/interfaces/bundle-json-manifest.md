---
type: Interface
title: bundle.json manifest
description: The spec-1 bundle.json sidecar manifest schema from @effected/manifest, its authoring shape, and who writes and reads it in this repository.
kind: config
resource: npm:@effected/manifest
tags: [compat, release]
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
sources:
  - id: manifest-src
    resource: npm:@effected/manifest
  - id: bundle-index
    resource: ../../packages/bundle/src/index.ts
  - id: bundle-discovery-src
    resource: ../../packages/bundle/src/BundleDiscovery.ts
  - id: bundle-resolver-src
    resource: ../../packages/bundle/src/BundleResolver.ts
  - id: root-manifest
    resource: ../../bundle.json
  - id: kitchensink-build
    resource: ../../modules/kitchensink/effected.toml
  - id: bundler-meta
    resource: npm:@effected/bundler
status: stable
integrity:
  generated:
    body: 480e8a5b18a75ed5
---

# bundle.json manifest

A `bundle.json` sidecar file, written beside a bundle's `<name>.api.json` /
`package.json` / `tsconfig.json` trio, is bundle layer 3: display identity,
Open Graph assets, an SBOM pointer and registry links. Its presence is
optional at every layer above 0 — a bundle with only the `.api.json` still
resolves, falling back to an inferred manifest carrying just the package
name.[^manifest-src] The schema ships from the kit package
`@effected/manifest`; `@tsdoctor/bundle` re-exports every name from it,
including `BUNDLE_MANIFEST_FILENAME` (`"bundle.json"`), and is the import
surface inside this repository.[^bundle-index]

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
- Absence of `bundle.json` is never an error — `BundleManifestError` is
  reserved for a manifest that exists on disk and fails to parse or decode.
  A missing sidecar is the ordinary case and reads as `Option.none()` by the
  reader, never surfaced as a failure.[^manifest-src] A leftover
  `tsdoctor.json` is not read at all.

## The two decode/encode boundaries

`decodeBundleManifest(input, path?)` and `encodeBundleManifest(manifest)`
are the only crossing points between an `unknown` JSON value and a typed
`BundleManifest`. A writer that serializes through `encodeBundleManifest`
rather than `JSON.stringify` produces a file that
`decodeBundleManifest` is, by construction, guaranteed to accept.[^manifest-src]

## The authoring shape: `ManifestSource`

A `bundle.json` an author checks in — at a package root (the leaf tier) or
a workspace root (the project tier) — is decoded as `ManifestSource`, not
`BundleManifest`. `ManifestSource` is `BundleManifest` minus `spec` and
`project`: a source file never declares its own spec version, and it never
declares the tier it will be inherited into — the bundler supplies both when
it flattens the tier hierarchy at emit time. `decodeManifestSource` is the
one function that reads this shape; ordinary readers of an emitted manifest
never see it.[^manifest-src] The root `bundle.json` in this repo is one
such source file — only `name` and `tagline`, no `spec`, no
`project`.[^root-manifest]

## Who writes it

`effected package build`'s meta pass (`@effected/bundler`) is the one
writer, composing three tiers per field — the `[package.bundle]` table in a
package's `effected.toml` (config, highest rank), a leaf `bundle.json`
beside that package's `package.json`, and a project `bundle.json` at the
workspace root — each source file decoded as `ManifestSource`; the project
tier is emitted nested under `project`, never flattened.[^bundler-meta] It
writes `dist/prod/npm/meta/bundle.json` and copies it, with `og/`, into
each `[package.build.meta].localPaths` directory.
`modules/kitchensink/effected.toml` is the live example: its
`[package.bundle]` table sets `name`, `tagline` and an
`openGraph.generate = "satori"` renderer.[^kitchensink-build] The bundler
never writes `sbom`; the release action upserts it at publish.

## Who reads it

`@tsdoctor/bundle`'s `loadBundle` (`BundleDiscovery.ts`) locates and decodes
the manifest, by `BUNDLE_MANIFEST_FILENAME`, for a given model directory,
pinning the model it was already handed rather than re-running candidate
selection.[^bundle-discovery-src] `resolveBundleFrom(bundle, platform?)`
(`BundleResolver.ts`) then ranks an optional platform-tier override (an
adapter's own data-override object) above whatever `bundle.json`
supplied, producing a `ResolvedBundle` whose every field carries its
`Provenanced` source.[^bundle-resolver-src]

## Posture

Presence-lenient, shape-strict: a field that is absent decodes to nothing
and degrades the consumer's rendering; a field that is present but does not
satisfy its schema fails the whole decode as a typed `BundleManifestError`
rather than silently dropping just that field.[^manifest-src]

## Planned but unscheduled

A versioned JSON Schema for this file, generated from `BundleManifest`
through `@effected/schemastore`, is recorded as follow-up work for
submission to SchemaStore. Now that the schema lives in
`@effected/manifest`, that work belongs with the kit rather than this
repository.

[^manifest-src]: `npm:@effected/manifest` (`BundleManifest.js`, `ManifestSource.js`)
[^bundle-index]: `packages/bundle/src/index.ts`
[^bundle-discovery-src]: `packages/bundle/src/BundleDiscovery.ts:335` (`loadBundle`)
[^bundle-resolver-src]: `packages/bundle/src/BundleResolver.ts:319` (`resolveBundleFrom`)
[^root-manifest]: `bundle.json` (repo root)
[^kitchensink-build]: `modules/kitchensink/effected.toml` (`[package.bundle]` table)
[^bundler-meta]: `npm:@effected/bundler` (`meta/bundle-manifest.js`, `composeBundleManifest`)

See also [tsdoctor-manifest module](../modules/tsdoctor-manifest.md),
[tsdoctor-bundle module](../modules/tsdoctor-bundle.md),
[the manifest schema decision](../decisions/manifest-schema-home.md) and the
[bundle glossary entry](../glossary/bundle.md).
