---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-08-24
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 88
related:
  - rspress-plugin-api-extractor/configuration-system.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
---

# Bundle spec

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [The layered resolution ladder](#the-layered-resolution-ladder)
- [The sidecar manifest](#the-sidecar-manifest)
- [Tier model and override ranking](#tier-model-and-override-ranking)
- [Provenance and change detection](#provenance-and-change-detection)
- [Discovery](#discovery)
- [Fetchers](#fetchers)
- [Reserved for consumers](#reserved-for-consumers)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

`@tsdoctor/bundle` (`packages/bundle`) formalizes the bundle: the folder or tarball of files describing one documented package — the fundamental input contract, "give us an api.json and we transform it into static docs". The package owns the bundle schema, the layered resolution ladder, the versioned sidecar manifest (`tsdoctor.json`), a provenance-carrying resolver and three fetchers (local directory, npm tarball, GitHub release).

## Current state

| Concern | Where it lives |
| --- | --- |
| Layer reading, `TSDOCTOR_MANIFEST_FILENAME`, `readBundle`, `readApiModelInfo` | `packages/bundle/src/Bundle.ts` |
| `discoverBundle` / `discoverBundles`, `loadBundle` / `loadBundles` | `packages/bundle/src/BundleDiscovery.ts` |
| `BundleManifest` and the OG / SBOM / registry schemas | `packages/bundle/src/BundleManifest.ts` |
| `resolveBundle`, `ResolvedBundle`, `Provenanced`, `ProvenanceSource` | `packages/bundle/src/BundleResolver.ts` |
| `PlatformOverrides` | `packages/bundle/src/PlatformOverrides.ts` |
| Layer hashing and field fingerprints | `packages/bundle/src/BundleHash.ts` |
| `fetchNpmBundle`, `fetchGitHubReleaseBundle` | `packages/bundle/src/BundleFetch.ts` |

What the adapters consume today is discovery: the RSPress config helpers delegate to `discoverBundle` (`configuration-system.md`) and the VitePress adapter calls it directly. The resolver, provenance, platform overrides and fingerprints are implemented and tested in the package but have no adapter consumer yet, and `@savvy-web/bundler` does not emit `tsdoctor.json`, so its absence is the normal case and everything resolves from layers 0–2 exactly as before. The live example of a bundle is the model folder kitchensink's `meta.localPaths` populates under `sites/basic/lib/models/kitchensink/`.

## The layered resolution ladder

A bundle is one required file plus optional overlays. Each layer enriches, never gates — a bundle containing only layer 0 still renders:

| Layer | File | Supplies |
| --- | --- | --- |
| 0 | `<name>.api.json` (required) | package name, entry points, the API itself |
| 1 | `package.json` | version, description, author and contributors, repository, license, the dependencies `@tsdoctor/registry` loads for the rendering scope |
| 2 | `tsconfig.json` | compiler options for the Twoslash environment |
| 3 | `tsdoctor.json` | the versioned sidecar manifest: display identity, Open Graph, SBOM pointer, registries |

## The sidecar manifest

The manifest is a sidecar `tsdoctor.json`, not a field in `package.json`: display, OG, SBOM and registry metadata have no legitimate npm-manifest home, the spec version must move independently of npm's and non-npm inputs (a GitHub release asset) may have no meaningful `package.json` at all. It carries an integer `spec` field — the only required one — plus optional `name`, `tagline`, `description`, a nested `project` identity block, `openGraph` (images with path-or-url, MIME, dimensions, alt; a theme color), an `sbom` pointer and `registries` (each with a protocol-family `type`, a human `name` and a `url`). Additive fields are minor revisions, and unknown enum values degrade gracefully rather than being rejected — a registry type a reader does not know still renders as a link. See `BundleManifest.ts` for the schema.

The bundler resolves the authoring-time filesystem hierarchy (project manifest → leaf) at emit time so the emitted file is self-contained — a fetched bundle has no parent directory to walk — while keeping the tiers structurally distinguishable (leaf fields top-level, project identity nested) because provenance is load-bearing. There is no `extends` in emitted manifests.

## Tier model and override ranking

Manifest data resolves across tiers, highest first: `manifest.platform` (a data-override object passed through plugin options, so a user with only an api.json can declare identity declaratively), `manifest.leaf` (the package's own `tsdoctor.json`), `manifest.project` (the monorepo project tier), then the derived band — `packageJson`, `tsconfig` and `apiModel` — and finally `inferred` (documented inference rules such as OG alt text).

One deliberate exception: `name` resolves platform → leaf → packageJson → apiModel with the project tier excluded, because the uniform ladder would title every package in a monorepo with the project's name. `tagline` resolves platform → leaf → project, and the project identity is exposed whole as `resolved.project` for site-level uses such as `og:site_name`.

## Provenance and change detection

The resolver produces a `ResolvedBundle` where every field is `Provenanced<A>` — a value plus its `ProvenanceSource`. Override detection is therefore mechanical: a field is user-overridden iff its source outranks the derivation that would otherwise supply it, an `inferred` field tracks upstream changes and an authored field is pinned.

`BundleHash.ts` supplies the two levels of a change-detection diff: coarse per-layer file hashes (canonical-normalize then SHA-256, through `@effected/jsonc`'s `JsoncFingerprint` — the same discipline as the snapshot system's `hashFrontmatter`) and fine per-field fingerprints of the `ResolvedBundle`, hashing the `{ value, source }` pair so an override flip that leaves the value unchanged is still visible. The intent is input-hashing at field granularity so a changed field invalidates only the surfaces it feeds (a version change touches version-embedding surfaces; a tsconfig change touches every code block), complementing the snapshot system's output hashing. Persisting the fingerprints beside the page snapshots — as a second migration in the `@tsdoctor/snapshot` store, so a build-end commit upserts both in one transaction — is designed but not built; the store has only its first migration (`snapshot-tracking-system.md`).

## Discovery

Discovery requires only layer 0: a folder containing just the `<name>.api.json` is a bundle, with the name falling back to the model's own name field. The other semantics the RSPress helpers had before delegating are preserved — multi-model disambiguation, unscoped-name preference, caller overrides win, strict parent scan and the empty-parent error. `discoverBundles` takes no shared per-bundle overrides; adapter-level defaulting stays in the adapter, as does the RSPress helpers' stricter `package.json` requirement. The discovery-time name and version pair is read through `@effected/package-json`'s `LenientManifest`, so malformed JSON still fails typed while a malformed individual field degrades to absence.

## Fetchers

Three inputs: a local directory, an npm tarball (`fetchNpmBundle`) and a GitHub release asset (`fetchGitHubReleaseBundle`). Fetched artifacts are cached through `@effected/store`'s `Cache` plus `@effected/xdg` under the shared `"tsdoctor"` namespace — a file plane under the XDG cache dir and a metadata plane of cache records, with self-healing hit checks (a hit requires the record and every file it lists to exist). Release assets unpack to a `meta/` root rather than npm's `package/`, so the fetcher probes `package/`, then the archive root, then each subdirectory for a `*.api.json`. GitHub release assets carry no integrity metadata, so that path is integrity-unverified and public-repo only; the npm path is verified through `@effected/npm`'s tarball handling.

## Reserved for consumers

The manifest reserves shape for concerns no adapter consumes yet: Open Graph image assets and their publication (the head-tag derivation itself lives in `@tsdoctor/seo`, `structured-data-and-og.md`), SBOM surfacing and registry badges. Reserving them now lets `@savvy-web/bundler` start emitting whenever it grows the option, without a spec revision.

## Rationale

- **Why enrich-never-gate layering:** the contract is "give us an api.json"; requiring anything beyond layer 0 would break the cheapest onboarding path and every existing bundle.
- **Why flatten at emit but keep tier structure:** self-containment is required for fetched bundles, but collapsing tiers would destroy the provenance that makes override detection and fine-grained invalidation mechanical.
- **Why provenance is load-bearing:** without per-field sources, "did the user override this or did we derive it?" needs heuristics; with them it is a rank comparison.
- **Why input hashing complements output hashing:** output hashes can only skip the write; input hashes at field granularity can skip the generation.

## Related documentation

- **The RSPress helpers that delegate to discovery:** `configuration-system.md`
- **The store the fingerprints would persist into:** `snapshot-tracking-system.md`
- **The registry that loads the layer-1 dependencies:** `type-loading-vfs.md`
- **Where OG derivation lives:** `structured-data-and-og.md`
- **The `@effected` dependency map:** `tsdoctor-package-architecture.md`
