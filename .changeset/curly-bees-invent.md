---
"@tsdoctor/manifest": minor
---

## Features

Introduces `@tsdoctor/manifest`, a new schema-only package for the
`tsdoctor.json` bundle manifest (spec 1). It depends on `effect` alone, so a
bundler writing the file and a reader decoding it never have to share the
other's stack.

```ts
import { decodeBundleManifest, encodeBundleManifest } from "@tsdoctor/manifest";

const manifest = yield* decodeBundleManifest(rawManifest);
const encoded = encodeBundleManifest(manifest);
```

Exports the manifest schema and its supporting types: `BundleManifest`,
`BundleManifestError`, `KNOWN_REGISTRY_TYPES`, `OpenGraphConfig`,
`OpenGraphImage`, `ProjectIdentity`, `RegistryRef`, `SbomRef`,
`MANIFEST_SPEC`, `ManifestSource`, `decodeBundleManifest`,
`decodeManifestSource`, `encodeBundleManifest` and `isKnownRegistryType`.

`@tsdoctor/bundle` now depends on this package and re-exports its surface,
so existing consumers importing from `@tsdoctor/bundle` are unaffected.
