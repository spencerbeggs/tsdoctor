# packages/vfs/CLAUDE.md

`@tsdoctor/vfs` (publishable, versioned via changesets) — virtual file system
primitives for TypeScript documentation tooling: the `Vfs` currency type,
declaration-backed virtual packages, `@typescript/vfs` environments, the
compiler-options seam and the persisted Twoslash result cache.

Factored out of `@tsdoctor/registry` so `@tsdoctor/registry` and
`@tsdoctor/model` can share the substrate without either depending on the
other — the registry fetches third-party declarations into a `Vfs`, the model
reconstructs them from an API model, and neither needs to know about the other
half. The move was verbatim (hover output byte-for-byte unchanged: 230 Twoslash
hovers over the `multi` fixture before and after). Version line starts at 0.x.

## Key Facts

- Public surface (`src/index.ts`): `Vfs` + `mergeVfs`/`prefixVfs`/
  `isTypeDefinition` (`Vfs.ts`), `VirtualPackage` (`VirtualPackage.ts`),
  `TsEnvironment`/`TsEnvironmentError`/`TsEnvironmentOptions`
  (`TsEnvironment.ts`), `parseTsConfig`/`TsConfigParseError`
  (`TsconfigParser.ts`), `TypeResolutionCompilerOptions`/
  `decodeCompilerOptions`/`toProgrammaticCompilerOptions`
  (`TypeResolutionOptions.ts`), and `DEFAULT_COMPILER_OPTIONS`/
  `TypeScriptConfig`/`CompilerOptionsInput`/`mergeCompilerOptions`/
  `resolveTypeScriptConfig*` (`TypeScriptConfig.ts`), and the Twoslash cache
  surface — `TWOSLASH_CACHE_FORMAT`, `twoslashEnvHash`/`twoslashEntryKey`/
  `twoslashBlobKey`, `makeTwoslashCache`, `encodeTwoslashCache`/
  `decodeTwoslashCache`, `TwoslashResultCache`/`TwoslashCacheValue`/
  `TwoslashCacheStats` (`TwoslashCache.ts`).
- `Vfs` is a `Map<string, string>` of `node_modules/`-prefixed paths to
  contents. It is the **currency type** every VFS-shaped API in the monorepo
  speaks; the `VirtualFileSystem` alias is deleted, so do not reintroduce a
  second name for it. `isTypeDefinition` is likewise the single spelling of the
  "is this a declaration file" predicate.
- `VirtualPackage` is a Schema class validating at construction, so an entries
  map must be complete before `super` runs — subclasses build it first and pass
  it in (see `@tsdoctor/model`'s `ApiExtractedPackage`). `toVfs()` renders it,
  picking a `types` field for a single entry and an `exports` map for several;
  the `generateVfs` alias is deleted.
- **The compiler-options seam lives here, and there is exactly one of it.**
  `parseTsConfig` reads a `tsconfig.json` through `@effected/tsconfig-json`'s
  `TsconfigLoaderSync` and reports the **tsconfig spelling** (`lib: ["esnext"]`,
  `target: "es2025"`), never the programmatic form.
  `toProgrammaticCompilerOptions` is the ONE conversion site to what TypeScript
  wants (`lib.esnext.d.ts`, `ts.ScriptTarget`). Fingerprint Twoslash
  environments on the ENCODED value — fingerprinting the two spellings
  separately builds two identical environments and silently loses cache reuse.
- `resolveTypeScriptConfig` **merges** onto `DEFAULT_COMPILER_OPTIONS` rather
  than replacing, with one exception: a discovered tsconfig that declares `lib`
  replaces the array wholesale. `DEFAULT_COMPILER_OPTIONS` deliberately keeps
  the tsconfig spelling (including `DOM`) so it reads the way users write it.
- **`TwoslashCache.ts` is the persisted Twoslash result cache**, moved here
  from the RSPress adapter (phase 5) because both adapters key it on the same
  VFS hash: `twoslashEnvHash(vfs, toolchain)` names a generation (the
  toolchain string carries the TypeScript version — load-bearing), and
  `makeTwoslashCache` is the synchronous `TwoslashTypesCache` Shiki reads
  through. Persistence is the caller's: RSPress's `TwoslashCacheService` and
  VitePress's `TwoslashCacheStore` both store one gzipped generation blob per
  `twoslashBlobKey(envHash)` in the XDG `tsdoctor/twoslash.sqlite` store, so a
  site built by either adapter warms the other. Keep the keying scheme stable —
  changing it silently cold-starts every cache — and bump
  `TWOSLASH_CACHE_FORMAT` when upgrading `@shikijs/twoslash` / `twoslash`.
- Peers: `effect` and `@effected/tsconfig-json` are **required**; `typescript`
  and `@typescript/vfs` are **optional**, reached through lazy `import()` in
  `TsEnvironment`, and `@shikijs/twoslash` is **optional** (a type-only import
  for `TwoslashTypesCache`) — keep those three that way, so a consumer that
  never builds an environment never installs a compiler. `@effected/tsconfig-json` is NOT in
  that group: `TypeResolutionOptions.ts` value-imports it and evaluates
  `CompilerOptions.schema.fields` at module load, so importing this package
  without it fails outright. It was marked optional when the package was
  extracted — copied from the registry, where only `TsEnvironment` reached it —
  and stayed wrong until the compiler-option seam moved in. If a future change
  makes it genuinely lazy, defer that schema construction first.
- Builds with `defineBuild()` (`savvy.build.ts`, `@savvy-web/bundler`);
  tsconfig extends `@savvy-web/bundler/tsconfig/ecma.json`. Source
  `package.json` stays `"private": true`; `publishConfig` drives publishing.

## Commands

```bash
pnpm --filter @tsdoctor/vfs run build:dev
pnpm vitest run packages/vfs/
```

## Design Docs

The two-workspace split and the compiler-options seam:

- @../../.claude/design/rspress-plugin-api-extractor/type-loading-vfs.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-vfs.md
- @../../.claude/design/rspress-plugin-api-extractor/tsdoctor-package-architecture.md

The Twoslash result cache's keying scheme and measured effect — load when
touching `TwoslashCache.ts`:

- @../../.claude/design/rspress-plugin-api-extractor/render-phase-instrumentation.md
