# @tsdoctor/bundle

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
