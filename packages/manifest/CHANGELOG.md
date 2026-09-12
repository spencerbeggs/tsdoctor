# @tsdoctor/manifest

## 0.1.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

[#237][#237]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#237]: https://github.com/spencerbeggs/tsdoctor/pull/237

## 0.1.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

[#221][#221]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#221]: https://github.com/spencerbeggs/tsdoctor/pull/221

## 0.1.0

### Features

- Introduces `@tsdoctor/manifest`, a new schema-only package for the
  `tsdoctor.json` bundle manifest (spec 1). It depends on `effect` alone, so a
  bundler writing the file and a reader decoding it never have to share the
  other's stack.

```ts
import { decodeBundleManifest, encodeBundleManifest } from "@tsdoctor/manifest";

const manifest = yield* decodeBundleManifest(rawManifest);
const encoded = encodeBundleManifest(manifest);
```

- Exports the manifest schema and its supporting types: `BundleManifest`,
  `BundleManifestError`, `KNOWN_REGISTRY_TYPES`, `OpenGraphConfig`,
  `OpenGraphImage`, `ProjectIdentity`, `RegistryRef`, `SbomRef`,
  `MANIFEST_SPEC`, `ManifestSource`, `decodeBundleManifest`,
  `decodeManifestSource`, `encodeBundleManifest` and `isKnownRegistryType`.

- `@tsdoctor/bundle` now depends on this package and re-exports its surface,
  so existing consumers importing from `@tsdoctor/bundle` are unaffected. [#213][#213]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#213]: https://github.com/spencerbeggs/tsdoctor/pull/213
