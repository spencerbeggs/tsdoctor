---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 85
related:
  - rspress-plugin-api-extractor/import-generation-system.md
  - rspress-plugin-api-extractor/multi-entry-vfs.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
dependencies: []
---

# Type Loading & Virtual File System (VFS)

## Table of Contents

- [Overview](#overview)
  - [Effect Service Architecture](#effect-service-architecture)
- [Architecture](#architecture)
  - [TypeRegistryService Interface](#typeregistryservice-interface)
  - [Edge-composed registry stack](#edge-composed-registry-stack)
  - [Registry event observer](#registry-event-observer)
  - [Integration Flow](#integration-flow)
  - [VFS in the Build Pipeline](#vfs-in-the-build-pipeline)
  - [Per-scope TypeScript environments](#per-scope-typescript-environments)
  - [Reading a tsconfig](#reading-a-tsconfig)
  - [Compiler-option normalization](#compiler-option-normalization)
- [Virtual File System (VFS)](#virtual-file-system-vfs)
- [Package Configuration](#package-configuration)
- [Error Handling](#error-handling)
- [Related Documentation](#related-documentation)

## Overview

The RSPress API Extractor plugin loads external package type definitions and assembles a virtual file system (VFS) for TypeScript's Twoslash compiler, which is what makes hover tooltips and type-checked code examples possible in generated API documentation. Two workspaces divide that job:

- **`@tsdoctor/vfs`** (`packages/vfs`) owns the VFS *primitives*: the `Vfs` currency type with `mergeVfs` / `prefixVfs` / `isTypeDefinition`, the `VirtualPackage` Schema class, `TsEnvironment`, the compiler-options seam and — since phase 5 — the Twoslash result cache (`TwoslashCache.ts`: the keying scheme, the generation codec and the in-memory `TwoslashTypesCache`, moved out of the RSPress adapter so both adapters share one cache; see `render-phase-instrumentation.md`). It depends on `effect` alone, plus four optional peers (`typescript`, `@typescript/vfs`, `@effected/tsconfig-json`, and `@shikijs/twoslash` for the cache's interface type).
- **`@tsdoctor/registry`** (`packages/registry`; formerly the external `type-registry-effect@2`, the Effect v4 port — moved in and renamed during the phase 1 consolidation, see `monorepo-consolidation.md`) fetches, caches and resolves published package types INTO a `Vfs`. It sits on `@tsdoctor/vfs` and shed the `typescript`, `@typescript/vfs` and `@effected/tsconfig-json` optional peers when `TsEnvironment` moved out.

The split was measured, not assumed: `VirtualPackage` and `TsEnvironment` had zero consumers inside the registry while `@tsdoctor/model` needed them, and hosting them there would have forced an unwanted edge in one direction or the other. See "The D1 outcome" in `tsdoctor-package-architecture.md`.

### Effect Service Architecture

Type loading uses the Effect service pattern:

- **`TypeRegistryService`** (`services/TypeRegistryService.ts`) — the interface defining `resolveVersions` and `loadPackages`, and, as a static on the same class, **`TypeRegistryService.layer`** — the implementation using `@tsdoctor/registry` Effect programs directly. There is no separate `*ServiceLive.ts` module: services own their layers.

The library (since v2) has no `/node` subpath and ships **no platform layer of its own** — it composes at the edge, so `TypeRegistryService.layer` wires the whole stack itself. Library statics also became instance methods: the service yields the `TypeRegistry` tag and calls `registry.getVfs(...)` / `registry.resolveVersion(...)`.

## Architecture

### TypeRegistryService Interface

```typescript
export interface TypeRegistryServiceShape {
  /**
   * Resolve each package's version spec (range / npm tag) to an exact
   * published version, dropping any package that cannot be resolved.
   * The CDN backing loadPackages requires exact versions.
   */
  readonly resolveVersions: (
    packages: ReadonlyArray<ExternalPackageSpec>,
  ) => Effect.Effect<ReadonlyArray<ExternalPackageSpec>>;

  readonly loadPackages: (
    packages: ReadonlyArray<ExternalPackageSpec>,
  ) => Effect.Effect<TypeRegistryResult, TypeRegistryError>;
}
```

There is no `createTypeScriptCache` method. (Earlier revisions of this document described one; it has never existed on this interface in the current codebase.)

### Edge-composed registry stack

`TypeRegistryService.layer` builds the registry runtime from module-level layer consts — never rebuilt per call, per the v4 layer memoization discipline:

```typescript
const PlatformLive = Layer.mergeAll(NodeFileSystem.layer, Path.layer);

/** XDG app dirs under the tsdoctor-wide namespace. Renamed from the legacy
 *  "type-registry-effect" namespace in phase 2 per the resolved identity
 *  decision (see tsdoctor-package-architecture.md) — a deliberate one-time
 *  on-disk cache invalidation (cold refetch), accepted. The @tsdoctor/bundle
 *  fetch caches share the same namespace. */
const AppDirsLive = AppDirs.layer({ namespace: "tsdoctor" }).pipe(
  Layer.provide(Layer.mergeAll(Xdg.layer, PlatformLive)),
);

/** Metadata plane: sqlite-backed @effected/store Cache in the XDG cache dir. */
const MetadataCacheLive = Layer.unwrap(
  Effect.gen(function* () {
    const appDirs = yield* AppDirs;
    const path = yield* Path.Path;
    const cacheDir = yield* appDirs.ensureCache;
    return Cache.layerSqlite({
      filename: path.join(cacheDir, "metadata.sqlite"),
    });
  }),
).pipe(Layer.provide(Layer.mergeAll(AppDirsLive, PlatformLive)));

const RegistryLayer = TypeRegistry.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(TypeCache.layerXdg(), PackageFetcher.layer)),
  Layer.provideMerge(RegistryObserverLayer),
  Layer.provide(Layer.mergeAll(
    MetadataCacheLive, AppDirsLive, PlatformLive, NodeHttpClient.layerUndici,
  )),
);
```

Both service methods run their program with `Effect.provide(RegistryLayer)`. `resolveVersions` recovers from registry infrastructure failure (no HOME for XDG, unwritable cache DB) by passing the specs through unresolved, so the failure surfaces from `loadPackages` with a meaningful error rather than being silently swallowed.

### Registry event observer

The library emits no logs of its own — observers are the only diagnostic surface. `RegistryObserverLayer` (`Layer.succeed(RegistryObserver, ...)`) forwards the library's typed events onto the plugin's EventBus as `PluginEvent.TypeRegistryEvent`, so registry activity flows through the plugin's configured log level and format.

In v2 the tag is `RegistryObserver` (was `TypeRegistryObserver`) and `RegistryEvent` is a **Schema union with no `$match`**, so the observer is a plain `switch` on `event._tag`. Levels: `BatchComplete` at `info`, `PackageLoadFailed` at `warn`, everything else (version resolution, cache hit/miss/stale, fetch start/failure, per-package load, batch start) at `debug` so a normal build stays quiet.

### Integration Flow

```text
ConfigService.resolve()
    |
    +-> Collect external packages from plugin options
    |   (explicit + auto-detected from package.json)
    |
    +-> TypeRegistryService.resolveVersions(packages)
    |   -> registry.resolveVersion(name, spec) per package
    |   -> ranges/tags become exact versions; unresolvable specs dropped
    |
    +-> TypeRegistryService.loadPackages(resolvedPackages)
    |   -> registry.getVfs(specs, { autoFetch: true })
    |   -> Returns a Vfs (@tsdoctor/vfs; a Map<string, string>)
    |
    +-> Prepend import statements to VFS declaration files
    |   (TypeReferenceExtractor)
    |
    +-> Combined VFS registered with TwoslashEnvironments
    |   -> TypeScript language service resolves all references
    |
    +-> VFS config registered in VfsRegistry per API scope
```

Both calls are wrapped by `Effect.result` in `mergeExternalTypes` (`layers/external-types.ts`), so a type load failure degrades the build (code blocks render without Twoslash enhancements) rather than aborting it. That module is the only phase of config resolution that degrades rather than failing; it takes the registry as an argument instead of yielding the tag, because `ConfigService.layer` already resolved it once at layer construction. `VirtualTypeScriptEnvironment` is now imported from `@typescript/vfs` directly, since v2 dropped the `/node` subpath that used to re-export it.

### VFS in the Build Pipeline

The VFS is consumed in two places:

1. **`TwoslashEnvironments`** -- Provides type information for Twoslash processing of code blocks (hover tooltips, type annotations)

2. **VfsRegistry** -- Makes VFS config available to remark plugins (`remarkWithApi`, `remarkApiCodeblocks`) for user-authored code blocks

### Per-scope TypeScript environments

Each documented API is type-checked under the `tsconfig` / `compilerOptions` it declares. `registerTypeEnvironments` (`layers/type-environment.ts`, called from config resolution) resolves every API's raw config (memoised by config, so N APIs sharing a tsconfig read it once) and calls `registerEnvironment` once per DISTINCT resolved configuration on the **`TwoslashEnvironments` service** (`services/TwoslashEnvironments.ts`, which owns its layer as `TwoslashEnvironments.layer`). The service dedupes by a fingerprint of the ENCODED options (see [Compiler-option normalization](#compiler-option-normalization)), so APIs that agree on their config share an environment and the TypeScript language services built under it. `registerScope(apiScope, compilerOptions)` records which configuration a scope is documented under, and `transformerFor(apiScope)` routes a block to that environment — falling back to the FIRST environment registered for a block belonging to no documented scope, i.e. a `with-api` fence on a page outside any package's route.

This replaces `TwoslashManager`, a `private constructor` + `getInstance()` singleton with mutable state and a hand-rolled static `reset()` standing in for layer substitution. Two consequences of the service form are worth stating:

- **The fallback is the subsystem's most dangerous behaviour.** Every scope-routing bug degrades through it invisibly, so a test that only asserts "a transformer came back" asserts nothing. A registered scope must be asserted to get its OWN environment. The fingerprints computed by `registerEnvironment` and `registerScope` MUST agree; when they drifted apart once, every scope lookup missed, per-scope type-checking silently degraded to build-wide, and a 994-test suite stayed green through it.
- **Access from the render pass goes through a holder, not a runtime.** `transformerFor` is called from the remark plugins, which RSPress invokes during the render pass outside any fiber. `src/twoslash-access.ts` is a module-level holder — the shape the since-deleted `markdown/prose-linker.ts` had — installed from **inside** a fiber by `plugin.ts` (`installTwoslashAccess(yield* TwoslashEnvironments)`). A runtime-bound accessor is not an option and must not be "fixed" back into one: the main runtime's layer is asynchronous to build, so `runSync` dies with `AsyncFiberError`; and moving the service to the small sync-buildable runtime yields TWO instances, because layer memoization is per-`ManagedRuntime` `MemoMap` — config resolution would populate one registry and the render pass would read a different, empty one, returning `null` for every block. Both failures are silent. The tell that the holder was never installed is the site build's own summary: `(unscoped): 18 blocks … 0 typechecked` instead of `18 typechecked`.

The holder is cleared at the start of each build alongside `VfsRegistry.clear()` and `clearTypeRoutes()`. That last one matters for dev HMR: the module-level Twoslash type-route map used to accumulate for the process lifetime, so routes for renamed or deleted items survived across a dev session and every scope's routes merged into one global map.

Resolution merges rather than replaces: `resolveTypeScriptConfig` (`@tsdoctor/vfs`) starts from `DEFAULT_COMPILER_OPTIONS` and layers the global then the API config on top, so declaring `{ strict: false }` on one API changes only that. **The version and per-package levels are gone**: they were in the signature but nothing ever passed them, so a multiVersion site silently type-checked every version against the defaults while `VersionConfig` advertised a `tsconfig` field that could not take effect. Both the unwired parameters and the `VersionConfig` fields are deleted rather than wired — nothing asked for them, and a level that exists only in a signature is worse than no level at all. Note the one exception: a discovered tsconfig that **declares `lib`** replaces the array wholesale rather than merging, which is why every `fromDir` site resolves to `lib: ["esnext"]` — `lib.esnext.d.ts` once normalized at the seam — with no DOM.

### Reading a tsconfig

`TsconfigParser.ts` (`@tsdoctor/vfs`, moved out of the adapter in the Tier 1 core moves) is a thin adapter over `@effected/tsconfig-json`'s `TsconfigLoaderSync`, which owns `extends` chain resolution, JSONC parsing and relative-path handling. The module no longer imports the TypeScript compiler at all, and shrank from 234 lines to 136. `parseTsConfig` narrows the loaded options to `TypeResolutionCompilerOptions` through a deliberate **whitelist** — everything that passes reaches Twoslash's TypeScript environment, and passing through options the plugin does not understand would let a consumer's unrelated build setting change how examples type-check.

**The loader reports the tsconfig spelling, not the programmatic one.** `target` comes back as `"es2025"` rather than `ts.ScriptTarget.ES2025`, and `lib` as `["esnext"]` rather than `["lib.esnext.d.ts"]`; TypeScript's `parseJsonConfigFileContent`, which this replaced, returned the programmatic form. `decodeCompilerOptions` accepts both spellings and `toProgrammaticCompilerOptions` remains the ONE conversion site. That is why the normalization seam below was a hard precondition for this change rather than a nicety: without it, swapping the loader would have moved a spelling across a boundary that had no converter.

`parseTsConfigWithMetadata` and its `extendedPaths` result are **deleted**. They had zero consumers, and the `resolveExtendedPath` behind them returned a bare package specifier verbatim as if it were a file path, so the extends chain it reported was wrong for exactly the case a chain report is for. The kit resolves package-specifier extends correctly.

Verification worth recording, because a green suite could not establish it: a passing test suite and an MDX golden diff both leave hovers unmeasured — hovers are rendered to HAST after `config()` returns. Hover parity was measured instead on `sites/multi` with a **cold** Twoslash cache on both sides (`XDG_CACHE_HOME` pointed at a temp dir, Twoslash genuinely running for ~8.8s): 226 hovers before the swap, 226 after.

### Compiler-option normalization

`lib` has two spellings. The tsconfig JSON form (`["ESNext", "DOM"]`) is what users write and what `DEFAULT_COMPILER_OPTIONS` (`@tsdoctor/vfs`'s `TypeScriptConfig.ts`) holds; TypeScript's programmatic `ts.CompilerOptions.lib` wants file names (`["lib.esnext.d.ts", "lib.dom.d.ts"]`). The two used to meet at a raw `as ts.CompilerOptions` cast, so **three of four resolution paths loaded zero lib files** — `ts.parseJsonConfigFileContent` does not populate `options.lib` when the tsconfig omits the key, so having a tsconfig was not enough; it had to declare `lib`.

The consequence was silent. `handbookOptions.noErrorValidation: true` swallows the diagnostics, so nothing appears in `issues.json`, the console summary or the render-phase artifact. The tell is **degraded hovers, not errors**: with no `Array<T>` in scope, `const filtered: number[]` renders as `const filtered: {}` and `Promise<number[]>` as `Promise<{}>`. Measured on a fixture, 27 hovers vanished while the build still reported zero warnings.

Both spellings are now accepted at ONE seam, in **`@tsdoctor/vfs`** (`TypeResolutionOptions.ts`), beside the `TsEnvironment` they configure.

`TypeResolutionCompilerOptions` is a `Schema.Struct` **picked from `@effected/tsconfig-json`'s `CompilerOptions`**, not a hand-written interface: the kit owns which values are legal and how they are spelled, and this package owns only which options are in scope. `decodeCompilerOptions` takes either spelling and returns the canonical one; `toProgrammaticCompilerOptions` encodes it for the compiler and **carries no cast**, because a subset of the kit's own type is assignable to the kit's own encoder by construction.

The earlier form — a hand-rolled dual-spelling interface plus `TsEnumCodec.encodeCompilerOptions(options as never)` — is gone. That cast was standing in for missing validation, which is now the codec's job (raised upstream as dogfood candidate (g); see `tsdoctor-package-architecture.md`).

**Decode fails rather than guessing.** A value the enum tables cannot map is rejected, surfacing as a `ConfigValidationError` that reaches `issues.json`. This closes a real hole: user-supplied `compilerOptions` arrive as `unknown` and were *cast* into the options type, so a value the compiler could not act on reached the environment unchecked. Two rules follow:

- **The environment fingerprint is computed on the ENCODED value.** Otherwise `{lib:["ESNext"]}` and `{lib:["lib.esnext.d.ts"]}` build two identical TypeScript environments — a silent cache regression on multi-API sites.
- **`DEFAULT_COMPILER_OPTIONS` is written in the canonical tsconfig spelling**, including `DOM`. It previously *claimed* that spelling while mixing numeric enums for `target`/`module`/`moduleResolution` with tsconfig strings for `lib` — exactly the confusion the decode step removes. The encoded values are unchanged. Keep it in the tsconfig spelling, which is what users write in their own `tsconfig.json` — it is now the same spelling `decodeCompilerOptions` returns, so the constant and a decoded config are directly comparable.

Keeping `DOM` in the default carries a known, accepted risk: `Event`, `Request`, `Response`, `Headers`, `URL`, `Blob` and `File` are DOM globals *and* common library export names, so on a site with no tsconfig an example writing `const r: Response = …` for a library exporting its own `Response` resolves to DOM's and renders a confidently wrong hover rather than a `TS2304`. If that surfaces, the remedy is dropping `DOM` from the default.

This repo could not reach the broken spelling — `@savvy-web/bundler` emits a `lib`-declaring `tsconfig.json` into every model folder — so the defect was consumer-facing only, for a bundle whose model folder carries no tsconfig. It is pinned by a synthetic four-path regression test (`platforms/rspress/__test__/compiler-options-seam.test.ts`, which compiles each resolution path with the real `ts`) plus the seam's own tests in `packages/vfs/__test__/compiler-options-seam.test.ts` — not by any fixture build.

**The FILE set stays shared.** Every API's declarations live under `node_modules/<packageName>/` in one combined VFS, and the import prepender emits `import type { X } from "B"` whenever package A references a type owned by another documented package B — those references resolve only because B is in the same environment. Per-scope environments differ in their compiler *configuration*, not in what they can see. A consequence worth knowing: because the Twoslash result cache's generation key covers the whole VFS (`render-phase-instrumentation.md`), a change to any package still invalidates every package's cached blocks. Splitting the file set would sharpen that, but it would break cross-package references and is not planned.

This retires the former limitation, under which the first API in the `apis` array that provided a `tsconfig` won for the whole build and a `ConfigCascadeWarning` was emitted when the others differed.

## Virtual File System (VFS)

`Vfs` (`@tsdoctor/vfs`) is the currency type both halves speak: a `Map<string, string>` mapping file paths to TypeScript source code. `mergeVfs` combines two, `prefixVfs` mounts one under a directory, `isTypeDefinition` screens a path. The former `VirtualFileSystem` alias is deleted — one name for one type.

```text
node_modules/
+-- zod/
|   +-- package.json
|   +-- index.d.ts
|   +-- lib/
|       +-- types.d.ts
+-- @effect/
    +-- schema/
        +-- package.json
        +-- dist/
            +-- index.d.ts
```

## Package Configuration

External packages are configured in plugin options:

```typescript
apiExtractor({
  externalPackages: [
    { name: "zod", version: "^3.22.4" },
    { name: "@effect/schema", version: "^0.68.0" },
  ],
})
```

Auto-detection from `package.json` is also supported via `autoDetectDependencies`:

```typescript
apiExtractor({
  autoDetectDependencies: {
    peerDependencies: true,
    autoDependencies: true,
  },
})
```

## Error Handling

`loadPackages` catches any failure (`Effect.catch`) and wraps it in `TypeRegistryError`:

```typescript
new PluginTypeRegistryError({
  packageName: packages.map((p) => p.name).join(", "),
  version: packages.map((p) => p.version).join(", "),
  reason: error instanceof Error ? (error.message ?? String(error)) : String(error),
})
```

Errors propagate through the Effect pipeline and are inspected in `layers/external-types.ts` via `Effect.result` (the v4 replacement for `Effect.either`; a `Result` with `_tag: "Failure"` and `.failure`). The build continues without type information if loading fails — code blocks render without Twoslash enhancements.

## Related Documentation

- **Import Generation System:** `import-generation-system.md` -- Import statement generation for VFS
- **Multi-Entry VFS:** `multi-entry-vfs.md` -- VFS `.d.ts` generation for multi-entry packages
- **Render-Phase Instrumentation:** `render-phase-instrumentation.md` -- the Twoslash result cache now hosted in `@tsdoctor/vfs`
- **Build Architecture:** `build-architecture.md` -- Service layer and plugin structure
