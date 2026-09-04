# @tsdoctor/manifest

[![npm](https://img.shields.io/npm/v/@tsdoctor%2Fmanifest?label=npm&color=cb3837)](https://www.npmjs.com/package/@tsdoctor/manifest)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

The `tsdoctor.json` sidecar manifest: the spec-1 schema for a documented package's display identity, Open Graph images, SBOM pointer and registries, plus the encode/decode boundaries a writer and a reader each need. It depends on `effect` alone, so a bundler can emit `tsdoctor.json` through this package without pulling in `@tsdoctor/bundle`'s fetch, cache and discovery stack.

## What you get

- **`BundleManifest`** — the manifest schema. `spec` is `1` and the only required field; every other field (`name`, `tagline`, `description`, a nested `project` identity, `openGraph`, `sbom`, `registries`) is additive. Unknown enum-ish values (`registries[].type`, `sbom.format`) degrade to a plain value rather than being rejected, so a reader that does not know a registry type still renders it as a link.
- **`decodeBundleManifest(input, path?)`** — the reader's boundary: `Schema.decodeUnknownEffect` over `BundleManifest`, failing typed `BundleManifestError` on a malformed file.
- **`encodeBundleManifest(manifest)`** — the writer's boundary: `Schema.encodeEffect` over `BundleManifest`, so an emitted file is by construction what `decodeBundleManifest` accepts.
- **`ManifestSource`** and **`decodeManifestSource(input, path?)`** — the shape an author checks in as a `tsdoctor.json` source file: `BundleManifest` minus `spec` and `project`, since a source file never declares its own spec version or the tier a monorepo project inherits.
- **`OpenGraphImage`, `OpenGraphConfig`, `SbomRef`, `RegistryRef`, `ProjectIdentity`, `KNOWN_REGISTRY_TYPES`, `isKnownRegistryType`** — the field-level schemas and helpers `BundleManifest` composes.
- **`MANIFEST_SPEC`, `TSDOCTOR_MANIFEST_FILENAME`** — the spec version this package reads and writes, and the sidecar's file name inside a bundle folder.

## Install

```bash
npm install @tsdoctor/manifest
# or
pnpm add @tsdoctor/manifest
```

This is an ESM-only package. `effect` is a peer dependency.

## Quick start

```ts
import { Effect } from "effect";
import { decodeBundleManifest, encodeBundleManifest } from "@tsdoctor/manifest";

const program = Effect.gen(function* () {
  const manifest = yield* decodeBundleManifest({
    spec: 1,
    name: "Kitchen Sink",
    tagline: "Every API Extractor feature, one fixture",
    openGraph: { images: [{ path: "og/kitchensink.png" }] },
  });

  // Round-trips: what encodeBundleManifest writes, decodeBundleManifest reads back.
  const encoded = yield* encodeBundleManifest(manifest);
  return encoded;
});
```

## Three boundaries, one file

`tsdoctor.json` has three readers, and each gets its own function rather than sharing one loosely-typed parser:

- **`decodeBundleManifest`** is what `@tsdoctor/bundle`'s layer-3 reader calls on a bundle's own `tsdoctor.json` — the fully resolved shape, `spec` and `project` included.
- **`encodeBundleManifest`** is what a bundler's meta pass calls to emit the file — going through the schema rather than `JSON.stringify` is what guarantees the two boundaries agree on shape.
- **`decodeManifestSource`** is what a bundler calls on an *authored* `tsdoctor.json` beside a package's `package.json`, or at a monorepo root — a source file never declares its own `spec` or `project`, because both are supplied by whichever tier assembles the final manifest.

## Provenance

Moved out of `@tsdoctor/bundle` so `@savvy-web/bundler`'s meta pass — the one implementation of this file's authoring-time resolution — can depend on the writer boundary without dragging in the bundle package's `@effected/github`, `npm`, `store`, `xdg`, `glob` and `walker` peers. `@tsdoctor/bundle` re-exports every name here; consumers inside the tsdoctor monorepo import from `@tsdoctor/bundle`, and only writers import this package directly.

## License

[MIT](LICENSE)
