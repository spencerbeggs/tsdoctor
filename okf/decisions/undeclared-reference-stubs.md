---
type: Decision
status: draft
title: Import or stub undeclared references, never leave them dangling
description: A reconstructed entry point imports a name a sibling entry exports and gives every other undeclared name a non-exported any type-and-value stub, so one forgotten export or unresolved dotted name does not fail the whole file under Twoslash.
tags: [architecture]
sources:
  - id: stubs
    resource: ../../packages/model/src/internal/undeclared.ts
  - id: generator
    resource: ../../packages/model/src/ApiExtractedPackage.ts
  - id: tests
    resource: ../../packages/model/__test__/api-extracted-package.test.ts
generated:
  by: okfit/claude-code
  at: 2026-11-20T01:31:37Z
integrity:
  generated:
    body: 7ad9140872b7e9a9
---

# Import or stub undeclared references, never leave them dangling

## Context

`ApiExtractedPackage` reconstructs each entry point's `.d.ts` from the API
model, and the adapters prepend `import type` lines for external references
afterwards. Two kinds of name reach that file with nothing declaring them.
An internal reference (its canonical package is the documented one) to a
symbol the entry point does not export, a forgotten export, is skipped by
the import prepender because internal types are assumed to be declared
locally. That assumption fails when the package's API Extractor run leaves
`includeForgottenExports` off (issue 177). A dotted name in a `Content`
token, which is how API Extractor writes a reference it could not resolve,
has no canonical reference to classify, so nothing imports it (issue 178).
Either one is a `TS2304` / `TS2503` that fails every Twoslash hover in a
block touching the entry point.

## Decision

Before generating an entry point's declarations, `resolveUndeclared`[^stubs]
walks every token in the entry's excerpts and collects each name that is
not a top-level member, not a root some external or built-in reference
resolves (the prepender imports those, and a local stub would collide with
the import), not a known global namespace (`Intl`, `NodeJS`, `Symbol` and
others), and not inside a string or template literal.

A collected name that a *sibling* entry point of the same package exports
is imported from that entry (`import { Pipeline } from "kitchensink"`) at
the top of the file. It is a plain import, not `import type`, because a
sibling class can sit in an `extends` clause.

Every other collected name gets a stub: `declare type X = any;` plus a
matching `declare const X: any;`, nested in `declare namespace` blocks for a
dotted path. The value half is what lets a heritage clause
(`class A extends Foo_base`) resolve, since a type alias alone answers a
value position with `TS2693`. The type gets optional parameters when it is
used generically, so `Box<string, Declared>` does not raise `TS2315`. The
stubs go before the trailing `export { }`[^generator] and are never
exported, so the entry point's public surface is unchanged. A dotted
`Content` name in a value position (`typeof A.b`, `A.b(…)`) is left alone.

## Alternatives rejected

- **Report the name as a diagnostic only.** Arguably more honest, since
  the name genuinely is not part of the documented API, but the file still
  fails to type-check and every other hover in the block stays broken. It
  can still be added on top of the stubs later.
- **Stub as `unknown`.** Member access in a type-checked example then
  raises a new error on every use, so `any` was chosen to keep examples
  quiet. The trade-off is that hovers show `any`.
- **Stub a sibling-exported name too.** Simpler, but it degrades a real,
  importable type to `any`. The stored kitchensink fixture model hits this
  case: its `testing` entry extends `Pipeline` and `DataSource`, which only
  the main entry exports.

## Consequences

- The models the fixture modules build today emit neither stubs nor
  sibling imports. The older model copies stored under the model package's
  test fixtures do: kitchensink `testing` imports `DataSink`, `DataSource`
  and `Pipeline` from the main entry, and effect-kit stubs
  `AgentNotFoundError_base`. Tests pin both, alongside the stubbed and
  never-stubbed cases of a purpose-built fixture[^tests].
- A bare (undotted) unresolved name in a `Content` token is not
  detected, because it cannot be told apart from a keyword or a type
  parameter without a parser.

[^stubs]: `packages/model/src/internal/undeclared.ts` — `resolveUndeclared`
[^generator]: `packages/model/src/ApiExtractedPackage.ts` — `generateDeclarations`, `siblingExports`
[^tests]: `packages/model/__test__/api-extracted-package.test.ts` — "undeclared references (issues #177, #178)" and "undeclared references in the stored fixture models"
