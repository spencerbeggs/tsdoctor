---
"rspress-plugin-api-extractor": minor
"@tsdoctor/vfs": minor
"@tsdoctor/model": minor
---

## Breaking Changes

Compatibility shims and dead configuration are removed. Nothing here had a consumer outside this repository.

| Removed | Use instead |
| --- | --- |
| `VirtualFileSystem` (`@tsdoctor/vfs`) | `Vfs` — it was an alias kept for a finished migration |
| `ApiExtractedPackage.generateVfs()` (`@tsdoctor/model`) | `toVfs()` — the alias delegated to it |
| `logLevel` plugin option | `observability.logLevel` |
| `performance` plugin option | `observability.thresholds` |
| `VersionConfig.tsconfig` / `VersionConfig.compilerOptions` | nothing — see below |

`VersionConfig`'s two TypeScript fields are removed rather than deprecated because **nothing ever read them**. `resolveTypeScriptConfig` accepted version-level and package-level configuration, but its single production caller passed neither, and `rawTsConfig` only ever collected those fields from an API config. A version's discovered `tsconfig.json` was silently dropped, so a multi-version site type-checked every version's examples against the default compiler options. The unused cascade levels are gone with them; the cascade is now defaults, global, API.

## Refactoring

- Delete `ShikiCrossLinker`'s API-item-kind map. Its only consumer was `getSemanticClass`, a deprecated method whose body was `return null`, so seven call sites computed a class name that could only be null. Removing it took the kinds map, its constructor parameter and the third argument of `fromRoutes` with it.
- Delete the `DeprecatedConfigUsed` event and the `deprecations` channel that carried it, now that no option is deprecated. An event variant with no emitter is a second vocabulary beside the real one.
- Delete `PerformanceConfig`, whose only remaining reference was its own test.
