---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 85
related:
  - rspress-plugin-api-extractor/import-generation-system.md
  - rspress-plugin-api-extractor/multi-entry-vfs.md
  - rspress-plugin-api-extractor/build-architecture.md
dependencies: []
---

# Type Loading & Virtual File System (VFS)

## Overview

The RSPress API Extractor plugin integrates with `@tsdoctor/registry` (the
in-repo workspace at `packages/registry`, consumed via `workspace:*`; formerly
the external `type-registry-effect@2`, the Effect v4 port — moved in and
renamed during the phase 1 consolidation, see `monorepo-consolidation.md`) to
load external package type definitions and generate
virtual file systems (VFS) for TypeScript's Twoslash compiler. This enables
rich hover tooltips and type-checked code examples in generated API
documentation.

### Effect Service Architecture

Type loading uses the Effect service pattern:

- **`TypeRegistryService`** (`services/TypeRegistryService.ts`) --
  Interface defining `resolveVersions` and `loadPackages`
- **`TypeRegistryServiceLive`** (`layers/TypeRegistryServiceLive.ts`) --
  Implementation using `@tsdoctor/registry` Effect programs directly

The library (since v2) has no `/node` subpath and ships **no platform layer of its own** —
it composes at the edge, so `TypeRegistryServiceLive` wires the whole stack
itself. Library statics also became instance methods: the service yields the
`TypeRegistry` tag and calls `registry.getVfs(...)` / `registry.resolveVersion(...)`.

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

There is no `createTypeScriptCache` method. (Earlier revisions of this document
described one; it has never existed on this interface in the current codebase.)

### Edge-composed registry stack

`TypeRegistryServiceLive` builds the registry runtime from module-level layer
consts — never rebuilt per call, per the v4 layer memoization discipline:

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

Both service methods run their program with `Effect.provide(RegistryLayer)`.
`resolveVersions` recovers from registry infrastructure failure (no HOME for
XDG, unwritable cache DB) by passing the specs through unresolved, so the
failure surfaces from `loadPackages` with a meaningful error rather than being
silently swallowed.

### Registry event observer

The library emits no logs of its own — observers are the only diagnostic
surface. `RegistryObserverLayer` (`Layer.succeed(RegistryObserver, ...)`)
forwards the library's typed events onto the plugin's EventBus as
`PluginEvent.TypeRegistryEvent`, so registry activity flows through the
plugin's configured log level and format.

In v2 the tag is `RegistryObserver` (was `TypeRegistryObserver`) and
`RegistryEvent` is a **Schema union with no `$match`**, so the observer is a
plain `switch` on `event._tag`. Levels: `BatchComplete` at `info`,
`PackageLoadFailed` at `warn`, everything else (version resolution, cache
hit/miss/stale, fetch start/failure, per-package load, batch start) at `debug`
so a normal build stays quiet.

### Integration Flow

```text
ConfigServiceLive.resolve()
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
    |   -> Returns VirtualFileSystem (Map<string, string>)
    |
    +-> Prepend import statements to VFS declaration files
    |   (TypeReferenceExtractor)
    |
    +-> Combined VFS registered with TwoslashEnvironments
    |   -> TypeScript language service resolves all references
    |
    +-> VFS config registered in VfsRegistry per API scope
```

Both calls are wrapped by `Effect.result` in `ConfigServiceLive`, so a type
load failure degrades the build (code blocks render without Twoslash
enhancements) rather than aborting it. `VirtualTypeScriptEnvironment` is now
imported from `@typescript/vfs` directly, since v2 dropped the `/node` subpath
that used to re-export it.

### VFS in the Build Pipeline

The VFS is consumed in two places:

1. **`TwoslashEnvironments`** -- Provides type information for Twoslash
   processing of code blocks (hover tooltips, type annotations)

2. **VfsRegistry** -- Makes VFS config available to remark plugins
   (`remarkWithApi`, `remarkApiCodeblocks`) for user-authored code blocks

### Per-scope TypeScript environments

Each documented API is type-checked under the `tsconfig` / `compilerOptions` it declares. `ConfigServiceLive` resolves every API's raw config (memoised by config, so N APIs sharing a tsconfig read it once) and calls `registerEnvironment` once per DISTINCT resolved configuration on the **`TwoslashEnvironments` service** (`services/TwoslashEnvironments.ts`, live layer `layers/TwoslashEnvironmentsLive.ts`). The service dedupes by a fingerprint of the ENCODED options (see [Compiler-option normalization](#compiler-option-normalization)), so APIs that agree on their config share an environment and the TypeScript language services built under it. `registerScope(apiScope, compilerOptions)` records which configuration a scope is documented under, and `transformerFor(apiScope)` routes a block to that environment — falling back to the FIRST environment registered for a block belonging to no documented scope, i.e. a `with-api` fence on a page outside any package's route.

This replaces `TwoslashManager`, a `private constructor` + `getInstance()` singleton with mutable state and a hand-rolled static `reset()` standing in for layer substitution. Two consequences of the service form are worth stating:

- **The fallback is the subsystem's most dangerous behaviour.** Every scope-routing bug degrades through it invisibly, so a test that only asserts "a transformer came back" asserts nothing. A registered scope must be asserted to get its OWN environment. The fingerprints computed by `registerEnvironment` and `registerScope` MUST agree; when they drifted apart once, every scope lookup missed, per-scope type-checking silently degraded to build-wide, and a 994-test suite stayed green through it.
- **Access from the render pass goes through a holder, not a runtime.** `transformerFor` is called from the remark plugins, which RSPress invokes during the render pass outside any fiber. `src/twoslash-access.ts` is a module-level holder — the same shape as `markdown/prose-linker.ts` — installed from **inside** a fiber by `plugin.ts` (`installTwoslashAccess(yield* TwoslashEnvironments)`). A runtime-bound accessor is not an option and must not be "fixed" back into one: the main runtime's layer is asynchronous to build, so `runSync` dies with `AsyncFiberError`; and moving the service to the small sync-buildable runtime yields TWO instances, because layer memoization is per-`ManagedRuntime` `MemoMap` — `ConfigServiceLive` would populate one registry and the render pass would read a different, empty one, returning `null` for every block. Both failures are silent. The tell that the holder was never installed is the site build's own summary: `(unscoped): 18 blocks … 0 typechecked` instead of `18 typechecked`.

The holder is cleared at the start of each build alongside `VfsRegistry.clear()` and `clearTypeRoutes()`. That last one matters for dev HMR: the module-level Twoslash type-route map used to accumulate for the process lifetime, so routes for renamed or deleted items survived across a dev session and every scope's routes merged into one global map.

Resolution merges rather than replaces: `resolveTypeScriptConfig` starts from `DEFAULT_COMPILER_OPTIONS` and layers global, API, version and package overrides on top, so declaring `{ strict: false }` on one API changes only that. Note the one exception: a discovered tsconfig that **declares `lib`** replaces the array wholesale rather than merging, which is why every `fromDir` site resolves to `["lib.esnext.d.ts"]` with no DOM.

### Compiler-option normalization

`lib` has two spellings. The tsconfig JSON form (`["ESNext", "DOM"]`) is what users write and what `DEFAULT_COMPILER_OPTIONS` (`typescript-config.ts`) holds; TypeScript's programmatic `ts.CompilerOptions.lib` wants file names (`["lib.esnext.d.ts", "lib.dom.d.ts"]`). The two used to meet at a raw `as ts.CompilerOptions` cast, so **three of four resolution paths loaded zero lib files** — `ts.parseJsonConfigFileContent` does not populate `options.lib` when the tsconfig omits the key, so having a tsconfig was not enough; it had to declare `lib`.

The consequence was silent. `handbookOptions.noErrorValidation: true` swallows the diagnostics, so nothing appears in `issues.json`, the console summary or the render-phase artifact. The tell is **degraded hovers, not errors**: with no `Array<T>` in scope, `const filtered: number[]` renders as `const filtered: {}` and `Promise<number[]>` as `Promise<{}>`. Measured on a fixture, 27 hovers vanished while the build still reported zero warnings.

Both spellings are now accepted and normalized at ONE seam, `toProgrammaticCompilerOptions` in `twoslash-transformer.ts`, whose body is `TsEnumCodec.encodeCompilerOptions` from `@effected/tsconfig-json`. The cast is gone, and the file no longer imports `typescript` at all. Two rules follow:

- **The environment fingerprint is computed on the ENCODED value.** Otherwise `{lib:["ESNext"]}` and `{lib:["lib.esnext.d.ts"]}` build two identical TypeScript environments — a silent cache regression on multi-API sites.
- **`DEFAULT_COMPILER_OPTIONS` deliberately keeps the tsconfig spelling** (decided 2026-08-25), including `DOM`. Normalization at the seam is what finally makes the declared default effective; do not renormalize the constant, so it reads in the same spelling users write in their own `tsconfig.json`.

Keeping `DOM` in the default carries a known, accepted risk: `Event`, `Request`, `Response`, `Headers`, `URL`, `Blob` and `File` are DOM globals *and* common library export names, so on a site with no tsconfig an example writing `const r: Response = …` for a library exporting its own `Response` resolves to DOM's and renders a confidently wrong hover rather than a `TS2304`. If that surfaces, the remedy is dropping `DOM` from the default.

This repo could not reach the broken spelling — `@savvy-web/bundler` emits a `lib`-declaring `tsconfig.json` into every model folder — so the defect was consumer-facing only, for a bundle whose model folder carries no tsconfig. It is pinned by a synthetic four-path regression test (`__test__/compiler-options-seam.test.ts`) rather than by any fixture build.

**The FILE set stays shared.** Every API's declarations live under `node_modules/<packageName>/` in one combined VFS, and the import prepender emits `import type { X } from "B"` whenever package A references a type owned by another documented package B — those references resolve only because B is in the same environment. Per-scope environments differ in their compiler *configuration*, not in what they can see. A consequence worth knowing: because the Twoslash result cache's generation key covers the whole VFS (`render-phase-instrumentation.md`), a change to any package still invalidates every package's cached blocks. Splitting the file set would sharpen that, but it would break cross-package references and is not planned.

This retires the former limitation, under which the first API in the `apis` array that provided a `tsconfig` won for the whole build and a `ConfigCascadeWarning` was emitted when the others differed.

## Virtual File System (VFS)

The VFS is a `Map<string, string>` mapping file paths to TypeScript
source code:

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

Auto-detection from `package.json` is also supported via
`autoDetectDependencies`:

```typescript
apiExtractor({
  autoDetectDependencies: {
    peerDependencies: true,
    autoDependencies: true,
  },
})
```

## Error Handling

`loadPackages` catches any failure (`Effect.catch`) and wraps it in
`TypeRegistryError`:

```typescript
new PluginTypeRegistryError({
  packageName: packages.map((p) => p.name).join(", "),
  version: packages.map((p) => p.version).join(", "),
  reason: error instanceof Error ? (error.message ?? String(error)) : String(error),
})
```

Errors propagate through the Effect pipeline and are inspected in
`ConfigServiceLive` via `Effect.result` (the v4 replacement for
`Effect.either`; a `Result` with `_tag: "Failure"` and `.failure`). The build
continues without type information if loading fails — code blocks render
without Twoslash enhancements.

## Related Documentation

- **Import Generation System:**
  `import-generation-system.md` -- Import statement generation for VFS
- **Multi-Entry VFS:**
  `multi-entry-vfs.md` -- VFS `.d.ts` generation for multi-entry packages
- **Build Architecture:**
  `build-architecture.md` -- Service layer and plugin structure
