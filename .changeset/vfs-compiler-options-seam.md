---
"@tsdoctor/vfs": minor
---

## Features

The compiler-options seam moves here from the RSPress adapter, beside the `TsEnvironment` those options configure.

### `TypeResolutionCompilerOptions`

The compiler options allowed to influence how a documentation example type-checks, now **picked from `@effected/tsconfig-json`'s `CompilerOptions`** rather than restated as a hand-written interface. The accepted values, their spellings and their case-insensitivity are the kit's to own; this package owns only the choice of which options are in scope.

### `decodeCompilerOptions`

Accepts compiler options in either spelling — the tsconfig form a user writes (`target: "es2025"`, and case-insensitively `lib: ["ESNext", "DOM"]`) and the programmatic form a caller holding `ts.CompilerOptions` has (`target: ts.ScriptTarget.ES2025`) — and returns the canonical form on a `Result`.

**It fails rather than guesses.** A value the enum tables cannot map is rejected instead of passed through. Degrading to a default would type-check every example against a configuration the user did not ask for, and produce confidently wrong output with no error.

### `parseTsConfig` and `toProgrammaticCompilerOptions`

`parseTsConfig` reads a `tsconfig.json` through the kit's `TsconfigLoaderSync` and decodes it into the whitelist. `toProgrammaticCompilerOptions` is the ONE conversion to the numeric-enum form the compiler takes, and now carries **no cast**: the whitelist is a subset of the kit's own `CompilerOptions`, so it is assignable to the encoder by construction — which a hand-rolled options type could not be.
