---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-09-02
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/rspress-mdx-emitter.md
  - rspress-plugin-api-extractor/vitepress-adapter.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/cross-linking-architecture.md
  - rspress-plugin-api-extractor/multi-entry-resolution.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/roadmap-1.0.md
---

# Doc IR and `@tsdoctor/pages`

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [A page, not a body](#a-page-not-a-body)
- [Block vocabulary](#block-vocabulary)
- [The display and source split](#the-display-and-source-split)
- [Navigation output](#navigation-output)
- [What stays adapter-side](#what-stays-adapter-side)
- [Representation](#representation)
- [Carried quirks](#carried-quirks)
- [Open decision](#open-decision)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

`@tsdoctor/pages` (`packages/pages`) owns what a generated API page contains. A page is a set of facts, an ordered list of typed doc blocks and its navigation entry; prose inside a block is `@effected/markdown` mdast. Each adapter is an emitter that spends the IR in its framework's dialect — MDX with JSX components for RSPress (`rspress-mdx-emitter.md`), plain markdown with Twoslash-annotated fences for VitePress (`vitepress-adapter.md`). The IR was extracted with two live consumers rather than designed up front, which is why both adapters run on it today and why the VitePress adapter is the gate for the core packages reaching 1.0 (`roadmap-1.0.md`).

## Current state

The package's modules, one per concern (see `packages/pages/CLAUDE.md` for its invariants):

| Module | Contents |
| --- | --- |
| `Blocks.ts` | The block vocabulary — `Schema.Class` variants and their union |
| `Page.ts` | The page record: `kind`, title facts, description, route, `headTags`, `blocks`, `nav` |
| `Nav.ts` | The per-API navigation tree (`buildNav`, `sortNavPages`) |
| `WorkItems.ts` | `prepareWorkItems` — a loaded model to per-API work items plus the cross-link route map, with uncategorized items and route collisions returned as data |
| `Build.ts` | `buildPage` (one builder per item kind, returning `Option<Page>`), `buildIndexPage`, `isPageKind` |
| `Examples.ts` / `TwoslashDirectives.ts` | Display/source preparation: hidden-import prepending, directive stripping, Prettier formatting (`formatExampleCode`, Effect-typed `ExampleFormatError`), the cut/directive grammar |
| `Markdown.ts` | The neutral plain-markdown emitter (`renderMarkdown`), the IR's dependency-free serializer |
| `Llms.ts` | The llms.txt text transforms (`llms-integration.md`) |
| `Scope.ts` | API scope naming — `apiScopeOf`, `unscopedName`, `normalizeBaseRoute` |

The package depends on `@tsdoctor/model` (items, TSDoc, routes, anchors, the `CrossLinker`), `@effected/markdown` (mdast and the MDX vocabulary) and `@tsdoctor/seo` for the `HeadTag` type only. It is I/O-free, imports no framework and no `shiki` / `hast` / `react`, and fails with typed errors. Prettier is inside the package deliberately: it is CPU-bound and I/O-free, and both adapters must format examples identically or llms output diverges between frameworks.

**The public surface is flat.** `src/index.ts` re-exports every symbol by name with no `export * as` namespaces. API Extractor's dts rollup cannot attribute a class referenced across a namespace boundary (`Page` → its `Block` members), so a namespaced surface produced forgotten-export warnings that fail CI. The consequence is concept-qualified names where a bare one would collide (`ExampleGroup`, `ParameterTable`, `EnumMemberTable`, `buildNav`, `formatExampleCode`); prefer that spelling for anything added later.

## A page, not a body

The unit of the IR is a page: the facts the frontmatter is built from (title parts, description, route, the `HeadTag[]` from `@tsdoctor/seo`), an ordered list of blocks and the page's entry in the navigation tree. The model's `Render` module renders only a body and had no place for any of those, which is why the RSPress adapter once grew its own page generators around it. `Page` carries a required `kind` so an emitter can choose imports and layout without re-inspecting the item; the landing page is a separate, blockless `IndexPage`.

## Block vocabulary

A page is built from a title with an optional release-tag badge and deprecation notice; an "available from" line for multi-entry items; prose sections (summary, remarks, returns, see-also) as mdast; a signature block; member groups whose members each carry their own signature, summary and anchor; parameter and enum-member tables as typed rows; example groups; the synthetic base-class section; a source link; and, for namespaces, a member index. Category-specific pages compose the same blocks in different orders. The exact field lists are `Blocks.ts`'s job to define.

**Anchors arrive as data.** A member block carries the anchor id computed once by `ApiItems.memberAnchors` (`@tsdoctor/model`) and threaded through the work item. No emitter recomputes an anchor: the route map's `#fragment` and the page's element id come from one computation (`cross-linking-architecture.md`). The builder falls back to recomputing anchors only for out-of-pipeline callers, so the pipeline path must pass the map — a dropped argument would silently revert agreement to two computations matching.

**Prose is linked before it enters the IR.** `Build.ts` applies the per-API `CrossLinker` to a prose string, then parses the linked string as commonmark mdast, so a prose block is already linked and every emitter renders identical links. The parse is total. Code-block linking stays an emitter concern.

**The error channel is `never`.** Example formatting runs through `formatExampleCode`; a failure invokes the caller's `onExampleFormatError` hook and the example carries its unformatted code, which is where the RSPress adapter emits its `PrettierError` event.

## The display and source split

A code-bearing block carries two text fields: `display`, the Prettier-formatted, directive-stripped code a reader sees and copies, and `source`, the type-check text — hidden imports, then `// ---cut---`, then the code with any Twoslash directives intact. Each emitter spends them differently: RSPress emits both as props and hides the pre-cut lines at render time; VitePress emits `source` as the fence body and lets Twoslash's native cut notation hide them. The split is the one place the two render pipelines genuinely differ, and carrying both fields is cheaper than teaching either emitter to derive one from the other.

## Navigation output

`buildNav` produces one tree per API: category groups (label, folder, collapsible settings from the resolved category config) containing pages (label, route) in label-sorted order, plus the index page. The RSPress adapter renders it to `_meta.json` files; the VitePress adapter renders it to a `themeConfig.sidebar` entry. A sidebar that is files in one framework and config in another can only be neutral as data.

## What stays adapter-side

- **Frontmatter assembly.** The IR carries the facts; the adapter builds the block, because the two frameworks spell a JSON-LD script body differently (RSPress: a `children` attribute; VitePress: a third tuple element) and because the RSPress snapshot hash is taken over the final assembled frontmatter (`snapshot-tracking-system.md`).
- **Component import lines and JSX** — an RSPress emitter detail.
- **Code-block rendering, runtime components and lifecycle wiring** — the three coupled areas `tsdoctor-package-architecture.md` names.

## Representation

Blocks are `Schema.Class` variants carrying `Schema.tag` on a domain-named discriminant (`kind`), unioned with `Schema.Union` — the same shape `@effected/markdown` uses for mdast nodes, whose discriminant is `type`. `packages/pages/__test__/blocks.test.ts` pins what the choice has to prove: the union covers every variant exactly once, a block round-trips with class identity on decode, nested mdast prose decodes back to kit node classes and a mismatched discriminant is rejected. Not `Data.TaggedEnum`, because the IR must be decodable and serializable as a stable artifact; not `Schema.TaggedClass`, because it hardwires `_tag` and a vocabulary that sits beside mdast reads better with its own key.

## Carried quirks

Two behaviours of the former RSPress generators are carried deliberately, because the lift was validated by byte identity and normalizing them is a product change for a labelled commit:

- The summary paragraph is not cross-linked (no generator linked it).
- The namespace member index routes members into the default category folders rather than the configured ones.

## Open decision

**The fate of the model's `Render`.** `Render.tree` / `Render.item` / `Render.docs` are public in `@tsdoctor/model` and now marked `@deprecated` in favour of `@tsdoctor/pages`'s `renderMarkdown`. The model cannot depend on `@tsdoctor/pages` without a cycle, so the IR's markdown serializer lives in `pages`. The lean is to delete `Render` a minor after the deprecation ships; the alternative is keeping it as the model's dependency-light body renderer for consumers who want text and no page.

## Rationale

- **Why lift the generators rather than grow `Render.tree`:** the body renderer is the subset; the generators were the product. Growing the subset toward the product would re-derive decisions already taken and tested.
- **Why two live consumers:** an IR built for one consumer is shaped by that consumer — the same outcome as designing it up front. The RSPress adapter switched behind a byte-identity gate so the switch was a refactor with an oracle (`rspress-mdx-emitter.md`).
- **Why the kit, not local code, closes gaps:** any capability the IR needs that `@effected/markdown` lacks is raised through the dogfood loop, never reimplemented locally — a local mdast helper is exactly the drift the consolidation exists to eliminate (`tsdoctor-package-architecture.md`).

## Related documentation

- **RSPress MDX emitter and the byte-parity decisions:** `rspress-mdx-emitter.md`
- **VitePress adapter:** `vitepress-adapter.md`
- **The pipeline stages that run the builders:** `page-generation-system.md`
- **Member anchors and the `CrossLinker`:** `cross-linking-architecture.md`
- **`prepareWorkItems` and the "Available from" block:** `multi-entry-resolution.md`
- **Package architecture and the core-move candidates:** `tsdoctor-package-architecture.md`
- **Roadmap and the phase-5 gate:** `roadmap-1.0.md`
