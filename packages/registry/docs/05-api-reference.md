# API reference

Everything exported from `@tsdoctor/registry`. The package has a single entry point; there is no platform-specific subpath.

## TypeRegistry

The facade over the cache, fetcher and resolver. Hold it with `const registry = yield* TypeRegistry`.

| Member | Signature | Notes |
| --- | --- | --- |
| `hasCached` | `(pkg) => Effect<boolean, TypeCacheError>` | Pure disk check; ignores metadata. |
| `fetchAndCache` | `(pkg, options?) => Effect<void, FetchError \| PackageNotFoundError \| TypeCacheError>` | `options.ttl` is a `Duration`. |
| `getPackageVfs` | `(pkg, options?) => Effect<Vfs, FetchError \| PackageNotFoundError \| TypeCacheError>` | Walks the stale-vs-miss ladder. |
| `getVfs` | `(packages, options?) => Effect<Vfs, BatchLoadError>` | Best-effort; concurrency 5. |
| `resolveImport` | `(pkg, specifier) => Effect<Option<ResolvedModule>, TypeCacheError \| FetchError>` | Reads the cached manifest. |
| `getTypeEntries` | `(pkg) => Effect<ReadonlyArray<ResolvedModule>, TypeCacheError \| FetchError>` | Every types-bearing entry point. |
| `resolveVersion` | `(name, ref) => Effect<string, FetchError \| VersionNotFoundError>` | Resolves tags, exact versions and ranges. |
| `clearCache` | `(pkg) => Effect<void, TypeCacheError>` | Metadata first, then files. |
| `pruneCache` | `Effect<CachePruneResult, TypeCacheError>` | A value, not a function. |

`TypeRegistry.layer` requires `TypeCache | PackageFetcher`.

### PackageVfsOptions

`autoFetch` defaults to `true`. With `false`, a stale entry is served from disk unrefreshed and a miss fails with `PackageNotFoundError`. `ttl` is a `Duration` recorded on whatever the call newly caches; absent means the entry never expires.

### resolveVersion

Resolution is local rather than a CDN endpoint. A dist-tag resolves through the CDN's tag map, an exact version matches the published list, and anything else parses as a range and resolves max-satisfying through `@effected/semver`.

```ts
const version = yield* registry.resolveVersion("zod", "^3.23.0");
// the highest published 3.x version satisfying the range

const tagged = yield* registry.resolveVersion("zod", "latest");
// whatever the "latest" dist-tag currently points at
```

An unmatched reference fails as `VersionNotFoundError`, which carries a bounded sample of the versions that do exist.

### getVfs

Loads concurrently, accumulates per-package failures, and merges the partial results. It fails with `BatchLoadError` only when every package fails. An empty array is not an error and yields an empty `Vfs`.

```ts
const vfs = yield* registry.getVfs([
  PackageSpec.fromString("zod@3.23.8"),
  PackageSpec.fromString("@effect/schema@0.79.0"),
]);
console.log(vfs.size);
// the merged file count across every package that loaded
```

Subscribe to `PackageLoadFailed` events to see which members of a partially successful batch dropped out — see [observability](03-observability.md).

## TypeCache

The two-plane cache. Covered in depth in [caching](02-caching.md).

| Member | Signature |
| --- | --- |
| `exists` | `(pkg) => Effect<boolean, TypeCacheError>` |
| `read` | `(pkg, filePath) => Effect<string, TypeCacheError>` |
| `write` | `(pkg, filePath, content) => Effect<void, TypeCacheError>` |
| `listFiles` | `(pkg) => Effect<ReadonlyArray<string>, TypeCacheError>` |
| `readMetadata` | `(pkg) => Effect<Option<TypeCacheMetadata>, TypeCacheError>` |
| `writeMetadata` | `(pkg, metadata) => Effect<void, TypeCacheError>` |
| `getVfs` | `(pkg) => Effect<Vfs, TypeCacheError>` |
| `remove` | `(pkg) => Effect<void, TypeCacheError>` |
| `prune` | `Effect<CachePruneResult, TypeCacheError>` |

`readMetadata` returns `Option.none()` when the entry is absent **or expired** — expiry evicts on read, which is what drives the stale-vs-miss distinction.

Two layer factories are available. `TypeCache.layer({ cacheDir })` requires an absolute path and needs `Cache | FileSystem | Path`. `TypeCache.layerXdg({ namespace? })` roots the cache at `<AppDirs cache>/<namespace>/`, defaults the namespace to `ts-vfs`, and additionally requires `AppDirs`.

### TypeCacheMetadata

A schema class with `version`, `cachedAt` (a `DateTime.Utc`) and an optional `ttl` (a `Duration`). The `ttl` is forwarded to the store's native expiry.

### CachePruneResult

`count` is how many metadata entries were evicted; `removed` lists the packages whose directories were actually deleted. A directory whose removal failed is not claimed.

## PackageFetcher

The jsDelivr client. `PackageFetcher.layer` requires only `HttpClient`.

| Member | Signature |
| --- | --- |
| `getVersions` | `(name) => Effect<PackageVersions, FetchError>` |
| `getFileTree` | `(pkg) => Effect<ReadonlyArray<string>, FetchError \| PackageNotFoundError>` |
| `downloadFile` | `(pkg, path) => Effect<string, FetchError \| PackageNotFoundError>` |
| `getPackageJson` | `(pkg) => Effect<PackageManifest, FetchError \| PackageNotFoundError>` |
| `getTypeFiles` | `(pkg) => Effect<ReadonlyMap<string, string>, FetchError \| PackageNotFoundError>` |

`getTypeFiles` downloads at concurrency 10 under a materialization budget: exceeding the per-package file cap or the cumulative byte cap fails typed as a `FetchError` with `kind: "body"` rather than exhausting memory. Transport errors and timeouts retry on an exponential schedule; a non-2xx status does not.

`PackageVersions` carries `versions` (every published version) and `tags` (dist-tags mapped to versions). `PackageManifest` is a deliberately lenient `package.json` subset covering only the fields resolution reads, because CDN manifests include every historical malformation npm ever published.

## TypeResolver

Pure static resolution over a manifest. No service, no layer, no error channel.

| Member | Signature |
| --- | --- |
| `resolveImport` | `(specifier, manifest, pkg) => Option<ResolvedModule>` |
| `resolveMainEntry` | `(manifest, pkg) => ResolvedModule` |
| `resolveTypeEntries` | `(manifest, pkg) => ReadonlyArray<ResolvedModule>` |
| `findTypeDefinition` | `(jsFilePath, pkg) => Option<ResolvedModule>` |

`resolveImport` consults the `exports` map first (the `types` condition, then `import`/`default`, then fallback arrays in order), then `typesVersions["*"]`, then — for the root specifier only — the top-level `types` and `typings` fields. It returns `Option.none()` when the manifest offers no evidence, leaving fallback policy to you rather than guessing a path.

`resolveMainEntry` is total, falling back through `types`/`typings`, the root export's types condition, a declaration-extension swap of `main`, and finally the `index.d.ts` convention.

`findTypeDefinition` maps a JavaScript path to its conventional declaration path: `.js` to `.d.ts`, `.mjs` to `.d.mts`, `.cjs` to `.d.cts`.

Every resolved path is validated to stay inside the package, so a hostile manifest naming an absolute or `..`-bearing path fails closed with `Option.none()`.

`ResolvedModule` carries `filePath` (relative to the package root, no `./` prefix), `isTypeDefinition`, and the `package` spec.

## PackageSpec

A schema class identifying a package at a version reference. Construct with `make` or `fromString`, never `new`.

| Member | Signature |
| --- | --- |
| `PackageSpec.make` | `({ name, version }) => PackageSpec` |
| `PackageSpec.fromString` | `(spec) => PackageSpec` |
| `PackageSpec.normalizeSpecifier` | `(specifier) => string` |
| `PackageSpec.parseCacheKey` | `(key) => Option<PackageSpec>` |
| `toString` | `() => string` |
| `cacheKey` | getter returning `string` |

`normalizeSpecifier` extracts the package name from an arbitrary import specifier. Node built-ins and `node:` specifiers normalize to `node`, matching the `@types/node` convention.

```ts
console.log(PackageSpec.normalizeSpecifier("node:fs"));
// "node"
console.log(PackageSpec.normalizeSpecifier("readline/promises"));
// "node"
console.log(PackageSpec.normalizeSpecifier("@effect/platform/Http"));
// "@effect/platform"
console.log(PackageSpec.normalizeSpecifier("lodash/fp"));
// "lodash"
```

Names and versions are validated just enough that neither can escape a cache directory when joined into a path. Beyond that, validation is lenient. An invalid specifier is developer wiring rather than input, so it throws.

## Vfs

`Vfs` is `Map<string, string>`, keyed by `node_modules/`-prefixed paths. `VirtualFileSystem` is an alias kept for consumers migrating from earlier versions.

`mergeVfs(...maps)` merges left to right into a new map; later entries win on collisions. `prefixVfs(name, entries)` prefixes every path with `node_modules/<name>/`, normalizing away leading slashes.

## VirtualPackage

A synthetic package built from local declaration content. Instances are transient and never persisted to the disk cache. The class is subclass-friendly.

| Member | Signature |
| --- | --- |
| `VirtualPackage.create` | `(name, version, declarations) => VirtualPackage` |
| `VirtualPackage.createMultiEntry` | `(name, version, entries) => VirtualPackage` |
| `VirtualPackage.fromFile` | `(name, version, filePath) => Effect<VirtualPackage, PlatformError, FileSystem>` |
| `toVfs` | `() => Vfs` |

`toVfs` emits a synthetic `package.json` alongside the entry files, using `types` for a single entry and an `exports` map for several, so TypeScript module resolution works against the generated VFS. An empty entry set throws, as does a set whose names collide after extension normalization.

## TsEnvironment

`TsEnvironment.make(options)` returns `Effect<VirtualTypeScriptEnvironment, TsEnvironmentError>`. Options are `vfs`, `compilerOptions`, and an optional `projectRoot` defaulting to `process.cwd()`.

`compilerOptions` is `CompilerOptions.Type` from `@effected/tsconfig-json` — tsconfig JSON form, where enum-valued fields are strings (`{ strict: true, target: "es2022" }`, not `ts.ScriptTarget.ES2022`). They are encoded to the compiler's numeric enums inside `make`, so the option type carries no dependency on the `typescript` package.

The optional `typescript`, `@typescript/vfs` and `@effected/tsconfig-json` peers all load lazily inside `make`, so a missing peer is a typed `TsEnvironmentError` rather than an import-time crash. `VirtualTypeScriptEnvironment` is deliberately not re-exported — import the type from `@typescript/vfs`, which any consumer of this module already declares.

There is no environment cache. A consumer wanting keyed reuse across compiler options holds its own map.

## RegistryEvent and RegistryObserver

The opt-in progress channel, documented in full in [observability](03-observability.md). `RegistryEvent` is a schema union of eleven tagged variants. `RegistryObserver.layerCallback(onEvent)` builds an observer from a plain function, and `RegistryObserver.layerNoop` drops everything.

## Errors

| Error | Fields |
| --- | --- |
| `FetchError` | `url`, `status?`, `kind` (`transport`, `status`, `body`, `schema`), `cause` |
| `PackageNotFoundError` | `name`, `version` |
| `VersionNotFoundError` | `name`, `ref`, `available` |
| `TypeCacheError` | `operation`, `path`, `cause` |
| `BatchLoadError` | `failures` (one entry per package, with its typed error) |
| `TsEnvironmentError` | `cause` |

All are `Schema.TaggedError` classes, so `Effect.catchTag` narrows them and `cause` preserves the underlying failure structurally.
