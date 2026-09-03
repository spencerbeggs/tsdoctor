---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/import-generation-system.md
  - rspress-plugin-api-extractor/multi-entry-vfs.md
  - rspress-plugin-api-extractor/effect-service-layer.md
  - rspress-plugin-api-extractor/configuration-system.md
  - rspress-plugin-api-extractor/render-phase-instrumentation.md
  - rspress-plugin-api-extractor/vitepress-adapter.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
---

# Type loading and the virtual file system

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [The two packages](#the-two-packages)
- [TypeRegistryService](#typeregistryservice)
- [Integration flow](#integration-flow)
- [Per-scope TypeScript environments](#per-scope-typescript-environments)
- [Reading a tsconfig](#reading-a-tsconfig)
- [Compiler-option normalization](#compiler-option-normalization)
- [Package configuration](#package-configuration)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

The plugin loads external package type definitions and assembles a virtual file system for Twoslash's TypeScript compiler, which is what makes hover tooltips and type-checked examples possible. Two core packages divide the job: `@tsdoctor/vfs` owns the VFS primitives and the compiler-options seam, `@tsdoctor/registry` fetches, caches and resolves published package types into a `Vfs`. The adapter wraps the registry in `TypeRegistryService`, registers one TypeScript environment per distinct resolved compiler configuration and routes each code block to the environment its API is documented under.

## Current state

| Concern | Where it lives |
| --- | --- |
| `Vfs`, `mergeVfs` / `prefixVfs` / `isTypeDefinition`, `VirtualPackage`, `TsEnvironment` | `packages/vfs/src/` |
| Compiler-options seam: `parseTsConfig`, `TypeResolutionCompilerOptions`, `decodeCompilerOptions`, `toProgrammaticCompilerOptions`, `DEFAULT_COMPILER_OPTIONS`, `resolveTypeScriptConfig` | `packages/vfs/src/TsconfigParser.ts`, `TypeResolutionOptions.ts`, `TypeScriptConfig.ts` |
| The Twoslash result cache | `packages/vfs/src/TwoslashCache.ts` (`render-phase-instrumentation.md`) |
| Fetch, cache and resolve external types | `packages/registry/src/` (`TypeRegistry`, `TypeCache`, `PackageFetcher`, `RegistryObserver`) |
| The adapter's service over the registry | `platforms/rspress/src/services/TypeRegistryService.ts` |
| Per-scope environments | `platforms/rspress/src/services/TwoslashEnvironments.ts`, `layers/type-environment.ts`, `twoslash-access.ts` |
| Degrading external-type merge | `platforms/rspress/src/layers/external-types.ts` |
| Regression pins for the option seam | `packages/vfs/__test__/compiler-options-seam.test.ts`, `platforms/rspress/__test__/compiler-options-seam.test.ts` |

## The two packages

`@tsdoctor/vfs` depends on `effect` alone plus optional peers (`typescript`, `@typescript/vfs`, `@effected/tsconfig-json` and `@shikijs/twoslash` for the cache's interface type). `@tsdoctor/registry` sits on it and depends on `@effected/semver`, `@effected/store` and `@effected/xdg`; `@tsdoctor/model` sits on it independently for `VirtualPackage`, with no edge between the model and the registry in either direction. The registry ships no platform layer of its own — it composes at the edge — and its `Context.Service` ids are `"@tsdoctor/registry/..."`. Why the substrate was extracted rather than hosted in the registry is recorded in `tsdoctor-package-architecture.md`.

## TypeRegistryService

The shape has two members: `resolveVersions` turns each spec's range or npm tag into an exact published version, dropping any package that cannot be resolved (the CDN behind `loadPackages` requires exact versions), and `loadPackages` returns a `Vfs` or a `TypeRegistryError`. `TypeRegistryService.layer` composes the whole registry stack from module-level layer consts — never per call — over `layers/xdg.ts`'s shared platform and `AppDirs` namespace, a sqlite-backed `@effected/store` `Cache` for the metadata plane and `NodeHttpClient.layerUndici`. `resolveVersions` recovers from registry infrastructure failure (no HOME, an unwritable cache DB) by passing the specs through unresolved, so the failure surfaces from `loadPackages` with a meaningful error.

The library emits no logs of its own; observers are its only diagnostic surface. `RegistryObserverLayer` forwards the library's typed `RegistryEvent` union onto the plugin's event bus as `TypeRegistryEvent`, with `BatchComplete` at `info`, `PackageLoadFailed` at `warn` and everything else at `debug` so a normal build stays quiet.

## Integration flow

```text
ConfigService.resolve()
  +-> collect external packages (explicit + auto-detected from package.json)
  +-> TypeRegistryService.resolveVersions(packages)
  +-> TypeRegistryService.loadPackages(resolved) -> Vfs
  +-> prepend import statements to the VFS declarations (import-generation-system.md)
  +-> registerTypeEnvironments: one environment per distinct compiler config
  +-> VfsRegistry.register(apiScope, ...) for the remark plugins
```

Both registry calls are wrapped by `Effect.result` in `mergeExternalTypes` (`layers/external-types.ts`), the one phase of config resolution that degrades rather than fails: without external types, code blocks render without Twoslash enrichment and the build continues. `loadPackages` wraps any failure in `TypeRegistryError` (`Effect.catch`).

## Per-scope TypeScript environments

Each documented API is type-checked under the `tsconfig` / `compilerOptions` it declares. `registerTypeEnvironments` resolves every API's raw config (memoized by config, so APIs sharing a tsconfig read it once) and calls `registerEnvironment` once per distinct resolved configuration on `TwoslashEnvironments`. The service dedupes by a fingerprint of the encoded options, so APIs that agree share an environment and its language services. `registerScope(apiScope, compilerOptions)` records which configuration a scope is documented under, and `transformerFor(apiScope)` routes a block to that environment — falling back to the first environment registered for a block belonging to no documented scope, i.e. a `with-api` fence on a page outside any package's route.

Two consequences of this shape:

- **The fallback is the subsystem's most dangerous behaviour.** Every scope-routing bug degrades through it invisibly, so a test that only asserts "a transformer came back" asserts nothing; a registered scope must be asserted to get its own environment. The fingerprints computed by `registerEnvironment` and `registerScope` must agree — when they once drifted, every scope lookup missed, per-scope type-checking silently degraded to build-wide and the suite stayed green.
- **Access from the render pass goes through a holder, not a runtime.** `transformerFor` is called from the remark plugins, which RSPress invokes outside any fiber. `src/twoslash-access.ts` is a module-level holder installed from inside a fiber by `plugin.ts`. A runtime-bound accessor is not an option: the main runtime's layer is asynchronous to build, so `runSync` dies with `AsyncFiberError`, and moving the service to the sync-buildable runtime would yield two instances (layer memoization is per `ManagedRuntime`), with config resolution populating one and the render pass reading an empty other. Both failures are silent; the tell is the site build's own summary reporting `0 typechecked`. The holder is cleared at the start of each build beside `VfsRegistry.clear()` and the Twoslash type-route map, which otherwise accumulate across a dev session.

Resolution merges rather than replaces: `resolveTypeScriptConfig` starts from `DEFAULT_COMPILER_OPTIONS` and layers the global then the API config on top, so `{ strict: false }` on one API changes only that. It is a two-level cascade — `VersionConfig` carries no tsconfig level, because one that existed only in a signature type-checked every version against the defaults. The one exception to merging: a discovered tsconfig that declares `lib` replaces the array wholesale, which is why every `fromDir` site resolves to `lib: ["esnext"]` with no DOM.

**The file set stays shared.** Every API's declarations live under `node_modules/<packageName>/` in one combined VFS, and the import prepender emits `import type { X } from "B"` whenever package A references a type owned by another documented package B — those references resolve only because B is in the same environment. Per-scope environments differ in their compiler configuration, not in what they can see. A consequence: because the Twoslash result cache's generation key covers the whole VFS, a change to any package invalidates every package's cached blocks.

## Reading a tsconfig

`TsconfigParser.ts` is a thin adapter over `@effected/tsconfig-json`'s `TsconfigLoaderSync`, which owns `extends` chain resolution (including package-specifier extends), JSONC parsing and relative paths; the module does not import the TypeScript compiler. `parseTsConfig` narrows the loaded options to `TypeResolutionCompilerOptions` through a deliberate whitelist — passing through options the plugin does not understand would let a consumer's unrelated build setting change how examples type-check. The loader reports the tsconfig spelling (`target: "es2025"`, `lib: ["esnext"]`), which is why the normalization seam below exists.

## Compiler-option normalization

`lib` has two spellings: the tsconfig form users write (`["ESNext", "DOM"]`) and the programmatic file-name form TypeScript wants (`["lib.esnext.d.ts", …]`), and `target` / `module` / `moduleResolution` likewise. Both are accepted at one seam, `TypeResolutionOptions.ts`. `TypeResolutionCompilerOptions` is a `Schema.Struct` picked from `@effected/tsconfig-json`'s `CompilerOptions` — the kit owns which values are legal and how they are spelled, this package owns only which options are in scope — `decodeCompilerOptions` takes either spelling and returns the canonical one, and `toProgrammaticCompilerOptions` is the one conversion site, cast-free because a subset of the kit's own type is assignable to its encoder.

The seam closes a silent hole: when the two spellings met at a cast, three of four resolution paths loaded zero lib files, and with `noErrorValidation` swallowing the diagnostics the only symptom was degraded hovers (`Promise<number[]>` rendering as `Promise<{}>`) with zero warnings. Rules that follow:

- **Decode fails rather than guessing.** A value the enum tables cannot map surfaces as a `ConfigValidationError` that reaches `issues.json`; user-supplied `compilerOptions` arrive as `unknown` and are validated, not cast.
- **The environment fingerprint is computed on the encoded value**, otherwise `{lib:["ESNext"]}` and `{lib:["lib.esnext.d.ts"]}` build two identical environments.
- **`DEFAULT_COMPILER_OPTIONS` is written in the canonical tsconfig spelling**, including `DOM`, so the constant and a decoded config are directly comparable. Keeping `DOM` carries a known risk: `Event`, `Request`, `Response`, `URL` and friends are DOM globals and common library export names, so on a site with no tsconfig an example writing `const r: Response = …` for a library exporting its own `Response` resolves to DOM's and renders a confidently wrong hover. If that surfaces, the remedy is dropping `DOM` from the default.

The repo's own fixtures cannot reach the broken path — `@savvy-web/bundler` emits a `lib`-declaring tsconfig into every model folder — so the defect was consumer-facing only, and it is pinned by the synthetic four-path regression tests rather than a fixture build. Neither the suite nor an MDX diff can see hovers, which render after `config()` returns; hover parity across changes to this seam is measured on a fixture site with a cold Twoslash cache on both sides.

## Package configuration

External packages are configured explicitly via the `externalPackages` option (`{ name, version }` specs) or auto-detected from `package.json` via `autoDetectDependencies` (peer and/or regular dependencies); see `schemas/config.ts` and `config-utils.ts`.

## Rationale

- **Why a separate `@tsdoctor/vfs`:** `VirtualPackage` and `TsEnvironment` had no consumers inside the registry while the model needed them; hosting them in either package would have forced an unwanted edge.
- **Why external types degrade:** they are an enhancement; a docs build that fails because a CDN is down is worse than one with plain code blocks.
- **Why per-scope config but a shared file set:** correctness of `with-api` scoping needed the config split; cross-package references need the shared files. Splitting the files would sharpen cache invalidation but break those references, and is not planned.
- **Why a whitelist at the seam:** the set of options that may influence how a documentation example type-checks is a documentation-tool safety decision, not a tsconfig-grammar fact, so it stays here rather than upstream.

## Related documentation

- **Import statement generation for the VFS:** `import-generation-system.md`
- **Per-entry `.d.ts` generation:** `multi-entry-vfs.md`
- **The service layer and the degrading caches:** `effect-service-layer.md`
- **Where resolution runs:** `configuration-system.md`
- **The Twoslash result cache hosted in `@tsdoctor/vfs`:** `render-phase-instrumentation.md`
- **The second consumer of the seam:** `vitepress-adapter.md`
- **The package split decision:** `tsdoctor-package-architecture.md`
