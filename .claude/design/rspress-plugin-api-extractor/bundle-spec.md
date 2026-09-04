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
- [Publishing Open Graph assets](#publishing-open-graph-assets)
- [Reserved for consumers](#reserved-for-consumers)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

`@tsdoctor/bundle` (`packages/bundle`) formalizes the bundle: the folder or tarball of files describing one documented package — the fundamental input contract, "give us an api.json and we transform it into static docs". The package owns the bundle schema (now `@tsdoctor/manifest`, re-exported here), the layered resolution ladder, a provenance-carrying resolver, an Open Graph asset publisher and three fetchers (local directory, npm tarball, GitHub release). The writer side — `@savvy-web/bundler`'s meta pass emitting `tsdoctor.json` — lives upstream in `savvy-web/systems` and is out of this repo, but both adapters now consume what it produces.

## Current state

| Concern | Where it lives |
| --- | --- |
| Layer reading, `TSDOCTOR_MANIFEST_FILENAME`, `readBundle`, `readApiModelInfo` | `packages/bundle/src/Bundle.ts` |
| `discoverBundle` / `discoverBundles`, `loadBundle` / `loadBundles` | `packages/bundle/src/BundleDiscovery.ts` |
| The manifest schema and encode/decode boundaries (moved) | `@tsdoctor/manifest` (`packages/manifest`), re-exported from `packages/bundle/src/index.ts` |
| `resolveBundle`, `ResolvedBundle`, `Provenanced`, `ProvenanceSource` | `packages/bundle/src/BundleResolver.ts` |
| `PlatformOverrides` | `packages/bundle/src/PlatformOverrides.ts` |
| Layer hashing and field fingerprints | `packages/bundle/src/BundleHash.ts` |
| `fetchNpmBundle`, `fetchGitHubReleaseBundle` | `packages/bundle/src/BundleFetch.ts` |
| `publishBundleAssets`, `PublishedOpenGraphImage`, `BundleAssetError` | `packages/bundle/src/BundleAssets.ts` |

Both adapters now resolve, not just discover: `ConfigService.resolve` (RSPress, `configuration-system.md`) and `Generate.ts` (VitePress, `vitepress-adapter.md`) call `loadBundle` then `resolveBundleFrom` and publish the resolved Open Graph images through `publishBundleAssets`. `@savvy-web/bundler`'s meta pass emits `meta/tsdoctor.json` when a package configures `meta.tsdoctor` or ships a `tsdoctor.json` source file or registries derive from `targets.json`; a bundle with none of those still has no layer 3 and resolves the same inferred floor as before. The live example is `modules/kitchensink`, whose `savvy.build.ts` carries a `meta.tsdoctor` block with a satori-generated Open Graph image, and whose `meta.localPaths` copies `tsdoctor.json` and `og/kitchensink.png` beside the api.json trio.

## The layered resolution ladder

A bundle is one required file plus optional overlays. Each layer enriches, never gates — a bundle containing only layer 0 still renders:

| Layer | File | Supplies |
| --- | --- | --- |
| 0 | `<name>.api.json` (required) | package name, entry points, the API itself |
| 1 | `package.json` | version, description, author and contributors, repository, license, the dependencies `@tsdoctor/registry` loads for the rendering scope |
| 2 | `tsconfig.json` | compiler options for the Twoslash environment |
| 3 | `tsdoctor.json` | the versioned sidecar manifest: display identity, Open Graph, SBOM pointer, registries |

## The sidecar manifest

The manifest is a sidecar `tsdoctor.json`, not a field in `package.json`: display, OG, SBOM and registry metadata have no legitimate npm-manifest home, the spec version must move independently of npm's and non-npm inputs (a GitHub release asset) may have no meaningful `package.json` at all. It carries an integer `spec` field — the only required one — plus optional `name`, `tagline`, `description`, a nested `project` identity block, `openGraph` (images with path-or-url, MIME, dimensions, alt; a theme color), an `sbom` pointer and `registries` (each with a protocol-family `type`, a human `name` and a `url`). Additive fields are minor revisions, and unknown enum values degrade gracefully rather than being rejected — a registry type a reader does not know still renders as a link. The schema now lives in `@tsdoctor/manifest` (`packages/manifest`, `effect` only) and is re-exported by `@tsdoctor/bundle`; see `tsdoctor-package-architecture.md` for why it moved.

**The writer.** `@savvy-web/bundler`'s meta pass (`savvy-web/systems`, `packages/tsdown-plugins/src/meta/`) is the one implementation of this file's authoring-time resolution. It composes three tiers per field — a `meta.tsdoctor` block in `savvy.build.ts` (config), a `tsdoctor.json` beside the package's `package.json` (leaf) and a `tsdoctor.json` at the workspace root (project) — both source files decoded as `ManifestSource` (`BundleManifest` minus `spec` and `project`, since a source file never declares its own spec version or its inherited tier). Config beats leaf beats project per field; the project tier is never flattened into the leaf fields, emitted nested as `project: { name, tagline }` exactly as this doc prescribes, so provenance survives into the resolver. `registries` derives from the build's `targets.json` for a non-private package when neither config nor leaf supplies one — a GitHub Packages target's page URL is derived from the emitted `repository` field and omitted, not fabricated, when that field does not parse to an `owner/repo`. `openGraph.generate(info)` can render an image at build time (a bundled `@savvy-web/bundler/og` exports a default `ogImage.satori()` renderer over optional `satori` / `@resvg/resvg-js` peers); the bytes are written to `meta/og/<unscoped>.<ext>`, sized from the bytes and prepended to `openGraph.images`, so a generated image always lists first. Nothing is written when no tier and no derived registries exist, and a monorepo root `package.json` without a `version` yields no project tier — `@effected/workspaces` discovery refuses to name a rootless workspace, a documented degradation rather than a build failure. `meta/tsdoctor.json` and `meta/og/` copy into every `localPaths` entry alongside the trio. The bundler never writes `sbom` — `silk-release-action` upserts `sbom: { path: "<unscoped>.sbom.json", format: "cyclonedx-json" }` into `meta/tsdoctor.json` after copying the SBOM into the release archive's `meta/`, so the fetched archive carries all four layers.

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

Both fetchers now persist a manifest's `openGraph.images[].path` entries as part of the cached bundle: each is copied under its own bundle-relative path (validated to stay inside the bundle — a path that escapes it fails typed `invalidRef`), so a resolved bundle-relative image reads from the cache the same way it would from a local directory. A declared asset missing from the archive fails typed `missingAsset` rather than silently resolving to a broken image.

## Publishing Open Graph assets

`publishBundleAssets` (`BundleAssets.ts`) turns a `ResolvedBundle`'s `openGraph.images` into `<head>`-ready URLs: every bundle-relative `path` image is copied from the bundle directory to `<publicDir>/tsdoctor/<unscopedName>/<basename>`, identical bytes are skipped so a rebuild does not touch the file, and every image — copied or already a `url` — comes back as a `PublishedOpenGraphImage` with an absolute (or, with an empty `siteUrl`, root-relative) URL. Width and height are read from the resolved image when the manifest declared them and measured from the file's bytes only when it did not — a declared dimension always wins over a measured one. It lives here rather than in the I/O-free `@tsdoctor/pages` because it needs a `FileSystem`, and here rather than in each adapter because both adapters need the identical copy-and-rewrite behavior (`structured-data-and-og.md`).

A manifest-declared `path` is checked against `isSafeAssetPath` (`internal/asset-path.ts`) before any filesystem read: no leading slash, no `.`/`..` segment, no `/` or `\` hiding inside a segment. A path that fails the check fails `BundleAssetError` naming the offending path, never reads the bundle directory. The predicate is the one both planes share — the fetcher's traversal check in `BundleFetch.ts` imports it rather than re-implementing it, so "does this path escape the bundle" has one answer regardless of which plane asks. The fetcher's own failure speaks fetch-plane vocabulary instead: a traversing path fails `BundleFetchError` with `reason: "invalidRef"`, and a path the manifest declares but the fetched archive does not contain fails `reason: "missingAsset"`.

`publishBundleAssets` also takes an optional `subdir`, inserted between `unscopedName` and the basename (`tsdoctor/<unscopedName>/<subdir>/<basename>`). Without it, two builds of the same package that both carry an `openGraph` image publish to the identical route and overwrite each other — differing bytes defeat the identical-bytes skip, and whichever build ran last wins for every consumer's pages. The RSPress adapter passes the version string as `subdir` for a `VersionConfig` entry, so a multi-version site's per-version images do not collide.

## Reserved for consumers

Open Graph images are wired end to end — generated or authored, published by both adapters, rendered by `@tsdoctor/seo` (`structured-data-and-og.md`). What the manifest still reserves shape for with no adapter consumer: SBOM surfacing and registry badges on generated pages. The data reaches the resolved bundle (`resolved.sbom`, `resolved.registries`); rendering it is a later product change.

## Rationale

- **Why enrich-never-gate layering:** the contract is "give us an api.json"; requiring anything beyond layer 0 would break the cheapest onboarding path and every existing bundle.
- **Why flatten at emit but keep tier structure:** self-containment is required for fetched bundles, but collapsing tiers would destroy the provenance that makes override detection and fine-grained invalidation mechanical.
- **Why provenance is load-bearing:** without per-field sources, "did the user override this or did we derive it?" needs heuristics; with them it is a rank comparison.
- **Why input hashing complements output hashing:** output hashes can only skip the write; input hashes at field granularity can skip the generation.
- **Why the manifest schema moved to its own package:** the bundler needs the writer boundary (`encodeBundleManifest`) without dragging in `@tsdoctor/bundle`'s fetch/cache/discovery peers.

## Related documentation

- **The RSPress config resolver that loads and publishes bundles:** `configuration-system.md`
- **The store the fingerprints would persist into:** `snapshot-tracking-system.md`
- **The registry that loads the layer-1 dependencies:** `type-loading-vfs.md`
- **Where OG derivation and head-tag rendering live:** `structured-data-and-og.md`
- **The VitePress adapter's platform tier and publishing:** `vitepress-adapter.md`
- **The `@tsdoctor/manifest` package and the `@effected` dependency map:** `tsdoctor-package-architecture.md`
