# @tsdoctor/registry

[![npm](https://img.shields.io/npm/v/@tsdoctor/registry?label=npm&color=cb3837)](https://www.npmjs.com/package/@tsdoctor/registry)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

External TypeScript type loading for Effect: fetch, cache and resolve type definitions from npm via the jsDelivr CDN into a `Vfs`, the virtual file system Twoslash-style documentation tooling type-checks against.

## Why @tsdoctor/registry

Documentation tooling that typechecks code samples needs the declaration files for whatever packages those samples import, and needs them without a real `node_modules`. Fetching them by hand means writing a CDN client, a disk cache with expiry, and a module resolver that understands `exports`, `typesVersions` and the legacy `types` field. This package is those three things behind one service, with typed errors and no hidden IO — every filesystem, HTTP and database dependency is provided by you at the edge. What it produces is a `Vfs` from [`@tsdoctor/vfs`](../vfs), which also owns the virtual-package and `@typescript/vfs` environment primitives — this package fills a VFS, it does not define one.

## Install

```bash
npm install @tsdoctor/registry effect @effect/platform-node @effected/store @effected/semver
```

```bash
pnpm add @tsdoctor/registry effect @effect/platform-node @effected/store @effected/semver
```

Requires Node.js >=24.11.0. Those four peers are required. `@effected/xdg` is optional and pulls in only with the feature that uses it:

```bash
# for TypeCache.layerXdg
npm install @effected/xdg
```

Every dependency here is a peer rather than a bundled dependency, including `@effected/semver`, whose types appear in no exported signature. That is deliberate: each `@effected/*` package pins an exact `effect` version as its own peer, so bundling one would create a second resolution site that can land on a different `effect` build than yours and fail at import. As peers they all resolve in your closure, against your `effect`.

Install `@effected/store` such that it resolves to one copy. `Cache` is keyed by package identity, so a duplicated install gives your `Cache.layerSqlite` a different key than the one `TypeCache` asks for, and the requirement goes unsatisfied with no error at the install site.

## Quick start

Everything composes at the edge: this package builds no `FileSystem`, `HttpClient` or `Cache` layer of its own, so you pick the implementations.

```ts
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Cache } from "@effected/store";
import { Effect, Layer, Path } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { PackageFetcher, PackageSpec, TypeCache, TypeRegistry } from "@tsdoctor/registry";

const RegistryLayer = TypeRegistry.layer.pipe(
  Layer.provideMerge(
    Layer.mergeAll(TypeCache.layer({ cacheDir: mkdtempSync(join(tmpdir(), "types-")) }), PackageFetcher.layer),
  ),
  Layer.provide(Layer.mergeAll(Cache.layerTest(), NodeFileSystem.layer, Path.layer, FetchHttpClient.layer)),
);

const program = Effect.gen(function* () {
  const registry = yield* TypeRegistry;
  const version = yield* registry.resolveVersion("zod", "^3.23.0");
  const vfs = yield* registry.getPackageVfs(PackageSpec.make({ name: "zod", version }));
  console.log(version, vfs.size);
  // the pinned version matching the range, then the file count (both vary by package)
  return vfs;
});

await Effect.runPromise(program.pipe(Effect.provide(RegistryLayer)));
```

`Cache.layerTest()` keeps the metadata plane in memory. For a persistent cache, swap it for `Cache.layerSqlite` and root the files under the XDG cache directory with `TypeCache.layerXdg` — see [getting started](docs/01-getting-started.md).

## Features

- `TypeRegistry` — the facade over cache, fetcher and resolver: `getVfs`, `getPackageVfs`, `fetchAndCache`, `resolveVersion`, `resolveImport`, `getTypeEntries`, `hasCached`, `clearCache`, `pruneCache`.
- `TypeCache` — a two-plane cache: declaration files on disk, per-package metadata in an `@effected/store` `Cache` with native TTL expiry and pruning.
- `PackageFetcher` — the jsDelivr-backed CDN client, requiring only an `HttpClient`.
- `TypeResolver` — static resolution of import specifiers and type entry points against a package manifest, covering `exports`, `typesVersions` and legacy fields.
- `RegistryEvent` and `RegistryObserver` — an opt-in, zero-cost progress channel; the library logs nothing on its own.
- Typed errors throughout: `FetchError`, `PackageNotFoundError`, `VersionNotFoundError`, `TypeCacheError`, `BatchLoadError`.

## Documentation

- [Getting started](docs/01-getting-started.md) — install, peer dependencies, and the edge-wiring recipes for temporary and XDG-rooted caches.
- [Caching](docs/02-caching.md) — the two-plane cache, TTL and the stale-vs-miss ladder, pruning, and choosing a cache root.
- [Observability](docs/03-observability.md) — the `RegistryEvent` catalogue, wiring an observer, and the tracing spans each method opens.
- [Architecture](docs/04-architecture.md) — how the services compose, why composition happens at the edge, and the error model.
- [API reference](docs/05-api-reference.md) — every exported service, schema, helper and error.
- [Troubleshooting](docs/06-troubleshooting.md) — missing services, optional peers, cache permissions and CDN failures.

## License

[MIT](LICENSE)
