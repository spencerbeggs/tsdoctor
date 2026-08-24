---
"@tsdoctor/registry": minor
---

## Features

### New package, successor to `type-registry-effect`

`@tsdoctor/registry` is a new package that fetches, caches and resolves npm type definitions and builds `@typescript/vfs` environments for Twoslash-style documentation tooling. It succeeds `type-registry-effect@2.3.5`, developed in the `tsdoctor` monorepo, and carries forward the same public API, module layout, and peer dependency closure unchanged:

```typescript
// Before
import { TypeRegistry } from "type-registry-effect";

// After
import { TypeRegistry } from "@tsdoctor/registry";
```

`type-registry-effect` will be deprecated on npm with a pointer to this package; migrate by updating the import specifier and dependency name. `TypeRegistry`, `TypeCache`, `TypeResolver`, `PackageFetcher`, `PackageSpec`, `RegistryEvent`/`RegistryObserver`, `TsEnvironment`, `Vfs`, and `VirtualPackage` all keep their existing shape.
