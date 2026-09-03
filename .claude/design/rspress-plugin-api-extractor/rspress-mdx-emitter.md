---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-09-03
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
  - rspress-plugin-api-extractor/vitepress-adapter.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/cross-linking-architecture.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
---

# RSPress MDX emitter

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Byte-parity decisions](#byte-parity-decisions)
- [Navigation and index emission](#navigation-and-index-emission)
- [The kit's escaping contract](#the-kits-escaping-contract)
- [How the switch was validated](#how-the-switch-was-validated)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

The RSPress adapter renders a `@tsdoctor/pages` `Page` as MDX. `src/emit/mdx.ts` owns the body — the component import lines chosen from `Page.kind`, `ApiSignature` / `ApiMember` / `ApiExample` as JSX elements carrying JSON-encoded `code` and `source` props, `ParametersTable` / `EnumMembersTable` as JSON props and the prose between them. `src/emit/meta.ts` owns the sidebar files and the landing page. Frontmatter assembly stays in `markdown/helpers.ts`, called from the generate stage (`page-generation-system.md`).

## Current state

| Concern | Where it lives |
| --- | --- |
| `emitMdxBody`, `escapeMdxGenerics` | `platforms/rspress/src/emit/mdx.ts` |
| `renderRootMeta`, `renderCategoryMeta`, `emitIndexPage` | `platforms/rspress/src/emit/meta.ts` |
| Frontmatter and head-tag pairs | `platforms/rspress/src/markdown/helpers.ts` |
| Byte-level pins | `platforms/rspress/__test__/emit/` and `__test__/markdown/anchor-invariant.test.ts` |

Untouched by the emitter: the remark plugins, `ShikiCrossLinker`, the hide-cut transformers, the snapshot hashing and the runtime components.

## Byte-parity decisions

The emitter reproduces the bytes of the generator classes it replaced. Four decisions inside it are each a place a later change could quietly break parity:

- **Per-top-level-node serialization, with the emitter owning the joins.** Each block's node is serialized as its own one-node `Root` and the emitter places the separator — a blank line, or the single newline between an enum signature and its members table. Serializing the page as one tree is not an option: the kit's MDX-presence escaping is tree-wide, so the moment a `MdxJsxFlowElement` is present it rewrites `{` in every prose node, and the prose must be emitted raw. Nothing in the module assembles MDX from string fragments; the joins are the one thing it spells itself.
- **Generics escaping is done on the mdast tree.** A `<T>` / `<K, V>` run in a `Text` node becomes an `InlineCode` node, which the kit serializes as the backticked form. A string-level regex would no longer see the generic after the kit escaped the `<`. It is applied exactly where the generators applied it — the deprecation notice, member summaries and returns, function-level parameter descriptions, the returns section, see-also references and the namespace member index — and deliberately not to member-level parameter descriptions or enum member descriptions. That inconsistency is preserved and flagged: fixing it is a product change for a labelled commit.
- **Prose enters the IR by parsing the linked string** (commonmark), so what the emitter serializes is what the generators wrote.
- **Nothing post-processes the kit's bytes.** `@effected/markdown` escapes minimally (see below), so there is no reversal shim; the tests pin the raw bytes directly.

`emitMdxBody` returns a `Result` — a stringify failure is typed, not thrown.

## Navigation and index emission

`meta.ts` is pure functions of the nav tree and `IndexPage`: the root `_meta.json` gets one `dir` entry per category group that received a page, with the RSPress sidebar defaults (`collapsible` / `collapsed` true, `overviewHeaders: [2]`); each category `_meta.json` lists pages in the tree's label-sorted order; `index.mdx` is frontmatter only with `overview: true`. The tab-indented JSON spelling is what the snapshot system compares against on disk fallback.

## The kit's escaping contract

The IR lift surfaced three gaps against `@effected/markdown` that were closed in the kit rather than locally, and the current contract is:

- **Inline escaping is minimal.** `_` is escaped only where it can bind emphasis, `&` only when entity-shaped, `>` only at a line start and `#` in a heading only as an ATX closing sequence. A `{#id}` heading suffix survives raw on a non-MDX tree. An author-written `\_` that cannot bind emphasis round-trips to `_`, the kit dropping a redundant escape.
- **The presence-keyed `{` escape is a kit invariant.** There is no stringify option, per-node flag or separator option; `Markdown.stringify` stays option-free. The documented raw hatch is an inline `Html` node, which emits its `value` verbatim on any tree. `<` is always escaped regardless of MDX presence. This is why the emitter keeps per-node serialization rather than collapsing to one tree.
- **Two JSX normalizations are intentional:** an empty-children `MdxJsxFlowElement` self-closes and nested JSX siblings are blank-line separated, both the `mdast-util-mdx-jsx` oracle defaults.

## How the switch was validated

The generator-to-IR switch was a refactor with a hard oracle: byte-identical generated output for every fixture site, captured before the switch and diffed after, plus the snapshot rebuild count — a rebuild over the IR must report every file unchanged, and a subsequent no-change rebuild must stay byte-identical. The rebuild count matters because a unit test can pass forever on an input no caller produces; only a rebuild over the real pipeline sees what the pipeline actually emits.

The gate held with one labelled deviation, which was a real bug the lift fixed: the old generators linked prose through a module-level holder swapped per API while `generateApiDocs` ran concurrently, so under a multi-API build one API's prose could be linked against another's route map. The IR builder takes the `CrossLinker` per API through the pipeline context, so links are deterministic (`cross-linking-architecture.md`). The golden files were a one-time capture, not a committed fixture; the durable coverage is the emitter tests plus the snapshot rebuild check.

## Rationale

- **Why per-node serialization survives the kit round:** collapsing to one tree needs every pre-escaped run to become an `Html` node and needs a separator the kit deliberately does not offer; adopting the hatch is a downstream refactor for a later round, not a kit ask.
- **Why the generics-escaping inconsistency is kept:** the lift's contract was byte identity, and a behaviour change hidden inside a structural refactor is exactly what the gate exists to catch.
- **Why the goldens are not committed:** two hundred MDX files per site to pin a refactor would be a corpus nobody maintains.

## Related documentation

- **The IR this emitter spends:** `doc-ir-and-pages.md`
- **The second emitter:** `vitepress-adapter.md`
- **The generate stage that calls `emitMdxBody`:** `page-generation-system.md`
- **The prose-linker race the switch fixed:** `cross-linking-architecture.md`
- **The frontmatter hash and the rebuild check:** `snapshot-tracking-system.md`
