---
type: Module
title: "@tsdoctor/bundle"
description: The versioned bundle spec — layered discovery, the tsdoctor.json manifest, provenance-carrying resolution, fetchers and Open Graph asset publishing.
kind: package
layer: L2
resource: ../../packages/bundle
status: stable
tags: [architecture, compat]
sources:
  - id: src
    resource: ../../packages/bundle/src
    last_modified: 2026-09-13T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-24T20:28:47Z
  body_sha256: 2db1e8fe634f87b2b4dd192c0833f985ab50faf7f98a6d84f5968e70fbac0e99
---

# @tsdoctor/bundle

## Boundary and purpose

`@tsdoctor/bundle` formalizes the *bundle*: the folder or tarball of files
describing one documented package — the fundamental input contract behind
"give us an api.json and we transform it into static docs." It owns the
layered resolution ladder, the sidecar manifest (schema re-exported from
`@tsdoctor/manifest`), a provenance-carrying resolver, three fetchers
(local directory, npm tarball, GitHub release) and an Open Graph asset
publisher.[^src] It is deliberately free of `@microsoft/api-extractor-model`:
layer 0 of the ladder reads only the model's package name; full model
loading belongs to `@tsdoctor/model`.

## Layer cake

Re-exports every name from `@tsdoctor/manifest` (`workspace:*`), so this
package is the one consumers in the monorepo import from — a reader never
imports `@tsdoctor/manifest` directly. Ships no services of its own:
filesystem functions keep `FileSystem | Path` in their Effect requirement
channel, and callers compose the platform at the edge, the same posture
`@effected/walker` takes. Both adapters (`platforms/rspress`'s
`ConfigService.resolve`, `platforms/vitepress`'s `Generate.ts`) call
`loadBundle` then `resolveBundleFrom` and publish the resolved Open Graph
images through `publishBundleAssets`.

Peers: `effect`, `image-size`, `@tsdoctor/manifest`, and the seven
`@effected` packages whose types appear in this package's public `.d.ts`
surface: `github`, `jsonc`, `npm`, `package-json`, `store`,
`tsconfig-json` and `xdg`, each `catalog:effected:peers`. `@effected/glob`
and `@effected/walker` are used internally only, so they are ordinary
`dependencies` (`catalog:effected`). See
[core-peers-follow-public-surface](../decisions/core-peers-follow-public-surface.md).

## Public surface

Re-exported from `@tsdoctor/manifest` (see that module for detail):
`BundleManifest`, `ManifestSource`, `decodeBundleManifest`,
`encodeBundleManifest`, `decodeManifestSource`, `MANIFEST_SPEC`,
`TSDOCTOR_MANIFEST_FILENAME`, `KNOWN_REGISTRY_TYPES`,
`isKnownRegistryType`, `OpenGraphConfig`, `OpenGraphImage`,
`ProjectIdentity`, `RegistryRef`, `SbomRef`.[^src]

This package's own modules, flat, module-per-concept:[^src]

- `Bundle.ts` — `readBundle`, `readApiModelInfo`, `BundleDescriptor`,
  `ApiModelInfo`, `BundleLayerError`. The bundle descriptor plus the four
  layer readers.
- `BundleDiscovery.ts` — `discoverBundle`, `discoverBundles`, `loadBundle`,
  `loadBundles`, `BundleOverrides`, `BundleDiscoveryError`. Generalizes the
  RSPress adapter's earlier `fromDir` / `fromParentDir` helpers, minus the
  RSPress-specific `baseRoute` templating logic; its `package.json` read
  goes through `@effected/package-json`'s `LenientManifest.parse` —
  field-level degradation on a malformed individual field, a typed
  `invalidPackageJson` failure only when the JSON itself is malformed.
- `BundleResolver.ts` — `resolveBundle`, `resolveBundleFrom`,
  `ResolvedBundle`, `Provenanced<A>`, `ProvenanceSource`. Pure resolution
  over the layered tiers.
- `BundleHash.ts` — `hashText`, `hashJsonValue`, `hashLayerText`,
  `fingerprintResolvedBundle`, `normalizeText`. Rebuilt on
  `@effected/jsonc`'s `JsoncFingerprint` (RFC 8785 / JCS canonicalization
  plus SHA-256 through core's `Crypto` service); these are Effects
  requiring `Crypto.Crypto`, provided at the edge (typically
  `@effect/platform-node`'s `NodeCrypto.layer`), the same posture as
  `FileSystem | Path`. Canonicalization is strict: an `undefined` member
  or a non-plain object fails typed as `JsoncCanonicalizeError` rather
  than being silently dropped or coerced.
- `BundleFetch.ts` — `fetchNpmBundle`, `fetchGitHubReleaseBundle`,
  `BundleFetchError`. Fetched bundles are cached under the shared XDG
  cache via `@effected/store`'s `Cache` plus `@effected/xdg`'s `AppDirs`
  under the namespace `"tsdoctor"`, at cache paths
  `bundles/npm/<name>/<version>` and
  `bundles/github/<owner>/<repo>/<tag>/<asset>`.
- `PlatformOverrides.ts` — `PlatformOverrides`, `decodePlatformOverrides`.
  The top-ranked override tier: a data-override object an adapter's own
  plugin options pass through, so a user with only an api.json can
  declare identity declaratively without a `tsdoctor.json` file at all.
- `BundleAssets.ts` — `publishBundleAssets`, `PublishedOpenGraphImage`,
  `PublishBundleAssetsInput`, `BundleAssetError`.

## Absorbed mechanisms

### The layered resolution ladder

A bundle is one required file plus optional overlays, each layer
enriching, never gating:

| Layer | File | Supplies |
| --- | --- | --- |
| 0 | `<name>.api.json` (required) | package name, entry points, the API itself |
| 1 | `package.json` | version, description, author/contributors, repository, license, the dependencies the registry loads for rendering |
| 2 | `tsconfig.json` | compiler options for the Twoslash environment |
| 3 | `tsdoctor.json` | the sidecar manifest: display identity, Open Graph, SBOM pointer, registries |

Discovery requires only layer 0: a folder with just the `.api.json` is a
valid bundle, with the display name falling back to the model's own name
field. `discoverBundle` / `discoverBundles` preserve the semantics the
RSPress helpers had before delegating here — multi-model disambiguation,
unscoped-name preference, caller overrides winning, a strict parent scan
and an explicit error on an empty parent directory — but take no shared
per-bundle overrides across a batch call; adapter-level defaulting for
that stays adapter-side, as does the stricter `package.json` requirement
the RSPress helpers used to enforce.

### Tier model and override ranking

`resolveBundle` ranks tiers highest first: `manifest.platform` (the
`PlatformOverrides` data-override object), `manifest.leaf` (the package's
own `tsdoctor.json`), `manifest.project` (the monorepo's project-tier
manifest), then a derived band (`packageJson`, `tsconfig`, `apiModel`),
and finally `inferred` (documented inference rules, such as deriving
Open Graph alt text). One deliberate exception: `name` resolution skips
the project tier entirely (platform → leaf → packageJson → apiModel),
because folding the project tier into the uniform ladder would title
every package in a monorepo with the project's own name rather than its
own. `tagline` resolves platform → leaf → project, and the whole project
identity is separately exposed as `resolved.project` for site-level
consumers such as an `og:site_name` tag.

Every field on a `ResolvedBundle` is a `Provenanced<A>` — a value paired
with its `ProvenanceSource`. Whether a field was user-overridden is
therefore a rank comparison, not a heuristic: a field is overridden iff
its source outranks whatever tier would otherwise have supplied it.
`ProvenanceSource` extends the manifest's tiers with one adapter-specific
addition, `"tsconfig"`, for the compiler-options pass-through; the
display-name provenance chain deliberately skips the `manifest.project`
tier for the same reason `name` resolution does above.

### Provenance and change detection

`BundleHash.ts` supplies two levels of change detection: coarse per-layer
file hashes (canonical-normalize, then SHA-256 through
`JsoncFingerprint` — the identical discipline `@tsdoctor/snapshot`'s
`hashFrontmatter` uses) and fine per-field fingerprints of the
`ResolvedBundle`. The fine fingerprint hashes the `{ value, source }`
pair rather than the value alone, so an override flip that happens to
leave the resolved value unchanged is still a visible diff — the intent
is field-granular input hashing, so a changed field invalidates only the
surfaces that consume it (a version bump touches version-embedding
surfaces; a tsconfig change touches every code block on the site), which
complements the snapshot system's output hashing rather than replacing
it.

### Discovery

Beyond the ladder rules above: the discovery-time name and version pair
is read through `@effected/package-json`'s `LenientManifest`, so a
malformed `package.json` still fails typed while a single malformed field
inside an otherwise-valid file degrades to absence rather than failing
the whole read.

### Fetchers

`fetchNpmBundle` and `fetchGitHubReleaseBundle` are the two remote
sources; both cache under the shared `"tsdoctor"` XDG namespace with
self-healing hit checks — a cache hit requires both the metadata record
and every file it lists to still exist on disk. GitHub release assets
unpack to a `meta/` root rather than npm's `package/`, so the fetcher
probes `package/`, then the archive root, then each top-level
subdirectory for a `*.api.json`. GitHub release assets carry no integrity
metadata of their own, so that fetch path is integrity-unverified and
restricted to public repositories; the npm path is verified through
`@effected/npm`'s own tarball handling. Both fetchers additionally
persist every `openGraph.images[].path` a fetched manifest declares,
copied under its own bundle-relative path — a path that would escape the
bundle fails typed `invalidRef`, and a declared asset the archive does
not actually contain fails typed `missingAsset`, rather than resolving
either case to a silently broken image.

### Publishing Open Graph assets

`publishBundleAssets` turns a `ResolvedBundle`'s `openGraph.images` into
`<head>`-ready URLs: a bundle-relative `path` image is copied to
`<publicDir>/tsdoctor/<unscopedName>/<basename>`, an unchanged file is
skipped so a rebuild does not touch it, and every image (copied or
already a `url`) comes back as a `PublishedOpenGraphImage` with an
absolute URL, or a root-relative one when `siteUrl` is empty. A declared
width/height wins over one measured from the file's bytes; measurement
happens only when the manifest did not declare a dimension. It lives here
rather than in the I/O-free `@tsdoctor/pages` because it needs a
`FileSystem`, and here rather than duplicated per adapter because both
adapters need byte-identical copy-and-rewrite behavior.

Every manifest-declared `path` is checked by `isSafeAssetPath`
(`src/internal/asset-path.ts`) before any filesystem read — no leading
slash, no `.`/`..` path segment, no `/` or `\` hidden inside a segment —
and a path that fails this check fails typed `BundleAssetError` naming
the offending path without ever reading the bundle directory. The
fetcher's own traversal check in `BundleFetch.ts` imports this same
predicate rather than reimplementing it, so "does this path escape the
bundle" has exactly one answer regardless of which plane (fetch or
publish) asks; the fetch plane's own failure speaks fetch-plane
vocabulary (`BundleFetchError` with `reason: "invalidRef"` or
`"missingAsset"`) rather than reusing `BundleAssetError`.

`publishBundleAssets` also accepts an optional `subdir`, inserted between
`unscopedName` and the basename. Without it, two builds of the same
package that both carry an `openGraph` image publish to the identical
route and overwrite each other, because differing bytes defeat the
identical-bytes skip and whichever build runs last wins for every
consumer's pages. The RSPress adapter passes a version string as
`subdir` for a versioned site, so per-version images do not collide.

### Reserved for consumers

Open Graph images are wired end to end today — generated or authored,
published by both adapters, rendered by `@tsdoctor/seo`. SBOM surfacing
and registry badges reach the resolved bundle (`resolved.sbom`,
`resolved.registries`) but have no adapter consumer rendering them yet;
that is a later product change, not a gap in this package.

## Invariants

- Layer 0 (the `.api.json`) is the only required file; every other layer
  enriches without gating.
- Consumers in this repository import manifest names from
  `@tsdoctor/bundle`, never from `@tsdoctor/manifest` directly.
- A present-but-malformed layer 1–3 file fails typed
  (`BundleLayerError` / `BundleManifestError` / `BundleDiscoveryError`);
  an absent one is `Option.none()`.
- Fine-grained fingerprints hash the `{ value, source }` pair, not the
  value alone.
- Every manifest-declared asset path is checked with `isSafeAssetPath`
  before any filesystem read, on both the fetch plane and the publish
  plane, through the one shared predicate.
- `publishBundleAssets` skips a write when the destination file's bytes
  are already identical.

## Links

- [Decision: the manifest sits below the bundle package](../decisions/manifest-below-bundle.md)
- [Glossary: bundle](../glossary/bundle.md)
- [Interface: the tsdoctor.json manifest contract](../interfaces/tsdoctor-json-manifest.md)

[^src]: `packages/bundle/src/index.ts`, `packages/bundle/src/Bundle.ts`,
`packages/bundle/src/BundleDiscovery.ts`,
`packages/bundle/src/BundleResolver.ts`, `packages/bundle/src/BundleHash.ts`,
`packages/bundle/src/BundleFetch.ts`,
`packages/bundle/src/PlatformOverrides.ts`,
`packages/bundle/src/BundleAssets.ts`.
