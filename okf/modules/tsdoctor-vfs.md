---
type: Module
title: "@tsdoctor/vfs"
description: Virtual file system primitives, the compiler-options seam and the persisted Twoslash result cache both adapters share.
kind: package
layer: L1
resource: ../../packages/vfs
status: stable
tags: [architecture, performance, compat]
sources:
  - id: src
    resource: ../../packages/vfs/src
    last_modified: 2026-09-13T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-24T20:28:47Z
  body_sha256: 3e659a82cfcb1e6ab5c2cc5d5101f2979ab144900276bfe6452d29018d32717e
---

# @tsdoctor/vfs

## Boundary and purpose

`@tsdoctor/vfs` is the substrate `@tsdoctor/registry` and `@tsdoctor/model`
share so neither depends on the other: the registry fetches third-party
declarations into a `Vfs`, the model reconstructs declarations from an API
model, and neither package needs to know about the other's stack.[^src] It
was factored out of `@tsdoctor/registry`, moved verbatim (Twoslash hover
output byte-for-byte unchanged across the move, 230 hovers over the `multi`
fixture checked before and after).

It depends on `effect` alone plus three optional peers reached only through
lazy `import()` or type-only imports: `typescript`, `@typescript/vfs` (both
lazy-imported in `TsEnvironment.ts`) and `@shikijs/twoslash` (a type-only
import for `TwoslashTypesCache` in `TwoslashCache.ts`). `@effected/tsconfig-json`
is a required peer (`catalog:effected:peers`), not an optional one: its
`CompilerOptions` types appear in this package's public `.d.ts` surface, and
`TypeResolutionOptions.ts` value-imports it and evaluates
`CompilerOptions.schema.fields` at module load. Because it is a
public-surface peer, it propagates. `@tsdoctor/model` and
`@tsdoctor/registry` redeclare it as their own peer, and so does
`@tsdoctor/pages` through the model (see
[core-peers-follow-public-surface](../decisions/core-peers-follow-public-surface.md)).

## Layer cake

Nothing in the monorepo depends on this package except `@tsdoctor/registry`
and `@tsdoctor/model` (`workspace:*`, for `VirtualPackage`), and — through
those two — both adapters (`platforms/rspress`, `platforms/vitepress`). This
package depends on nothing else in the monorepo. It sits below both
consumers in the layer cake precisely because it has no dependents that
would force it to know about npm fetching (the registry's job) or the
api.json vocabulary (the model's job).

## Public surface

All re-exported from `src/index.ts`:[^src]

- `Vfs`, `mergeVfs`, `prefixVfs`, `isTypeDefinition` — `src/Vfs.ts`. `Vfs` is
  a `Map<string, string>` of `node_modules/`-prefixed paths to file
  contents, and it is the **one** currency type every VFS-shaped API in the
  monorepo speaks. There is no `VirtualFileSystem` alias; do not reintroduce
  a second name for it. `isTypeDefinition` is likewise the single spelling
  of "is this a declaration file".
- `VirtualPackage` — `src/VirtualPackage.ts` (`class VirtualPackage extends
  Schema.Class<VirtualPackage>("VirtualPackage")({...})`). A Schema class
  that validates at construction, so the entries map must be complete
  before `super` runs; a subclass that cannot assemble it in one step
  builds it on a scratch instance first (see `@tsdoctor/model`'s
  `ApiExtractedPackage`). `toVfs()` renders the package to a `Vfs`, picking
  a `types` field in `package.json` for a single entry and an `exports` map
  for several. There is no `generateVfs` alias.
- `TsEnvironment`, `TsEnvironmentError`, `TsEnvironmentOptions` —
  `src/TsEnvironment.ts`. The `@typescript/vfs`-backed TypeScript
  environment; `typescript` and `@typescript/vfs` are lazily `import()`ed
  here only, so a consumer that never builds an environment never installs
  a compiler.
- `parseTsConfig`, `TsConfigParseError` — `src/TsconfigParser.ts`. Reads a
  `tsconfig.json` through `@effected/tsconfig-json`'s `TsconfigLoaderSync`
  (which owns `extends`-chain resolution, JSONC parsing and relative
  paths) and reports options in the **tsconfig spelling**
  (`lib: ["esnext"]`, `target: "es2025"`) — never the programmatic form.
- `TypeResolutionCompilerOptions`, `decodeCompilerOptions`,
  `toProgrammaticCompilerOptions` — `src/TypeResolutionOptions.ts`. The
  compiler-options seam (below).
- `DEFAULT_COMPILER_OPTIONS`, `TypeScriptConfig`, `CompilerOptionsInput`,
  `mergeCompilerOptions`, `resolveTypeScriptConfig*` — `src/TypeScriptConfig.ts`.
- The Twoslash result-cache surface — `TWOSLASH_CACHE_FORMAT`,
  `twoslashEnvHash`, `twoslashEntryKey`, `twoslashBlobKey`,
  `makeTwoslashCache`, `encodeTwoslashCache`, `decodeTwoslashCache`,
  `TwoslashResultCache`, `TwoslashCacheValue`, `TwoslashCacheStats` —
  `src/TwoslashCache.ts` (below).

## The compiler-options seam

There is exactly one place in the monorepo that converts between the
tsconfig spelling of a compiler option (`lib: ["ESNext", "DOM"]`,
`target: "es2025"`) and the programmatic form TypeScript's API wants
(`lib.esnext.d.ts` file names, `ts.ScriptTarget` enum values):
`toProgrammaticCompilerOptions` in `src/TypeResolutionOptions.ts`.[^src]
`TypeResolutionCompilerOptions` is a `Schema.Struct` picked from
`@effected/tsconfig-json`'s `CompilerOptions` schema — the kit owns which
values are legal and how they are spelled; this package owns only which
options are in scope for type-checking a documentation example.
`decodeCompilerOptions` accepts either spelling and returns the canonical
(tsconfig) one; a value the enum tables cannot map fails typed rather than
being silently coerced.

Twoslash environments must be fingerprinted on the **encoded** (tsconfig)
value, never the programmatic one: fingerprinting the two spellings
separately builds two structurally identical environments and silently
loses cache reuse, because `{lib:["ESNext"]}` and
`{lib:["lib.esnext.d.ts"]}` would hash differently for what is the same
configuration.

`resolveTypeScriptConfig` (`src/TypeScriptConfig.ts`) merges onto
`DEFAULT_COMPILER_OPTIONS` rather than replacing wholesale, with one
exception: a discovered tsconfig that declares `lib` replaces the array
entirely rather than appending to the default. `DEFAULT_COMPILER_OPTIONS`
is itself written in the tsconfig spelling (including `DOM`) so the
constant and a decoded config are directly comparable without a conversion
step.

## The persisted Twoslash result cache

`src/TwoslashCache.ts` holds the neutral half of the Twoslash result cache
both adapters share.[^src] `twoslashEnvHash(vfs, toolchain)` names a cache
*generation*: it hashes the whole combined VFS plus a toolchain string that
carries the installed TypeScript version — load-bearing, because
`lib.d.ts` and inference change between TypeScript releases, and without
it a warm cache would keep serving a previous compiler's hovers until the
documented API's own declarations happened to change first.
`twoslashEntryKey(code, lang, compilerOptions)` names one cached result
within a generation; `twoslashBlobKey(envHash)` names the storage key for
the whole generation, namespaced by `TWOSLASH_CACHE_FORMAT` (currently
`1`). `makeTwoslashCache` returns the synchronous `TwoslashTypesCache`
`@shikijs/twoslash` reads through — persistence (load-once before render,
save-once after) is each caller's job: RSPress's `TwoslashCacheService`
and VitePress's `TwoslashCacheStore` each store one gzipped generation blob
per `twoslashBlobKey(envHash)` in the shared XDG `tsdoctor/twoslash.sqlite`
store, so a site built by either adapter warms the other's cache.

Soundness: a cached result depends on the code, the compiler options, the
declarations it type-checked against and the compiler itself. The
per-entry key carries the first three; `twoslashEnvHash` carries the last
two. One further input is deliberately *not* folded into either key: the
`@shikijs/twoslash` / `twoslash` renderer version, which determines the
shape of the stored `nodes`. `TWOSLASH_CACHE_FORMAT` is the manual lever
for that axis — bump it whenever those packages are upgraded, or a stored
value from an older renderer shape gets read back as if it matched the
new one.

That soundness buys coarse invalidation: repeat builds over an unchanged
API are nearly free, and the build immediately after any API item changes
gets no hits at all, because the generation key covers the whole VFS.
Every read/write failure on the persistence side degrades to a cache miss
rather than failing a build.

## Invariants

- `Vfs` and `isTypeDefinition` are the only spellings; no second name, no
  parallel predicate.
- `parseTsConfig` never emits the programmatic spelling; only
  `toProgrammaticCompilerOptions` does the conversion.
- Twoslash environment fingerprints are computed on the encoded
  (tsconfig-spelling) value.
- `TWOSLASH_CACHE_FORMAT` must be bumped by hand when
  `@shikijs/twoslash` / `twoslash` is upgraded; nothing detects that drift
  automatically.
- `VirtualPackage` validates at construction; a subclass builds its
  entries map before calling `super`.

## Links

- [Decision: vfs sits below the registry and the model](../decisions/vfs-below-registry-and-model.md)
- [Decision: persisted Twoslash result cache](../decisions/persisted-twoslash-result-cache.md)
- [Convention: decode compiler options, never cast](../conventions/compiler-options-decode-not-cast.md)
- [Limitation: the Twoslash cache invalidates per whole VFS](../limitations/twoslash-cache-invalidates-per-vfs.md)

[^src]: `packages/vfs/src/index.ts`, `packages/vfs/src/Vfs.ts`,
`packages/vfs/src/VirtualPackage.ts`, `packages/vfs/src/TsEnvironment.ts`,
`packages/vfs/src/TsconfigParser.ts`,
`packages/vfs/src/TypeResolutionOptions.ts`,
`packages/vfs/src/TypeScriptConfig.ts`, `packages/vfs/src/TwoslashCache.ts`.
