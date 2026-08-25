# @tsdoctor/bundle

[![npm](https://img.shields.io/npm/v/@tsdoctor%2Fbundle?label=npm&color=cb3837)](https://www.npmjs.com/package/@tsdoctor/bundle)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

The tsdoctor bundle spec. A bundle is the folder of files that describes one documented package — an API Extractor `.api.json` model plus optional overlays — and this package owns everything about reading one: discovery on disk, the versioned `tsdoctor.json` sidecar manifest, resolution of manifest data across override tiers with per-field provenance, and canonical hashing of the inputs for change detection.

## The layered bundle

A bundle is one required file plus optional overlays. Each layer enriches the result; none of the optional layers gates it — a folder holding only an `.api.json` still resolves.

| Layer | File | Required | Supplies |
| --- | --- | --- | --- |
| 0 | `<name>.api.json` | yes | package name, the API itself |
| 1 | `package.json` | no | version, description, dependencies and peers |
| 2 | `tsconfig.json` | no | compiler options for the rendering environment |
| 3 | `tsdoctor.json` | no | display identity, Open Graph, SBOM pointer, registries |

## Install

```bash
pnpm add @tsdoctor/bundle effect @effected/glob @effected/package-json @effected/tsconfig-json @effected/walker
```

This is an ESM-only package. `effect` and the `@effected/*` packages are peer dependencies.

## Quick start

```ts
import { NodeCrypto, NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Path } from "effect";
import { fingerprintResolvedBundle, loadBundle, resolveBundleFrom } from "@tsdoctor/bundle";

const program = Effect.gen(function* () {
  const bundle = yield* loadBundle("./lib/models/kitchensink");
  const resolved = resolveBundleFrom(bundle, {
    // The manifest.platform tier: declarative overrides that outrank every file.
    tagline: "Every API Extractor feature in one module",
  });
  console.log(resolved.name); // { value: "...", source: "manifest.leaf" | "packageJson" | ... }
  console.log(yield* fingerprintResolvedBundle(resolved)); // per-field SHA-256 fingerprints
});

program.pipe(
  Effect.provide(Layer.mergeAll(NodeFileSystem.layer, Path.layer, NodeCrypto.layer)),
  Effect.runPromise,
);
```

Every resolved field carries `{ value, source }`, so "did the user override this or did we derive it?" is a rank comparison, not a heuristic. The fingerprints feed a snapshot store: unchanged inputs mean generation can be skipped at the granularity of exactly the surfaces a changed field invalidates.

## API surface

- `discoverBundle(dir)` / `discoverBundles(parentDir)` — resolve folder(s) into `BundleDescriptor`s (model file selection, name/version parsing, overlay detection).
- `fetchNpmBundle` / `fetchGitHubReleaseBundle` — fetch a published bundle from any npm-protocol registry (via `@effected/npm`'s verified tarball pipeline) or from a GitHub release's `*.npm.meta.tgz` asset (via `@effected/github`), through a durable XDG cache (`@effected/store` + `@effected/xdg`). npm versions are immutable, so cache hits skip the network; `refresh: true` refetches.
- `readBundle(descriptor)` / `loadBundle(dir)` / `loadBundles(parentDir)` — read the four layers into typed structures.
- `BundleManifest`, `decodeBundleManifest` — the `tsdoctor.json` spec-1 schema; unknown fields and unknown registry types degrade gracefully instead of rejecting.
- `PlatformOverrides`, `decodePlatformOverrides` — the top-ranked data-override tier a consumer passes through platform options.
- `resolveBundle` / `resolveBundleFrom` — the pure six-tier resolver producing a `ResolvedBundle` of `Provenanced` fields, with the documented inference rules (Open Graph alt-text chain, MIME from extension).
- `hashLayerText`, `hashJsonValue`, `fingerprintResolvedBundle` — RFC 8785 (JCS) canonicalization plus SHA-256 (via `@effected/jsonc`'s `JsoncFingerprint`) for coarse (per-layer) and fine (per-field) change detection. Canonicalization is strict: an `undefined`-valued member or non-plain object fails typed rather than being silently dropped.

All filesystem-touching functions keep `FileSystem` and `Path` in the Effect `R` channel, and the hashing functions keep `Crypto` there too; provide platform layers (for example `@effect/platform-node`'s `NodeFileSystem.layer`, `Path.layer` and `NodeCrypto.layer`) once at the application boundary.

## License

[MIT](LICENSE)
