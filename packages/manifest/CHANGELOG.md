# @tsdoctor/manifest

## 0.1.0

### Features

- Introduces `@tsdoctor/manifest`, a new schema-only package for the&#10;`tsdoctor.json` bundle manifest (spec 1). It depends on `effect` alone, so a
  bundler writing the file and a reader decoding it never have to share the
  other's stack.

```ts
import { decodeBundleManifest, encodeBundleManifest } from "@tsdoctor/manifest";

const manifest = yield* decodeBundleManifest(rawManifest);
const encoded = encodeBundleManifest(manifest);
```

- Exports the manifest schema and its supporting types: `BundleManifest`,&#10;`BundleManifestError`, `KNOWN_REGISTRY_TYPES`, `OpenGraphConfig`,&#10;`OpenGraphImage`, `ProjectIdentity`, `RegistryRef`, `SbomRef`,&#10;`MANIFEST_SPEC`, `ManifestSource`, `decodeBundleManifest`,&#10;`decodeManifestSource`, `encodeBundleManifest` and `isKnownRegistryType`.

- `@tsdoctor/bundle` now depends on this package and re-exports its surface,
  so existing consumers importing from `@tsdoctor/bundle` are unaffected. [#213][#213]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#213]: https://github.com/spencerbeggs/tsdoctor/pull/213
