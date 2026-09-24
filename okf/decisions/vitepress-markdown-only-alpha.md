---
type: Decision
status: stable
title: The VitePress adapter alpha is markdown-only, no Vue components
description: platforms/vitepress renders every page as plain markdown over native @shikijs/vitepress-twoslash instead of shipping a Vue component layer, keeping the alpha scoped to proving the core seams.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 0035e03c913e1f287124087584407b6d8a2d5ccfc6cd17c6d4484738695581de
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# The VitePress adapter alpha is markdown-only, no Vue components

## Context

`vitepress-plugin-api-extractor`[^1] is the second consumer of the
`@tsdoctor/*` core packages and the proof that the core/adapter boundary
drawn around the RSPress adapter is real rather than incidental (see
[vitepress-alpha-gates-1-0.md](vitepress-alpha-gates-1-0.md)). RSPress's
adapter renders signatures, members and examples through a React runtime
with SSG-MD dual-mode components and a Shiki-plus-Twoslash HAST
post-processing pipeline. VitePress is a different framework (Vue,
markdown-it) with its own first-class Twoslash integration already
available as `@shikijs/vitepress-twoslash`.

## Decision

The adapter is deliberately markdown-only for its alpha: no Vue
components ship. `apiExtractor(options)`[^2] is one exported async
function, awaited from a site's `docs/.vitepress/config.mts`[^3] because
VitePress has no `config()`-equivalent pre-route-scan hook and its config
file is plain ESM that can top-level `await`; the call generates every
page under `docs/` and returns `{ sidebar, codeTransformers, hooks:
{ buildEnd }, generated }` to merge into `defineConfig`. Signatures,
members and examples are rendered as fenced code blocks — type-checked
ones carry a `twoslash` meta with the block's `source` and `// @noErrors`
is prepended to declaration fences (signatures, members, base classes)[^4]
because a declaration excerpt is not a whole program and Twoslash would
otherwise annotate nearly every line with "Cannot find name"; examples are
untouched and instead governed by `suppressExampleErrors`. Cross-linking
inside code blocks, which the RSPress adapter does through
`ShikiCrossLinker`'s HAST walk, is explicitly excluded — porting it would
be a rewrite, and prose links plus working anchors satisfy the alpha gate
without it. The package is named `vitepress-plugin-api-extractor` for
symmetry with `rspress-plugin-api-extractor` — one naming rule for every
`platforms/*` workspace.

Twoslash wiring in `platforms/vitepress/src/Twoslash.ts`[^5] supplies the
combined VFS as `twoslashOptions.extraFiles`, not `fsMap` — Twoslash
treats a supplied `fsMap` as the entire file system and drops every
`lib.*.d.ts`, so `extraFiles` overlays the VFS on the compiler's own libs
instead of replacing them. The transformer's `typesCache` is implemented
by `@tsdoctor/vfs`'s `makeTwoslashCache`, so a site built by either
adapter warms the other's cache. `throws: false` and `noErrorValidation`
make a diagnostic render as an annotation instead of failing the build.

## Alternatives rejected

- **Build a Vue component layer for the alpha, matching RSPress's React
  runtime feature for feature.** Rejected: a second component layer would
  need design decisions the alpha exists to defer, and the alpha's job is
  proving the core seams (the same bundle, routes, anchors, VFS, prose
  links and nav tree), not proving a UI layer.
- **Port `ShikiCrossLinker`'s HAST post-processing to VitePress's
  markdown-it pipeline.** Rejected: it is coupled to RSPress's own
  Twoslash HAST output and porting it is a rewrite, not a reuse; prose
  cross-links plus working anchors are enough to satisfy the gate.
- **Use Twoslash's `fsMap` option instead of `extraFiles`.** Rejected:
  `fsMap` replaces the compiler's file system wholesale rather than
  overlaying it, which drops every `lib.*.d.ts` and type-checks against
  nothing.

## Consequences

- Everything the alpha excludes — Vue components, code-block
  cross-links, llms.txt generation, multiVersion, i18n, multi-API sites,
  snapshot-tracked incremental writes, a `serve` runner — is a design
  question with an obvious home, not a gap in the architecture; each is
  tracked as a limitation rather than a defect (see
  [vitepress-alpha-scope.md](../limitations/vitepress-alpha-scope.md)).
- A site built by either adapter warms the other's Twoslash result cache,
  because both consume `@tsdoctor/vfs`'s shared keying scheme through the
  same `typesCache` interface.
- Declaration fences on VitePress get hover information RSPress never
  provides at all — RSPress never type-checks declaration blocks — which
  is strictly more type information on the VitePress side, not parity.

[^1]: [platforms/vitepress](../../platforms/vitepress)
[^2]: [platforms/vitepress/src/ApiExtractor.ts](../../platforms/vitepress/src/ApiExtractor.ts)
[^3]: [sites/vitepress-basic/docs/.vitepress/config.mts](../../sites/vitepress-basic/docs/.vitepress/config.mts)
[^4]: [platforms/vitepress/src/emit/markdown.ts](../../platforms/vitepress/src/emit/markdown.ts)
[^5]: [platforms/vitepress/src/Twoslash.ts](../../platforms/vitepress/src/Twoslash.ts)
