# @tsdoctor/manifest

[![npm](https://img.shields.io/npm/v/@tsdoctor%2Fmanifest?label=npm&color=cb3837)](https://www.npmjs.com/package/@tsdoctor/manifest)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

> **Deprecated.** Use [`@effected/manifest`](https://www.npmjs.com/package/@effected/manifest) instead.

The spec-1 bundle manifest — a documented package's display identity, Open Graph images, SBOM pointer and registries — now ships from the effected kit as `@effected/manifest`, which depends on `effect` alone. The sidecar file is now named `bundle.json` (exported as `BUNDLE_MANIFEST_FILENAME`), replacing `tsdoctor.json`.

This package is a thin re-export of `@effected/manifest`, kept so existing imports keep working for one more release. Every name it exports (`BundleManifest`, `ManifestSource`, `decodeBundleManifest`, `encodeBundleManifest`, `decodeManifestSource`, `MANIFEST_SPEC`, `BUNDLE_MANIFEST_FILENAME` and the rest) comes from `@effected/manifest` unchanged.

## Migrating

Replace the dependency and the import specifier:

```bash
pnpm remove @tsdoctor/manifest
pnpm add @effected/manifest
```

```ts
import { decodeBundleManifest, encodeBundleManifest } from "@effected/manifest";
```

`TSDOCTOR_MANIFEST_FILENAME` is gone; use `BUNDLE_MANIFEST_FILENAME` (`"bundle.json"`). Readers inside the tsdoctor monorepo can keep importing the same names from `@tsdoctor/bundle`, which re-exports them.

## License

[MIT](LICENSE)
