# Architecture

How the services fit together, why this package builds no platform layers of its own, and what the error model guarantees.

## The service graph

Three services in the graph, one of which is the facade you normally hold. A fourth, the optional `RegistryObserver`, sits alongside it — any service may emit events to it when a host provides one (see [observability](03-observability.md)).

```text
TypeRegistry                    the facade you call
├── TypeCache                   files on disk + metadata in a store Cache
│   ├── Cache                   @effected/store, the metadata plane
│   ├── FileSystem              effect platform
│   └── Path                    effect platform
└── PackageFetcher              jsDelivr client
    └── HttpClient              effect platform
```

`TypeResolver` and `TsEnvironment` sit outside the graph. Both are static — `TypeResolver` is pure resolution logic over a manifest, and `TsEnvironment.make` returns an effect with no service requirement — so neither needs a layer.

## Composition at the edge

This package never constructs a `FileSystem`, `Path`, `HttpClient` or `Cache` layer. Consumers provide them.

The reason is that each of those choices belongs to the application, not the library. Which HTTP stack, which directory, whether the metadata database is SQLite on disk or `:memory:` in a test — a library that decides for you forces every consumer with a different answer to work around it. Edge wiring also means the whole graph is substitutable in tests without mocking the library itself.

The cost is a longer wiring block on first use, which [getting started](01-getting-started.md) covers with working recipes for both a temporary and a persistent cache.

## Service pattern

Services are `Context.Service` classes paired with an exported `*Shape` interface, and their tag IDs are namespaced under `@tsdoctor/registry/`:

```ts
export class TypeRegistry extends Context.Service<TypeRegistry, TypeRegistryShape>()(
  "@tsdoctor/registry/TypeRegistry",
) {
  static readonly layer: Layer.Layer<TypeRegistry, never, TypeCache | PackageFetcher>;
}
```

Layers are exposed as statics on the class. `TypeRegistry.layer` and `PackageFetcher.layer` are values; `TypeCache.layer` and `TypeCache.layerXdg` are parameterized factories, which is why they must be bound to a const before being provided.

Holding the service and calling its methods — `const registry = yield* TypeRegistry` — replaces the loose namespace of free functions earlier versions exposed.

## Error model

Errors are `Schema.TaggedError` classes with structured fields, and each method's error union is precise rather than a package-wide catch-all.

| Error | Raised by | Carries |
| --- | --- | --- |
| `FetchError` | `PackageFetcher` | `url`, `kind`, `status`, `cause` |
| `PackageNotFoundError` | fetcher and registry | `name`, `version` |
| `VersionNotFoundError` | `resolveVersion` | `name`, `ref`, `available` |
| `TypeCacheError` | `TypeCache` | `operation`, `path`, `cause` |
| `BatchLoadError` | `getVfs` | one `failures` entry per package |
| `TsEnvironmentError` | `TsEnvironment.make` | `cause` |

Underlying failures are preserved structurally in `cause` rather than flattened to a string, so a handler can inspect the original `PlatformError` or schema failure.

The division between failures and defects is deliberate. Anything the outside world controls — a 404, an unmatched range, a permissions error, an absent optional peer — is a typed failure. Anything the developer controls — a relative `cacheDir`, a namespace containing a slash, a `VirtualPackage` with no entries — is a defect that dies at construction, because there is no runtime recovery from wiring that is simply wrong.

## Load path

`getPackageVfs` walks the stale-vs-miss ladder described in [caching](02-caching.md), fetching only when both planes say it must. Cache mutations run under a semaphore so that a `clearCache` landing between a fetch's file writes and its metadata write cannot strand live metadata with no files. That guards fibers within one runtime; cross-process races on a shared cache directory are out of scope, and the both-planes hit check is the backstop.

`getVfs` loads up to five packages concurrently, accumulates per-package failures, and merges whatever succeeded. It fails only when every package fails, which keeps one unavailable package from taking down a documentation build.

## The TypeScript seam

`TsEnvironment` is the only module that touches `typescript` and `@typescript/vfs`, and it imports them lazily inside `make`. A consumer that never builds an environment never loads the compiler, and a consumer that has not installed the optional peers gets a typed `TsEnvironmentError` rather than an import-time crash.

That module is also the one place where IO escapes the `FileSystem` service: `createDefaultMapFromNodeModules` and `createFSBackedSystem` read the real filesystem through TypeScript's own `sys`. This is accepted and contained to that seam.

## Entry points

The package exports `.` and `./package.json`, and nothing else. There is no platform-specific entry point — platform choices are yours to wire, which is the same principle the service graph rests on.

## Related documentation

- [Getting started](01-getting-started.md) — wiring recipes for both cache flavours.
- [Caching](02-caching.md) — the two planes and the stale-vs-miss ladder.
- [API reference](05-api-reference.md) — the full exported surface.
