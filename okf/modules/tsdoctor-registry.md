---
type: Module
title: "@tsdoctor/registry"
description: External package type loading — fetch, cache and resolve published npm type definitions into a Vfs for Twoslash tooling.
kind: package
layer: L2
resource: ../../packages/registry
status: draft
tags: [architecture, compat]
sources:
  - id: src
    resource: ../../packages/registry/src
    last_modified: 2026-09-13T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 4aa40e7084cb6f2313d9685efd048905edaf59fe5a587c11f890381e57197ad1
---

# @tsdoctor/registry

## Boundary and purpose

`@tsdoctor/registry` does exactly what its name says: fetch, cache and
resolve external package type definitions from the jsDelivr CDN into a
`Vfs`, for Twoslash to type-check documentation examples against.[^src] It
carries no VFS primitives of its own — `Vfs`, `mergeVfs`, `prefixVfs`,
`isTypeDefinition`, `VirtualPackage` and `TsEnvironment` all left for
`@tsdoctor/vfs`, because they had no consumer inside this package while
`@tsdoctor/model` needed them, and hosting them here would have forced the
model to depend on a package that fetches from a CDN. Do not re-add a VFS
primitive to this package.

The package was moved in verbatim from a sibling repository (`type-registry-effect`)
during the monorepo consolidation, its API otherwise unchanged from that
release. One identity rename happened afterward: every `Context.Service`
tag id here now reads `"@tsdoctor/registry/..."` — the legacy
`"type-registry-effect/..."` strings are gone — and the plugin's shared XDG
cache namespace is `"tsdoctor"`, accepting a one-time cold refetch as the
cost of the rename.

## Layer cake

Depends on `@tsdoctor/vfs` as a plain workspace dependency for `Vfs` and
`VirtualPackage`. Ships **no platform layer of its own** — every consumer
composes the Effect stack (FileSystem, HTTP client, cache backing) at the
edge; `platforms/rspress/src/services/TypeRegistryService.ts` is the
concrete example, owning its own layer as a static rather than reaching
for a `*ServiceLive.ts` this package might have shipped. Consumed by both
adapters (`platforms/rspress`, `platforms/vitepress`) and, indirectly
through them, feeds the resolved external-type VFS that
`@tsdoctor/model`'s `ApiExtractedPackage`-produced declarations are merged
alongside.

Required peers: `effect`, `@effect/platform-node`, `@effected/semver`,
`@effected/store`. One optional peer: `@effected/xdg`. `typescript`,
`@typescript/vfs` and `@effected/tsconfig-json` stayed with
`@tsdoctor/vfs`'s `TsEnvironment` when the split happened — do not add
them back here.

## Public surface

Flat module layout, all re-exported from `src/index.ts`:[^src]

- `TypeRegistry`, `TypeRegistryShape`, `BatchLoadError`, `PackageVfsOptions`
  — `src/TypeRegistry.ts`. `TypeRegistry` is a `Context.Service` (`class
  TypeRegistry extends Context.Service<TypeRegistry, TypeRegistryShape>()(...)`)
  with two members: `resolveVersions` turns each spec's semver range or npm
  dist-tag into an exact published version — dropping any package it
  cannot resolve, because the CDN behind package loading requires exact
  versions — and `loadPackages` returns a `Vfs` or a typed
  `TypeRegistryError`. `resolveVersions` recovers from registry
  infrastructure failure (no HOME for XDG, an unwritable cache DB) by
  passing specs through unresolved, so a meaningful failure surfaces later
  from `loadPackages` instead.
- `TypeCache`, `TypeCacheShape`, `TypeCacheError`, `TypeCacheMetadata`,
  `CachePruneResult` — `src/TypeCache.ts`. The metadata-plane cache over
  `@effected/store`'s `Cache`.
- `PackageFetcher`, `PackageFetcherShape`, `PackageManifest`, `FetchError`,
  `PackageNotFoundError`, `VersionNotFoundError`, `PackageVersions` —
  `src/PackageFetcher.ts`.
- `PackageSpec` — `src/PackageSpec.ts`.
- `TypeResolver`, `ResolvedModule` — `src/TypeResolver.ts`.
- `RegistryEvent`, `RegistryObserver`, `RegistryObserverShape` —
  `src/RegistryEvent.ts`. This package emits **no logs of its own**; the
  `RegistryObserver` tag is the only diagnostic surface a consumer has.
  Every operational signal — a package load failing, a batch completing —
  is a typed `RegistryEvent` an observer implementation chooses what to do
  with (a consuming adapter's own event bus is a typical sink).

`src/internal/` holds implementation helpers not on the public surface.

## Invariants

- No VFS primitive lives here; a new one belongs in `@tsdoctor/vfs`.
- No platform layer ships from this package; every consumer composes its
  own stack at the edge.
- `resolveVersions` must resolve to an **exact** version before
  `loadPackages` is called — the CDN this package fetches from does not
  serve ranges or tags.
- Anything that peers on `effect` must remain a peer in this package's
  `package.json`; a nested copy of `effect` strands service tags at
  import.
- Diagnostics flow only through `RegistryObserver`; do not add a second
  logging path.

## Links

- [Decision: consolidate into one monorepo](../decisions/consolidate-into-one-monorepo.md)
- [Decision: vfs sits below the registry and the model](../decisions/vfs-below-registry-and-model.md)

[^src]: `packages/registry/src/index.ts`, `packages/registry/src/TypeRegistry.ts`,
`packages/registry/src/TypeCache.ts`, `packages/registry/src/PackageFetcher.ts`,
`packages/registry/src/PackageSpec.ts`, `packages/registry/src/TypeResolver.ts`,
`packages/registry/src/RegistryEvent.ts`.
