# @tsdoctor/vfs

## 0.2.1

### Maintenance

- Force package bumps

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.0

### Features

- `@tsdoctor/vfs` now exports the Twoslash result cache — the keying scheme,
  the generation codec and the in-memory `TwoslashTypesCache` implementation
  (`makeTwoslashCache`, `twoslashEnvHash`, `twoslashEntryKey`,&#10;`twoslashBlobKey`, `encodeTwoslashCache`, `decodeTwoslashCache`) — moved out
  of the RSPress adapter so any adapter can persist and share one Twoslash
  result cache:

```ts
import { makeTwoslashCache, twoslashEnvHash } from "@tsdoctor/vfs";

const typesCache = makeTwoslashCache({ store, envHash: twoslashEnvHash(vfs, tsVersion) });
```

- `@shikijs/twoslash` is now an optional peer dependency, alongside the
  existing `typescript` and `@typescript/vfs`. [#208][#208]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @shikijs/twoslash | peerDependency | added | — | ^4.4.3 |

[#208][#208]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#208]: https://github.com/spencerbeggs/tsdoctor/pull/208

## 0.1.0

### Breaking Changes

- Compatibility shims and dead configuration are removed. Nothing here had a consumer outside this repository.

| Removed | Use instead |
| --- | --- |
| `VirtualFileSystem` (`@tsdoctor/vfs`) | `Vfs` — it was an alias kept for a finished migration |
| `ApiExtractedPackage.generateVfs()` (`@tsdoctor/model`) | `toVfs()` — the alias delegated to it |
| `logLevel` plugin option | `observability.logLevel` |
| `performance` plugin option | `observability.thresholds` |
| `VersionConfig.tsconfig` / `VersionConfig.compilerOptions` | nothing — see below |

- `VersionConfig`'s two TypeScript fields are removed rather than deprecated because **nothing ever read them**. `resolveTypeScriptConfig` accepted version-level and package-level configuration, but its single production caller passed neither, and `rawTsConfig` only ever collected those fields from an API config. A version's discovered `tsconfig.json` was silently dropped, so a multi-version site type-checked every version's examples against the default compiler options. The unused cascade levels are gone with them; the cascade is now defaults, global, API.

### Features

- The compiler-options seam moves here from the RSPress adapter, beside the `TsEnvironment` those options configure.

#### `TypeResolutionCompilerOptions`

- The compiler options allowed to influence how a documentation example type-checks, now **picked from `@effected/tsconfig-json`'s `CompilerOptions`** rather than restated as a hand-written interface. The accepted values, their spellings and their case-insensitivity are the kit's to own; this package owns only the choice of which options are in scope.

#### `decodeCompilerOptions`

- Accepts compiler options in either spelling — the tsconfig form a user writes (`target: "es2025"`, and case-insensitively `lib: ["ESNext", "DOM"]`) and the programmatic form a caller holding `ts.CompilerOptions` has (`target: ts.ScriptTarget.ES2025`) — and returns the canonical form on a `Result`.

- **It fails rather than guesses.** A value the enum tables cannot map is rejected instead of passed through. Degrading to a default would type-check every example against a configuration the user did not ask for, and produce confidently wrong output with no error.

#### `parseTsConfig` and `toProgrammaticCompilerOptions`

- `parseTsConfig` reads a `tsconfig.json` through the kit's `TsconfigLoaderSync` and decodes it into the whitelist. `toProgrammaticCompilerOptions` is the ONE conversion to the numeric-enum form the compiler takes, and now carries **no cast**: the whitelist is a subset of the kit's own `CompilerOptions`, so it is assignable to the encoder by construction — which a hand-rolled options type could not be. [#206][#206]

* First release of `@tsdoctor/vfs`: the virtual file system substrate shared by `@tsdoctor/registry` and `@tsdoctor/model`, factored out of the registry so neither has to depend on the other.

#### `Vfs`, `mergeVfs`, `prefixVfs`, `isTypeDefinition`

- The currency type — a `Map` of `node_modules/`-prefixed paths to file contents — plus the helpers that combine maps, root a package's entries, and decide whether a path names a declaration file.

#### `VirtualPackage`

- A named, versioned set of declaration entries that renders to a `Vfs` with a synthetic `package.json`, choosing the `types` field for a single entry and an `exports` map for several, so TypeScript resolves subpaths the way the real package would.

#### `TsEnvironment`

- A `@typescript/vfs` environment built over a `Vfs`, loading `typescript` and `@typescript/vfs` lazily so they stay optional peers. `@effected/tsconfig-json` is a required peer: the compiler-options seam value-imports it and evaluates its schema at module load, so it cannot be optional the way the other two are.

- All four modules move verbatim from `@tsdoctor/registry`, which re-homes rather than reimplements them. Hover output is byte-for-byte unchanged: a cold-cache build of the `multi` fixture site produced 230 Twoslash hovers across 129 code blocks before and after the move.

* `@tsdoctor/model` gains the frontmatter contract: `parseFrontmatter`, `stringifyFrontmatter`, `emitFrontmatterBlock` and `ParsedFrontmatter`, moved from the RSPress adapter. Splitting a markdown document at its fence boundaries and re-joining it is not framework-specific, and a second adapter would need it byte-identical — the frontmatter a page carries feeds the snapshot hash that decides whether the page is rewritten.

* `@tsdoctor/vfs` gains the TypeScript configuration resolution that feeds its environments: `DEFAULT_COMPILER_OPTIONS`, `mergeCompilerOptions`, `resolveTypeScriptConfig` and its two single-config resolvers, plus the `TypeScriptConfig` and `CompilerOptionsInput` types. These sit beside the `TsEnvironment` and the compiler-options seam they configure.

* The Tier 1 plan had deliberately left the cascade in the adapter, on the grounds that an unwired cascade should not be exported into a core package. That objection is gone: the version and package-override levels nothing read were deleted, and what remains is defaults, global, API.

### Bug Fixes

- `@effected/tsconfig-json` was declared as an optional peer in `peerDependenciesMeta`, but the compiler-options seam imports it as a value and evaluates its schema at module load — so importing this package without it installed failed outright rather than degrading. Removed from `peerDependenciesMeta`; it stays a required peer.

### Documentation

- Corrects the npm listing description, which undersold the package once the compiler-options seam moved in alongside it: "Virtual TypeScript projects for documentation tooling: the Vfs currency type, declaration-backed virtual packages, @typescript/vfs environments, and the compiler-option resolution that configures them."

### Refactoring

- Delete `ShikiCrossLinker`'s API-item-kind map. Its only consumer was `getSemanticClass`, a deprecated method whose body was `return null`, so seven call sites computed a class name that could only be null. Removing it took the kinds map, its constructor parameter and the third argument of `fromRoutes` with it.
- Delete the `DeprecatedConfigUsed` event and the `deprecations` channel that carried it, now that no option is deprecated. An event variant with no emitter is a second vocabulary beside the real one.
- Delete `PerformanceConfig`, whose only remaining reference was its own test. [#206][#206]

* The adapter's `internal-types.ts` is down to 40 lines and re-exports the moved types, so its import sites are unchanged.

* `category-resolver.ts` was a Tier 1 candidate and **stays in the adapter**. It merges full category configs — `displayName`, `folderName`, `collapsible` — across a plugin, package and version precedence chain, which is sidebar presentation plus multiVersion product policy rather than model vocabulary. The framework-neutral half already exists as `@tsdoctor/model`'s `CategorySpec`, which is what categorization consumes.

* Verified output-neutral: a cold-cache build of the `multi` fixture site produced the same 230 Twoslash hovers across the same 129 code blocks. [#206][#206]

### Maintenance

- Adds the `LICENSE` file the README already linked to. [#206][#206]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#206]: https://github.com/spencerbeggs/tsdoctor/pull/206
