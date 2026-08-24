# @tsdoctor/registry

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
