---
type: Glossary
title: Display and source
description: Every code-bearing block in the @tsdoctor/pages IR carries a CodeText pair — display (Prettier-formatted, directive-stripped, what a reader sees and copies) and source (hidden imports plus a cut marker plus the code with Twoslash directives intact, the text a type-checker sees) — never the package's own source code.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 07038367252ef36562c251e6c204473dc5773502ce21f6b27135c94823ea9f61
status: stable
---

# Display and source

## What this repository means

Inside `@tsdoctor/pages`, `CodeText`[^1] is a two-field pair every
code-bearing block (`SignatureBlock`, `MemberBlock`, `Example`, and the
synthetic base-class section) carries:

- **`display`** — the directive-stripped, Prettier-formatted text a
  reader sees and copies.
- **`source`** — the type-check text: hidden `import type` lines, then a
  `// ---cut---` marker, then the code with any Twoslash directives
  (`@errors`, `@noErrors`, and the rest) left intact.

Both are produced once, together, by `codeText` / `buildExample`[^2] — an
emitter never derives one field from the other. The two emitters spend
the pair differently: the RSPress adapter emits both as component props
and hides the pre-cut lines at render time through its own hide-cut
transformer; the VitePress adapter emits `source` alone as the fence
body and lets native Twoslash cut notation (`---cut---`) hide the
preamble, because VitePress's Shiki-native transformer type-checks the
fence body directly rather than a separate prop.

## Where the wider meaning differs

Everywhere else "source" in this monorepo means source code — the
package's own `.ts` files under `src/`, as opposed to its built output.
Inside a `CodeText` pair, `source` is a different axis entirely: it is
the *type-check* variant of one code example, not the *unbuilt* variant
of a package. A `CodeText.source` can be (and usually is) longer than
`CodeText.display` for the same example, because it carries import
lines and a cut marker the reader never sees.

## Why this earns a concept

Reading `source` here as "the package's source" instead of "the
type-check text of this one code block" misdirects debugging effort:
a Twoslash diagnostic that only reproduces against `source` (which
includes the hidden imports) will look unreproducible against
`display` (which strips them) or against the package's real source
tree, which has neither field. The pairing is also carried through
verbatim rather than derived per adapter specifically so that a
change to one field's construction can never silently desync from the
other — see `packages/pages/src/Blocks.ts`[^1] and
`packages/pages/src/Examples.ts`[^3] for where the pair is assembled.

[^1]: [packages/pages/src/Blocks.ts](../../packages/pages/src/Blocks.ts)
[^2]: [packages/pages/src/Examples.ts](../../packages/pages/src/Examples.ts)
[^3]: [packages/pages/src/Examples.ts](../../packages/pages/src/Examples.ts)

See also: [the `@tsdoctor/pages` module](../modules/tsdoctor-pages.md).
