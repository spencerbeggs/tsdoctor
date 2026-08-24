# Caching

`TypeCache` keeps fetched declarations local so repeated lookups cost a disk read instead of a CDN round trip. It is a two-plane cache: the files live on disk, and the per-package metadata lives in an `@effected/store` `Cache` with native TTL expiry.

## The two planes

The file plane holds the package's `package.json` and declaration files under `<cacheDir>/<name>/<version>/`. The metadata plane holds one entry per package, keyed `name:version` (or `@scope:name:version`), recording the pinned version, when it was cached, and an optional TTL.

Splitting them is what makes expiry cheap and the metadata plane swappable. The store handles TTL, evict-on-read and bulk pruning; the disk plane stays a dumb file tree. It also means the two can disagree, which the loader treats as meaningful rather than as corruption.

```text
<cacheDir>/
├── zod/
│   └── 3.23.8/
│       ├── package.json
│       └── lib/index.d.ts
└── @effect/
    └── schema/
        └── 0.79.0/
            ├── package.json
            └── dist/dts/index.d.ts
```

The metadata database is a separate file you place yourself when building `Cache.layerSqlite` — it is not required to sit inside `cacheDir`.

## The stale-vs-miss ladder

`getPackageVfs` consults both planes and takes one of three paths.

| Metadata | Files on disk | Outcome |
| --- | --- | --- |
| Live | Present | Hit — served from disk, `CacheHit` emitted. |
| Expired or absent | Present | Stale — refetched when `autoFetch` is on, otherwise served as-is. |
| Any | Absent | Miss — fetched, or `PackageNotFoundError` when `autoFetch` is off. |

A hit requires both planes. Live metadata whose files have been deleted externally counts as a miss, because serving it would produce an empty VFS.

Turning `autoFetch` off makes the registry offline: a stale entry is still served, so an expired TTL degrades to "slightly old types" rather than a failure.

```ts
const vfs = yield* registry.getPackageVfs(pkg, { autoFetch: false });
// serves on-disk files even when the metadata expired;
// fails PackageNotFoundError when nothing is cached
```

## TTL

Pass a `ttl` when caching to control how long an entry stays fresh. It is recorded in the metadata entry and forwarded to the store's native expiry, so the entry participates in pruning automatically. An absent `ttl` means the entry never expires.

```ts
import { Duration, Effect } from "effect";
import { PackageSpec, TypeRegistry } from "@tsdoctor/registry";

const program = Effect.gen(function* () {
  const registry = yield* TypeRegistry;
  yield* registry.fetchAndCache(PackageSpec.fromString("zod@3.23.8"), { ttl: Duration.days(7) });
});
```

`getPackageVfs` and `getVfs` accept the same option, applied to whatever they fetch along the way.

## Cache operations

Check whether a package's files are on disk. This is a pure disk check and does not consult metadata, so it answers "are the files there" rather than "is the entry fresh".

```ts
const cached = yield* registry.hasCached(PackageSpec.fromString("zod@3.23.8"));
console.log(cached);
// true when the package directory exists on disk
```

Remove one package. Metadata goes first, then the files, so a crash between the two steps leaves harmless orphaned files rather than a phantom cache hit.

```ts
yield* registry.clearCache(PackageSpec.fromString("zod@3.23.8"));
```

Prune every expired entry and delete the directories behind them. Pruning is deliberately best-effort rather than transactional: file removal happens outside the store's transaction, so a per-directory failure is swallowed and the directory is simply not claimed in the result.

```ts
const { count, removed } = yield* registry.pruneCache;
console.log(count, removed.length);
// how many metadata entries expired, and how many directories were actually deleted
```

Note that `pruneCache` is a value, not a function — it takes no arguments, so `yield*` it directly.

## Choosing a cache root

`TypeCache.layer({ cacheDir })` roots the cache wherever you say, and requires an absolute path. `TypeCache.layerXdg({ namespace })` roots it at `<AppDirs cache>/<namespace>/`, which on Linux honours `XDG_CACHE_HOME` and on macOS resolves under the platform's own cache directory. Both are covered with working wiring in [getting started](01-getting-started.md).

Because both are layer-returning functions, bind the result to a `const` and provide that const. Providing `TypeCache.layerXdg()` at two sites mints two independent caches.

## Testing against the cache

The metadata plane is swappable, so cache tests need no database file. `Cache.layerTest()` runs the store against `:memory:`.

```ts
const TestLayer = TypeCache.layer({ cacheDir }).pipe(
  Layer.provideMerge(Layer.mergeAll(Cache.layerTest(), NodeFileSystem.layer, Path.layer)),
);
```

Expiry reads the clock through `DateTime.now`, so `TestClock.adjust` drives TTL behaviour without waiting.

## Clearing everything

Removing the cache root removes the file plane, but not the metadata database if it sits elsewhere. Delete both, or prune afterwards, to avoid metadata entries pointing at directories that no longer exist. Those entries are harmless — a missing file plane reads as a miss — but they do occupy the store until pruned.
