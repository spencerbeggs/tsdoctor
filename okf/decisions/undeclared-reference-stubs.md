---
type: Decision
status: draft
title: Stub undeclared references as non-exported any
description: A reconstructed entry point that references a name nothing declares or imports gets a non-exported any stub for it, so one forgotten export or unresolved dotted name does not fail the whole file under Twoslash.
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
  at: 2026-11-20T01:18:12Z
integrity:
  generated:
    body: fa31bd8f952f0d61
---

# Stub undeclared references as non-exported any

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

After generating an entry point's declarations, `undeclaredStubs`[^stubs]
walks every token in the entry's excerpts and declares each name that is
not a top-level member, not a root some external or built-in reference
resolves (the prepender imports those, and a local stub would collide with
the import), not a known global namespace (`Intl`, `NodeJS`, `Symbol` and
others), and not inside a string or template literal. Each such name gets a
`declare type X = any;` stub, nested in `declare namespace` blocks for a
dotted path. It gets optional type parameters when it is used generically,
so `Box<string, Declared>` does not raise `TS2315`. The stubs go before the
trailing `export { }`[^generator] and are never exported, so the entry
point's public surface is unchanged. Value positions (`typeof A.b`,
`A.b(…)`) are left alone because a type stub cannot fix them.

## Alternatives rejected

- **Report the name as a diagnostic only.** Arguably more honest, since
  the name genuinely is not part of the documented API, but the file still
  fails to type-check and every other hover in the block stays broken. It
  can still be added on top of the stubs later.
- **Stub as `unknown`.** Member access in a type-checked example then
  raises a new error on every use, so `any` was chosen to keep examples
  quiet. The trade-off is that hovers show `any`.
- **Import the name from the documented package.** A forgotten export is
  by definition not importable from any entry point.

## Consequences

- A reconstruction of a well-formed package (every fixture module and
  every `@tsdoctor/*` package here) emits no stubs; the tests pin both the
  stubbed and the never-stubbed cases[^tests].
- An internal type exported only from a *sibling* entry point is also
  stubbed rather than imported from that subpath. It is a known gap, not
  something this decision covers.
- A bare (undotted) unresolved name in a `Content` token is not
  detected, because it cannot be told apart from a keyword or a type
  parameter without a parser.

[^stubs]: `packages/model/src/internal/undeclared.ts` — `undeclaredStubs`
[^generator]: `packages/model/src/ApiExtractedPackage.ts` — `generateDeclarations`
[^tests]: `packages/model/__test__/api-extracted-package.test.ts` — "undeclared references (issues #177, #178)"
