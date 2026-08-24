# Getting started

Install the package, understand which peers you actually need, and wire the services for either a throwaway cache or a persistent XDG-rooted one.

## Install

```bash
npm install @tsdoctor/registry effect @effect/platform-node @effected/store @effected/semver
```

```bash
pnpm add @tsdoctor/registry effect @effect/platform-node @effected/store @effected/semver
```

Requires Node.js >=24.11.0.

## Peer dependencies

Four peers are required. The rest are optional: each one backs a single feature, and a consumer that does not use that feature never installs it.

Nothing is a bundled dependency. Each `@effected/*` package pins an exact `effect` version as its own peer, so bundling one would create a second resolution site that can land on a different `effect` build than yours and fail at import. As peers they all resolve in your closure, against your `effect`.

| Package | Required | Why |
| --- | --- | --- |
| `effect` | Yes | Core runtime, plus `FileSystem`, `Path` and `HttpClient` from `effect/unstable`. |
| `@effect/platform-node` | Yes | `NodeFileSystem`, the Node implementation you provide at the edge. |
| `@effected/store` | Yes | The `Cache` service backing the metadata plane, in the requirements of both `TypeCache` layers. |
| `@effected/semver` | Yes | Range parsing and `maxSatisfying` behind `TypeRegistry.resolveVersion`. Used internally rather than in a signature, but a peer so it resolves against your `effect`. |
| `@effected/xdg` | Optional | `AppDirs`, only for `TypeCache.layerXdg`. Wiring `TypeCache.layer({ cacheDir })` instead does not need it. |
| `@effected/tsconfig-json` | Optional | `CompilerOptions` and the enum codec, only for `TsEnvironment`. Loaded lazily at runtime. |
| `typescript` | Optional | Only for `TsEnvironment`, loaded lazily at runtime. |
| `@typescript/vfs` | Optional | Only for `TsEnvironment`, loaded lazily at runtime. |

Add the optional packages per feature — `@effected/xdg` for an XDG-rooted cache, and the TypeScript trio for building compiler environments rather than raw VFS maps:

```bash
npm install @effected/xdg
npm install @effected/tsconfig-json typescript @typescript/vfs
```

All three of the `TsEnvironment` peers load behind a dynamic `import()` inside `make`, so omitting them costs you nothing until you call it, and calling it without them yields a typed `TsEnvironmentError` rather than a crash.

Semver range resolution is no longer a peer. `@effected/semver` is an ordinary dependency, resolved for you, because it is used only inside the body of `resolveVersion` and appears in no exported signature.

### Keep @effected/store deduplicated

`@effected/store` carries the one required peer whose identity matters at runtime. `Cache` is a `Context` key derived from the package, so two copies in the tree produce two distinct keys. A `Cache.layerSqlite` built from the second copy will not satisfy the `Cache` requirement of `TypeCache`, and nothing about the install or the type-check flags it — the failure shows up as an unsatisfied requirement when you provide the layer. If you hit that, check for a duplicated `@effected/store` before suspecting the wiring.

## Composition happens at the edge

This package never builds a `FileSystem`, `Path`, `HttpClient` or `Cache` layer. You provide them, which is what makes the cache directory, the HTTP stack and the metadata database swappable — including in tests, where an in-memory metadata plane replaces a real database file.

Two rules follow from that. First, `TypeCache.layer`, `TypeCache.layerXdg` and `Cache.layerSqlite` are layer-returning **functions**: calling one twice builds two independent services, so bind the result to a `const` and provide that const. Second, the services compose bottom-up — platform layers feed `TypeCache` and `PackageFetcher`, which feed `TypeRegistry`.

## Wiring a temporary cache

The simplest wiring roots files in a temp directory and keeps metadata in memory. This is what the package's own end-to-end suite uses.

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
  const vfs = yield* registry.getPackageVfs(PackageSpec.fromString("zod@3.23.8"));
  console.log(vfs.size);
  // the number of cached files for the package (varies by package and version)
  return vfs;
});

await Effect.runPromise(program.pipe(Effect.provide(RegistryLayer)));
```

`cacheDir` must be an absolute path. A relative one is developer wiring, not input, so it dies at layer construction rather than failing typed.

## Wiring a persistent XDG cache

For a cache that survives across runs, root the files under the user's XDG cache directory and back the metadata plane with SQLite. The metadata database's parent directory has to exist before `Cache.layerSqlite` opens it, so resolve the cache root first with `AppDirs.ensureCache` and build the layer inside that effect.

```ts
import { NodeFileSystem } from "@effect/platform-node";
import { Cache } from "@effected/store";
import { AppDirs, Xdg } from "@effected/xdg";
import { Effect, Layer, Path } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { PackageFetcher, PackageSpec, TypeCache, TypeRegistry } from "@tsdoctor/registry";

const PlatformLayer = Layer.mergeAll(NodeFileSystem.layer, Path.layer, FetchHttpClient.layer);
const AppDirsLayer = AppDirs.layer({ namespace: "my-docs-tool" }).pipe(
  Layer.provide(Layer.mergeAll(Xdg.layer, PlatformLayer)),
);

const program = Effect.gen(function* () {
  const appDirs = yield* AppDirs;
  const path = yield* Path.Path;
  const base = yield* appDirs.ensureCache;
  const CacheLayer = Cache.layerSqlite({ filename: path.join(base, "types.db") });

  const RegistryLayer = TypeRegistry.layer.pipe(
    Layer.provideMerge(Layer.mergeAll(TypeCache.layerXdg({ namespace: "types" }), PackageFetcher.layer)),
    Layer.provide(Layer.mergeAll(CacheLayer, AppDirsLayer, PlatformLayer)),
  );

  return yield* Effect.gen(function* () {
    const registry = yield* TypeRegistry;
    return yield* registry.hasCached(PackageSpec.fromString("zod@3.23.8"));
  }).pipe(Effect.provide(RegistryLayer));
}).pipe(Effect.provide(Layer.mergeAll(AppDirsLayer, PlatformLayer)));

console.log(await Effect.runPromise(program));
// false on a cold cache, true once the package has been fetched
```

`TypeCache.layerXdg` roots files at `<AppDirs cache>/<namespace>/` and defaults the namespace to `ts-vfs`. A namespace containing a path separator, or one that is empty, `.` or `..`, is a wiring defect and dies at construction.

## Core concepts

### PackageSpec

Every package-shaped operation takes a `PackageSpec`: a name plus a version reference, which may be exact, a range or a dist-tag. Construct one with `make` or `fromString`, never `new`.

```ts
import { PackageSpec } from "@tsdoctor/registry";

const pkg = PackageSpec.fromString("zod@3.23.8");
console.log(pkg.name, pkg.version, pkg.cacheKey);
// "zod" "3.23.8" "zod:3.23.8"

console.log(PackageSpec.fromString("zod").version);
// "latest"
```

A specifier with no version part defaults to `latest`. Ranges and tags are pinned later by `resolveVersion`.

### Vfs

A `Vfs` is a plain `Map<string, string>` whose keys are `node_modules/`-prefixed paths and whose values are file contents. That shape is what `@typescript/vfs` and Twoslash consume directly.

```ts
import { mergeVfs, prefixVfs } from "@tsdoctor/registry";

const local = prefixVfs("my-lib", new Map([["index.d.ts", "export declare const x: number;"]]));
console.log([...local.keys()]);
// [ 'node_modules/my-lib/index.d.ts' ]

const combined = mergeVfs(local, other);
// merged left to right; later maps win on path collisions
```

`VirtualFileSystem` remains exported as an alias of `Vfs` for consumers migrating from earlier versions.

### VirtualPackage

When the declarations already exist locally — API Extractor output, hand-written ambient types — synthesize a package instead of fetching one. Virtual packages are transient and never written to the disk cache.

```ts
import { VirtualPackage } from "@tsdoctor/registry";

const pkg = VirtualPackage.create("@my-org/api-types", "1.0.0", "export interface User { id: string }");
console.log([...pkg.toVfs().keys()]);
// [ 'node_modules/@my-org/api-types/package.json', 'node_modules/@my-org/api-types/index.d.ts' ]
```

Use `createMultiEntry` for several entry points, which generates a synthetic `exports` map, or `fromFile` to read a single `.d.ts` through the `FileSystem` service.

### TsEnvironment

`TsEnvironment.make` turns a VFS into a `VirtualTypeScriptEnvironment`, loading the optional peers lazily. A missing peer surfaces as a typed `TsEnvironmentError` rather than crashing at import time.

```ts
import { TsEnvironment } from "@tsdoctor/registry";
import { Effect } from "effect";

const program = Effect.gen(function* () {
  const environment = yield* TsEnvironment.make({
    vfs,
    compilerOptions: { strict: true, target: "es2022" },
  });
  return environment.languageService.getProgram();
});
```

`compilerOptions` is tsconfig JSON form — `CompilerOptions.Type` from `@effected/tsconfig-json`, the same shape you would write in a `tsconfig.json`. Enum-valued fields are strings (`"es2022"`, not `ts.ScriptTarget.ES2022`) and are converted to the compiler's numeric enums internally, so building options needs no `typescript` import.

VFS paths are re-rooted under `projectRoot`, which defaults to `process.cwd()`. Declaration files in the map become the environment's root files.

## Next steps

- [Caching](02-caching.md) — TTL, pruning, and how a stale entry differs from a miss.
- [Observability](03-observability.md) — subscribing to typed progress events.
- [API reference](05-api-reference.md) — the full exported surface.
