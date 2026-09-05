# @tsdoctor/registry

## 0.3.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/semver | peerDependency | updated | ^0.5.0 | ^0.5.1 |

[#218][#218]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#218]: https://github.com/spencerbeggs/tsdoctor/pull/218

## 0.3.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/vfs | dependency | updated | 0.2.0 | 0.2.1 |

### Maintenance

- Force package bumps

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.3.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/vfs | dependency | updated | 0.1.0 | 0.2.0 |

## 0.3.0

### Documentation

- Corrects the npm listing description, which still described building `@typescript/vfs` environments after that responsibility moved to `@tsdoctor/vfs`: "External TypeScript type loading for Effect: fetch, cache and resolve type definitions from npm via the jsDelivr CDN into a virtual file system." [#206][#206]

### Refactoring

- The virtual file system primitives move to the new `@tsdoctor/vfs` package, which `@tsdoctor/registry` now depends on. They had no consumers inside this package — `VirtualPackage` and `TsEnvironment` were re-exported from the barrel and used nowhere else — while `@tsdoctor/model` needs them to turn an API model into a virtual package. Sharing a substrate keeps the registry from having to know about API models, or the model from having to depend on a package that fetches from a CDN.

- Removed from this package's public API, all available from `@tsdoctor/vfs` instead:

| Export | Now in |
| --- | --- |
| `Vfs`, `VirtualFileSystem`, `mergeVfs`, `prefixVfs` | `@tsdoctor/vfs` |
| `VirtualPackage` | `@tsdoctor/vfs` |
| `TsEnvironment`, `TsEnvironmentError`, `TsEnvironmentOptions` | `@tsdoctor/vfs` |

- `TsEnvironment` was the only module reaching for `typescript`, `@typescript/vfs` and `@effected/tsconfig-json`, so those three optional peers leave with it. This package's remaining job is what its name says: fetch, cache and resolve external package type definitions into a `Vfs`.

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/tsconfig-json | peerDependency | removed | catalog:effected | — |
| @typescript/vfs | peerDependency | removed | ^1.6.4 | — |
| typescript | peerDependency | removed | ^6.0.3 | — |
| @tsdoctor/vfs | dependency | added | — | 0.1.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#206]: https://github.com/spencerbeggs/tsdoctor/pull/206

## 0.2.2

### Bug Fixes

#### Use catalog:effected for Peer Dependencies

- Switch to strict versioning of peer dependencies via `@effected/pnpm-plugin-effect` to keep disapline of release cycle.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/store | peerDependency | updated | ^0.4.0 | ^0.5.0 |

- Republishes the package so its `@effected/store` peer range matches the rest of the `@tsdoctor` set. `@tsdoctor/registry@0.2.0` was published before the catalog moved to `@effected/store@0.5.0` and shipped a `^0.4.0` peer, which is disjoint from the `^0.5.0` that `@tsdoctor/bundle`, `@tsdoctor/snapshot` and `rspress-plugin-api-extractor` declare — on a `0.x` line those two ranges share no version, so a consumer installing the plugin could not satisfy every peer with a single copy of the package. [#174][#174]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#174]: https://github.com/spencerbeggs/tsdoctor/pull/174

## 0.2.0

### Breaking Changes

- The four `Context.Service` tag identifiers are renamed from `"type-registry-effect/..."` to `"@tsdoctor/registry/..."` (matching the package's new name). This is an observable service-identity change: consumers that reference a tag id string directly (rather than importing the tag itself) need to update it. Consumers of the exported service tags (`TypeRegistry`, `TypeCache`, `PackageFetcher`, …) are unaffected — only the underlying id string changed. [#165][#165]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#165]: https://github.com/spencerbeggs/tsdoctor/pull/165

## 0.1.0

### Features

#### New package, successor to `type-registry-effect`

- `@tsdoctor/registry` is a new package that fetches, caches and resolves npm type definitions and builds `@typescript/vfs` environments for Twoslash-style documentation tooling. It succeeds `type-registry-effect@2.3.5`, developed in the `tsdoctor` monorepo, and carries forward the same public API, module layout, and peer dependency closure unchanged:

```typescript
// Before
import { TypeRegistry } from "type-registry-effect";

// After
import { TypeRegistry } from "@tsdoctor/registry";
```

- `type-registry-effect` will be deprecated on npm with a pointer to this package; migrate by updating the import specifier and dependency name. `TypeRegistry`, `TypeCache`, `TypeResolver`, `PackageFetcher`, `PackageSpec`, `RegistryEvent`/`RegistryObserver`, `TsEnvironment`, `Vfs`, and `VirtualPackage` all keep their existing shape. [#163][#163]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#163]: https://github.com/spencerbeggs/tsdoctor/pull/163
