---
"@tsdoctor/registry": minor
---

## Refactoring

The virtual file system primitives move to the new `@tsdoctor/vfs` package, which `@tsdoctor/registry` now depends on. They had no consumers inside this package — `VirtualPackage` and `TsEnvironment` were re-exported from the barrel and used nowhere else — while `@tsdoctor/model` needs them to turn an API model into a virtual package. Sharing a substrate keeps the registry from having to know about API models, or the model from having to depend on a package that fetches from a CDN.

Removed from this package's public API, all available from `@tsdoctor/vfs` instead:

| Export | Now in |
| --- | --- |
| `Vfs`, `VirtualFileSystem`, `mergeVfs`, `prefixVfs` | `@tsdoctor/vfs` |
| `VirtualPackage` | `@tsdoctor/vfs` |
| `TsEnvironment`, `TsEnvironmentError`, `TsEnvironmentOptions` | `@tsdoctor/vfs` |

`TsEnvironment` was the only module reaching for `typescript`, `@typescript/vfs` and `@effected/tsconfig-json`, so those three optional peers leave with it. This package's remaining job is what its name says: fetch, cache and resolve external package type definitions into a `Vfs`.

## Documentation

Corrects the npm listing description, which still described building `@typescript/vfs` environments after that responsibility moved to `@tsdoctor/vfs`: "External TypeScript type loading for Effect: fetch, cache and resolve type definitions from npm via the jsDelivr CDN into a virtual file system."

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/vfs | dependency | added | — | 0.0.0 |
| @typescript/vfs | peerDependency | removed | ^1.6.4 | — |
| typescript | peerDependency | removed | ^6.0.3 | — |
| @effected/tsconfig-json | peerDependency | removed | catalog:effected | — |
