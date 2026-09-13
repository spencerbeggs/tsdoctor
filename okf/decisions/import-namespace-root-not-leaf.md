---
type: Decision
status: draft
title: Import the namespace root, never the leaf
description: Generated import type statements for a dotted reference (Schema.Struct) import the namespace root, because the reconstructed declaration body keeps the qualified form.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 33b7670d984daa5f7dffd49bc4b081d0943269d5664dbf8e04a7d23fc1faffeb
---

# Import the namespace root, never the leaf

## Context

The `.d.ts` files reconstructed into the virtual file system for Twoslash
declare a package's own types but reference types owned by other packages
(`ZodType` from `zod`). Without an `import type` statement for each such
reference, Twoslash reports `Cannot find name` and hover tooltips break. Many
of those references are namespaced token text — `Schema.Struct`,
`z.ZodType` — where the reconstructed declaration body keeps the qualified
form verbatim.

## Decision

`TypeReferenceExtractor.extractImportsForEntryPoint(entryPoint)`[^1] walks
only the members exported from that entry point, so each entry's `.d.ts`
imports only the external types it actually uses. When a reference is
namespaced, the reduction is to the namespace root — the first dotted
segment — never the leaf: a reference to `Schema.Struct` produces `import
type { Schema } from "effect"`, not `import type { Struct } from "effect"`.
This is required because the reconstructed declaration body keeps the
qualified form (`Schema.Struct`) verbatim, so the binding that must be in
lexical scope is the namespace root; importing the leaf would leave the
namespace identifier undefined, which collapses a companion-object pattern
such as `typeof Schema.Type` to an error type and produces a false
`TS2353`.

Generated imports are always type-only, named, deduplicated, and sorted by
package then symbol, represented as one `ImportStatement`[^1] shape
(`packageName`, a `symbols` set, `typeOnly`) that `formatImports` renders.
The same `ImportStatement[]` also feeds `prependHiddenImports`[^2], which
builds the hidden-import preamble of an example block's type-check text.
Prepending mutates the VFS map in place immediately after `toVfs()` — the
RSPress adapter's `prependImportsToVfs`[^3] and the VitePress adapter's
`Generate.ts`[^4] both call the extractor per entry point right after
declaration generation, before the combined VFS reaches Twoslash's
environment.

References are classified into three buckets before this: **built-in**
(empty package name, or a quoted Node-builtin name — `Promise`, `Buffer`)
and **internal** (the package being documented, already declared in the
VFS) are dropped; everything else is **external** and becomes an import.

## Alternatives rejected

- **Import the leaf symbol (`Struct`) instead of the namespace root.**
  Rejected: the declaration body's qualified reference (`Schema.Struct`)
  needs the namespace identifier in scope, not the leaf; importing the leaf
  leaves that identifier undefined and produces a false `TS2353` on every
  companion-object type such as `typeof Schema.Type`.
- **Import both the namespace root and the leaf.** Rejected as unnecessary —
  the body never references the leaf as a bare identifier, only qualified
  through the root, so importing the leaf adds nothing but noise and a
  second name to keep in sync.
- **Extract imports once for the whole package rather than per entry
  point.** Rejected: a multi-entry package (for example one with a
  `./testing` subpath) would then have every entry import references that
  only a different entry actually uses, and the synthetic package's exports
  map would stop describing what each entry genuinely needs.

## Consequences

- Adding a new dotted-reference pattern to any documented package is safe by
  construction as long as the reconstructed body keeps the qualified form —
  the extractor's root-reduction rule covers it without a special case.
- A generic type parameter is not extracted as a reference at all, and a
  re-exported type is assumed to be owned by the package that re-exports it
  — both are accepted known gaps, not defects to fix under this decision.
- Any future adapter (beyond RSPress and VitePress) that assembles a VFS
  from `ApiExtractedPackage.toVfs()` must call the extractor per entry point
  and prepend immediately, or it inherits the same "Cannot find name"
  failure this decision exists to prevent.

[^1]: [packages/model/src/TypeReferenceExtractor.ts](../../packages/model/src/TypeReferenceExtractor.ts) — `extractImportsForEntryPoint`, `ImportStatement`, `formatImports`
[^2]: [packages/pages/src/Examples.ts](../../packages/pages/src/Examples.ts) — `prependHiddenImports`
[^3]: [platforms/rspress/src/layers/config-resolution.ts](../../platforms/rspress/src/layers/config-resolution.ts) — `prependImportsToVfs`
[^4]: [platforms/vitepress/src/Generate.ts](../../platforms/vitepress/src/Generate.ts)
