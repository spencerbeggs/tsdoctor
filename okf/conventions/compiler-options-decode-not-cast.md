---
type: Convention
title: Decode compiler options at one seam, never cast
description: Accept both tsconfig and programmatic compiler-option spellings only through TypeResolutionOptions.ts; decode fails loudly rather than guessing, and user options are never cast from unknown.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 6d2d88b5d4e03b7a1d28826bb592befd105ac06f1b7d61d49359299ab8e6775c
stale_after: 2026-12-12T00:00:00Z
tags: [compat, testing]
sources:
  - id: type-resolution-options
    resource: ../../packages/vfs/src/TypeResolutionOptions.ts
  - id: tsconfig-parser
    resource: ../../packages/vfs/src/TsconfigParser.ts
  - id: vfs-compiler-seam-test
    resource: ../../packages/vfs/__test__/compiler-options-seam.test.ts
  - id: rspress-compiler-seam-test
    resource: ../../platforms/rspress/__test__/compiler-options-seam.test.ts
status: stable
---

# Decode compiler options at one seam, never cast

TypeScript compiler options have two live spellings: the tsconfig form a
user writes (`target: "ESNext"`, `lib: ["ESNext", "DOM"]`) and the
programmatic form the compiler API wants (`lib: ["lib.esnext.d.ts", ...]`).
Both spellings are accepted at exactly one seam,
`packages/vfs/src/TypeResolutionOptions.ts`: `decodeCompilerOptions` takes
either spelling in and returns the canonical tsconfig spelling;
`toProgrammaticCompilerOptions` is the single conversion site that produces
the programmatic form Twoslash's TypeScript environment consumes.

## Rules

- Never introduce a second conversion between the two spellings anywhere
  else in the codebase — including a local cast. A cast at a second site is
  exactly the shape of the bug this seam was built to close.
- **Decode fails rather than guesses.** A value the enum tables in
  `TypeResolutionOptions.ts` cannot map surfaces as a typed
  `ConfigValidationError` reaching `issues.json` — it must never silently
  fall back to a default.
- **User-supplied `compilerOptions` arrive as `unknown` and are validated**
  through the schema, never cast directly to a typed shape.
- **Compute the environment fingerprint (used to dedupe Twoslash
  environments) on the encoded value**, not the raw input — `{lib:
  ["ESNext"]}` and `{lib: ["lib.esnext.d.ts"]}` must fingerprint identically
  or two environments get built for what is the same configuration.
- **`DEFAULT_COMPILER_OPTIONS` stays written in the canonical tsconfig
  spelling**, including `lib: [..., "DOM"]`, so it is directly comparable to
  a decoded user config. Keeping `DOM` carries a known, accepted risk:
  `Response`, `Request`, `URL` and similar DOM globals can shadow a
  library's own same-named export in an example's hover, silently rendering
  a confidently wrong type. If that surfaces on a real site, the remedy is
  dropping `DOM` from the default — not a per-example workaround.
- `parseTsConfig` (`packages/vfs/src/TsconfigParser.ts`) whitelists which
  options are even in scope via `TypeResolutionCompilerOptions`, a
  `Schema.pick` over `@effected/tsconfig-json`'s `CompilerOptions`. Do not
  widen that whitelist casually — the set of options allowed to influence
  how a documentation example type-checks is a documentation-tool safety
  decision, not a tsconfig-grammar fact.

## Why

Before this seam existed, the two spellings met at a bare cast and three of
four resolution paths silently loaded zero `lib` files. With
`noErrorValidation` swallowing the resulting diagnostics, the only symptom
was degraded hovers — `Promise<number[]>` rendering as `Promise<{}>` — with
zero warnings anywhere in the build output. A cast cannot fail loudly by
construction; a decode can, and that is the entire reason the seam is a
decode rather than a cast. The fingerprint-on-encoded-value rule exists for
the same reason `DEFAULT_COMPILER_OPTIONS` stays in tsconfig spelling: the
two representations of one configuration must never be treated as two
different configurations.

## How to check

- `grep -rn "as TypeResolutionCompilerOptions\|as ProgrammaticCompilerOptions"`
  across `packages/` and `platforms/` should return nothing outside
  `TypeResolutionOptions.ts` itself.
- `packages/vfs/__test__/compiler-options-seam.test.ts` and
  `platforms/rspress/__test__/compiler-options-seam.test.ts` pin the four
  resolution paths (no tsconfig, tsconfig with `lib`, tsconfig without
  `lib`, explicit `compilerOptions`) against the regression this seam
  closed — run them after touching either compiler-options module.
- Feed an unrecognized `compilerOptions` value through config resolution and
  confirm it surfaces as a `ConfigValidationError` in `issues.json`, not a
  silently-applied default.
- Hover parity on a fixture site after a change to this seam must be
  measured with a cold Twoslash cache on both sides, since neither the
  suite nor an MDX diff can see rendered hovers.
