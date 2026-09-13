---
type: Decision
status: draft
title: Page IR blocks are Schema.Class variants, not Data.TaggedEnum
description: The page IR's block vocabulary is modeled as Schema.Class variants tagged on kind and unioned with Schema.Union, matching the mdast shape the IR is built alongside.
tags: [architecture, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 1e00a08ea615dad454e2ef528bd849754ad7b0310ae8ae528c60c71863d801cb
---

# Page IR blocks are `Schema.Class` variants, not `Data.TaggedEnum`

## Context

`@tsdoctor/pages`'s block vocabulary (`Title`, `Prose`, `Member`,
`Example`, `ParameterTable`, and the rest) needs to be decodable and
serializable as a stable artifact — the IR is meant to be the shared
representation both the RSPress and VitePress emitters spend, and
potentially something a future consumer reads back from disk. It also
needs to compose with `@effected/markdown`'s mdast node classes, since
prose inside a block is parsed mdast.

## Decision

Each block is a `Schema.Class` carrying `Schema.tag` on a domain-named
discriminant field, `kind`, unioned with `Schema.Union`[^1] — the same
representational shape `@effected/markdown` uses for its own mdast nodes,
whose discriminant is `type` rather than `kind`. `packages/pages/__test__/blocks.test.ts`[^2]
pins what this choice has to prove: the union covers every variant
exactly once, a block round-trips with class identity on decode, nested
mdast prose decodes back into kit node classes, and a mismatched
discriminant is rejected.

The package's public surface is deliberately flat: `packages/pages/src/index.ts`
re-exports every symbol by name, with no `export * as` namespace
groupings[^3]. This is a direct consequence of the class-based
representation: API Extractor's dts rollup cannot attribute a class
referenced across a namespace boundary (for example `Page` referencing
its own `Block` union members), so a namespaced surface produced
forgotten-export warnings that fail CI. The flat surface forces
concept-qualified names where a bare name would otherwise collide across
domains — `ExampleGroup`, `ParameterTable`, `EnumMemberTable`, `buildNav`,
`formatExampleCode` — and that naming convention is expected to continue
for anything added to the package later.

## Alternatives rejected

- **`Data.TaggedEnum`.** Rejected: the IR must be decodable and
  serializable as a stable artifact across a process boundary (adapter
  build time, potentially a future cache or export format), which is not
  `Data.TaggedEnum`'s contract — it is a runtime discriminated-union
  helper, not a schema.
- **`Schema.TaggedClass`.** Rejected: it hardwires the discriminant field
  to `_tag`, and a block vocabulary that sits directly beside mdast nodes
  (discriminant `type`) reads better with its own domain-named
  discriminant (`kind`) than with a name borrowed from Effect's own
  tagging convention.
- **A namespaced public surface (`export * as Blocks from "./Blocks.js"`).**
  Rejected once it produced forgotten-export warnings from API Extractor's
  dts rollup on any class referenced across the namespace boundary; the
  flat surface with concept-qualified names was adopted instead of
  chasing per-symbol suppressions.

## Consequences

- Any new block variant added to `Blocks.ts` must be a `Schema.Class` with
  `Schema.tag` on `kind` and must be added to the block union in one
  place; `blocks.test.ts` is the test that catches an omission.
- Any new exported symbol from `@tsdoctor/pages` follows the flat,
  concept-qualified naming convention already established — a bare name
  that would collide with another domain concept must be qualified rather
  than namespaced.
- A consumer decoding IR from disk (a build cache, an export) gets class
  identity back on decode, not a plain object shape, because the schema
  is class-based rather than a `Data.TaggedEnum`.

[^1]: [packages/pages/src/Blocks.ts](../../packages/pages/src/Blocks.ts)
[^2]: [packages/pages/**test**/blocks.test.ts](../../packages/pages/__test__/blocks.test.ts)
[^3]: [packages/pages/src/index.ts](../../packages/pages/src/index.ts)
