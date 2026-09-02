# Troubleshooting

Common failures, and what each one is actually telling you.

## A service is missing from the layer

The most common compile error names a service still sitting in the effect's requirement channel:

```text
Type 'Effect<Vfs, ..., TypeRegistry>' is not assignable to type 'Effect<Vfs, ..., never>'
```

Something in the graph was not provided. Work bottom-up: `TypeRegistry.layer` needs `TypeCache` and `PackageFetcher`; `TypeCache` needs `Cache`, `FileSystem` and `Path`, plus `AppDirs` when built with `layerXdg`; `PackageFetcher` needs `HttpClient`. The [getting started](01-getting-started.md) recipes show both complete wirings.

The requirement channel is not an inconvenience here — it is the compiler telling you the program cannot run yet. There is no runtime crash to discover later.

## The cache appears to be ignored

If every call re-fetches, the usual cause is layer memoization. `TypeCache.layer`, `TypeCache.layerXdg` and `Cache.layerSqlite` are layer-returning functions, so calling one at two provide sites builds two independent caches that do not see each other's writes.

```ts
// Wrong: two calls, two caches
Effect.provide(TypeCache.layerXdg());

// Right: one call, bound and reused
const TypeCacheLayer = TypeCache.layerXdg();
Effect.provide(TypeCacheLayer);
```

## A cached package refetches after restarting

Metadata and files are separate planes. If the metadata plane is `Cache.layerTest()`, it lives in memory and is gone on restart, so every entry reads as stale even though the files are still on disk. Switch to `Cache.layerSqlite` with a stable filename for a cache that survives.

The inverse also happens: deleting the cache directory without pruning leaves metadata entries pointing at directories that no longer exist. Those read as misses and refetch, which is correct but leaves rows behind until `pruneCache` runs.

## The layer dies at construction

Some inputs are treated as developer wiring rather than input, and die rather than fail typed:

- A relative `cacheDir` passed to `TypeCache.layer`, which must be absolute.
- A `namespace` for `TypeCache.layerXdg` that is empty, `.`, `..`, or contains a path separator.

These are not recoverable at runtime, so they surface immediately instead of becoming a typed error you would have to handle at every call site.

## layerXdg fails with a missing @effected/xdg

`@effected/xdg` is an optional peer, loaded lazily inside `TypeCache.layerXdg`. Install it if you want an XDG-rooted cache:

```bash
npm install --save-optional @effected/xdg
```

In practice you will hit this as a type error before a runtime one. `layerXdg` requires the `AppDirs` service in its context, and the only way to provide it is to import `@effected/xdg` yourself — so a program that composes `layerXdg` correctly already depends on the package. If the module is genuinely absent at runtime, the failure is a defect rather than a typed error, because `AppDirsError` is defined in the module that failed to load.

Nothing here affects `TypeCache.layer({ cacheDir })`. That layer never touches `@effected/xdg`, and importing `@tsdoctor/registry` does not resolve the package.

## Cache requirement is unsatisfied despite providing a Cache layer

`Cache` is a `Context` key derived from the `@effected/store` package identity, so two copies of that package in the dependency tree produce two keys that are not interchangeable. A `Cache.layerSqlite` built from one copy will not satisfy the `Cache` requirement `TypeCache` declares against the other, and neither the install nor the type-check flags it. Check for a duplicate before rereading the wiring:

```bash
npm ls @effected/store
# more than one version or path here is the bug
```

Deduplicate with `npm dedupe`, a pnpm override, or by aligning the version range you and the library agree on.

## A package fails to load

`PackageLoadFailed` events classify each failure from typed fields rather than message text, so the `kind` tells you where to look:

| `kind` | Meaning |
| --- | --- |
| `not-found` | The package or pinned version is not on the CDN. |
| `version-range` | No published version satisfies the requested range. |
| `schema` | The manifest or CDN response failed validation. |
| `network` | Transport failure, timeout, or a non-2xx status. |
| `cache` | Disk or metadata-store IO failed. |
| `unknown` | An unclassified defect. |

A `network` failure on a transport error or timeout has already been retried on an exponential schedule. A non-2xx status is not retried, because the CDN answered.

### VersionNotFoundError

The requested reference matched no dist-tag, no exact version and no published version in range. The error carries a bounded sample of the versions that do exist, which usually makes the mistake obvious:

```ts
Effect.catchTag("VersionNotFoundError", (error) =>
  Effect.sync(() => console.error(error.ref, error.available)),
);
```

Freshly published versions can take a few minutes to appear on jsDelivr, so a version that npm already lists may briefly resolve as missing.

### FetchError with kind "body"

The package exceeded the materialization budget — either the per-package file cap or the cumulative byte cap. This is a guard against exhausting memory on unusually large packages, not a network problem.

## Permission denied writing to the cache

`TypeCacheError` with `operation: "write"` and a path under your cache root means the directory is not writable by the running user. Point the cache somewhere writable with `TypeCache.layer({ cacheDir })`, or on Linux set `XDG_CACHE_HOME` before resolving `AppDirs`. In CI, prefer an explicit temp directory over the user cache.

## An entire batch fails

`getVfs` fails with `BatchLoadError` only when every requested package fails. A single shared cause — no network, an unwritable cache directory — is more likely than every package being individually broken, so inspect the per-package errors it carries:

```ts
Effect.catchTag("BatchLoadError", (error) =>
  Effect.sync(() => {
    for (const failure of error.failures) console.error(failure.name, failure.error);
  }),
);
```

## Nothing is being logged

That is the default. The library performs no logging of its own; the host owns presentation. Provide a `RegistryObserver` layer to receive events, as shown in [observability](03-observability.md).
