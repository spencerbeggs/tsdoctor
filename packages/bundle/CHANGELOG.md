# @tsdoctor/bundle

## 0.3.0

### Features

- Adds `publishBundleAssets`, which copies a resolved bundle's bundle-relative
  Open Graph images into a site's public directory and returns each one as a&#10;`PublishedOpenGraphImage` carrying an absolute (or root-relative) URL. An
  image already declared with an `url` passes through unchanged. Identical
  bytes are not rewritten, so a rebuild over an unchanged image leaves the
  published file's mtime untouched, and a manifest that left `width`/`height`&#10;undeclared gets them measured from the file's own bytes.

```ts
import { publishBundleAssets } from "@tsdoctor/bundle";

const images = yield* publishBundleAssets({
	bundleDir,
	images: resolvedBundle.openGraph?.images ?? [],
	publicDir: "docs/public",
	siteUrl,
	unscopedName: "my-package",
});
```

- A publish failure surfaces as the new `BundleAssetError`.

- Fetching a remote bundle (`fetchNpmBundle`, `fetchGitHubReleaseBundle`) now
  also persists any Open Graph image assets the manifest declares by
  bundle-relative path, so a fetched bundle's `og:image` is never dangling. A
  manifest declaring an asset that is missing from the fetched bundle now fails
  with `BundleFetchError`'s new `"missingAsset"` reason.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| image-size | peerDependency | added | — | ^2.0.2 |

- `image-size` is added as a peer dependency, used to measure an Open Graph
  image's dimensions when the manifest does not declare them. [#215][#215]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/tsdoctor/pull/215

## 0.2.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/manifest | dependency | updated | 0.0.0 | 0.1.0 |
| @tsdoctor/manifest | peerDependency | added | — | 0.1.0 |

- The `tsdoctor.json` bundle manifest schema now lives in `@tsdoctor/manifest`;&#10;`@tsdoctor/bundle` depends on it and re-exports its full surface
  (`BundleManifest`, `BundleManifestError`, `KNOWN_REGISTRY_TYPES`,&#10;`OpenGraphConfig`, `OpenGraphImage`, `ProjectIdentity`, `RegistryRef`,&#10;`SbomRef`, `decodeBundleManifest`, `isKnownRegistryType`, plus the new&#10;`MANIFEST_SPEC`, `ManifestSource`, `decodeManifestSource` and&#10;`encodeBundleManifest`), so no consumer import changes. [#213][#213]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#213]: https://github.com/spencerbeggs/tsdoctor/pull/213

## 0.2.3

### Maintenance

- Force package bumps

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/jsonc | peerDependency | updated | ^0.8.0 | ^0.8.1 |

[#197][#197]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#197]: https://github.com/spencerbeggs/tsdoctor/pull/197

## 0.2.1

### Bug Fixes

#### Use catalog:effected for Peer Dependencies

- Switch to strict versioning of peer dependencies via `@effected/pnpm-plugin-effect` to keep disapline of release cycle.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.0

### Breaking Changes

- The `BundleHash` surface is rebuilt on `@effected/jsonc`'s `JsoncFingerprint` — RFC 8785 (JCS) canonicalization plus SHA-256 through core's `Crypto` service:

- `hashText`, `hashJsonValue`, `hashLayerText` and `fingerprintResolvedBundle` are now Effects requiring the `Crypto.Crypto` service — provide `@effect/platform-node`'s `NodeCrypto.layer` (or any `Crypto` layer) at the application edge, the same posture as the package's `FileSystem | Path` requirements

- `canonicalJson` and `sha256Hex` are removed from the public surface; canonicalization is strict by design — an `undefined`-valued member or a non-plain object (a class instance, a `Date`) fails typed instead of being silently dropped, so Schema-encode values to plain JSON before hashing

### Features

- Bundle discovery reads `package.json` through `@effected/package-json`'s `LenientManifest`: a malformed individual field now degrades to absence instead of failing discovery, per the ladder's enrich-never-gate rule. Malformed JSON text (or a non-object document) still fails typed as `invalidPackageJson`. [#167][#167]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#167]: https://github.com/spencerbeggs/tsdoctor/pull/167

## 0.1.0

### Features

- `@tsdoctor/bundle` is a new package: the tsdoctor bundle spec — a layered resolution ladder over the folder or tarball describing one documented package, a versioned sidecar manifest, provenance-carrying resolution and canonical input hashing.

#### Layered bundle discovery

- `discoverBundle` / `discoverBundles` — find a bundle (or every bundle under a parent directory) by its `<name>.api.json`; every layer beyond it (`package.json`, `tsconfig.json`, `tsdoctor.json`) is optional and only enriches the result
- `readBundle` / `readApiModelInfo` — read the four bundle layers into a `Bundle` descriptor

#### `tsdoctor.json` sidecar manifest

- `BundleManifest` / `decodeBundleManifest` — the versioned manifest schema (spec 1): display identity, Open Graph images, an SBOM pointer and registry links, independent of `package.json`
- Unknown fields and unknown registry types degrade gracefully rather than failing to parse

#### Provenance-carrying resolution

- `resolveBundle` / `resolveBundleFrom` — merge a bundle's layers into a `ResolvedBundle` where every field carries a `Provenanced<A>` value plus the tier it came from (platform override, leaf manifest, project manifest, `package.json`, `tsconfig.json`, the API model, or an inference rule)
- `canonicalJson`, `fingerprintResolvedBundle` and related hashing helpers compute stable per-layer and per-field fingerprints for change detection

#### Fetchers

- `fetchNpmBundle` — fetch a bundle from an npm-compatible registry tarball
- `fetchGitHubReleaseBundle` — fetch a bundle from GitHub release assets (including the `*.npm.meta.tgz` release variant), with results cached under the shared XDG `"tsdoctor"` cache namespace [#165][#165]

```typescript
import { discoverBundle, resolveBundle } from "@tsdoctor/bundle";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const bundle = yield* discoverBundle({ dir: "/path/to/package" });
	const resolved = resolveBundle({ bundle });
	console.log(resolved.name.value, resolved.name.source);
});
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#165]: https://github.com/spencerbeggs/tsdoctor/pull/165
