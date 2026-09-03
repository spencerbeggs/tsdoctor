---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-09-02
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/roadmap-1.0.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/cross-linking-architecture.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/llms-integration.md
  - rspress-plugin-api-extractor/render-phase-instrumentation.md
---

# Doc IR and `@tsdoctor/pages`

> This is the phase-5 design doc named in `roadmap-1.0.md`'s "Deferred Design Docs" table. Written forward-looking on 2026-09-02, it now records DELIVERED work: `packages/pages` exists with its `ApiItem` → `Page` builders, the RSPress adapter generates every page through the IR behind the golden gate, and `platforms/vitepress/` plus `sites/vitepress-basic` exist and hold the alpha gate (see [Phase 1 delivered](#phase-1-delivered), [Phase 2 delivered](#phase-2-delivered) and [Phase 3 delivered](#phase-3-delivered)). The decisions marked **settled** were taken by the owner in the 2026-09-02 planning session; the one decision still open is listed under [Open decisions](#open-decisions). For the RSPress adapter as it stands, see `page-generation-system.md` and `build-architecture.md`; for the VitePress adapter's own invariants, `platforms/vitepress/CLAUDE.md`.

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [The IR](#the-ir)
- [Package topology](#package-topology)
- [The emitters](#the-emitters)
- [Extraction by characterization](#extraction-by-characterization)
- [Tier 2 core moves](#tier-2-core-moves)
- [Kit expansion via dogfood](#kit-expansion-via-dogfood)
- [The alpha gate](#the-alpha-gate)
- [Open decisions](#open-decisions)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

Phase 5 carves the last framework-neutral concern out of the RSPress adapter: **what a generated API page contains**. Before phase 2 that knowledge lived in ~2,100 lines of string-concatenated MDX under `platforms/rspress/src/markdown/page-generators/`, which is exactly the code a second adapter would have to reimplement. `@tsdoctor/pages` lifts that structure into a typed intermediate representation — a page is a sequence of doc blocks, prose inside them is `@effected/markdown` mdast — and each adapter becomes an **emitter** that spends the IR in its framework's dialect: MDX with JSX components for RSPress, plain markdown with Twoslash-annotated fences for VitePress.

The roadmap's settled rule shapes the whole design: the IR is extracted here, with two live consumers, not designed up front. The VitePress adapter is the second consumer and the 1.0 gate for the core. Three decisions taken on 2026-09-02 fix its shape:

- **VitePress 2.x is the target** — `vitepress@2.0.0-alpha.19`, vendored at `.repos/vitepress` (`src/node`, `src/client`, `src/shared`, `docs/en`). `@shikijs/vitepress-twoslash` is vendored at `.repos/shiki/packages/vitepress-twoslash` (shiki re-pinned to v4.4.3, the installed version). Both are the authority when framework behaviour is unclear; see `.repos/config.json` for their orientation maps.
- **The VitePress alpha is markdown-only.** No Vue components. Signatures, members and examples are ordinary fenced code blocks, type-checked by the native `@shikijs/vitepress-twoslash` transformer through VitePress's `markdown.codeTransformers`; parameter and enum tables are markdown tables.
- **The RSPress adapter switches to the IR immediately**, behind a golden-file gate, rather than keeping its generators until the alpha proves the IR. Otherwise the IR is shaped by one consumer again — the failure mode the two-consumer rule exists to prevent.

## Current state

All three phases of the work this document describes are in the tree — `@tsdoctor/pages`, the RSPress adapter running on it, and the VitePress adapter with its fixture site (see the three "delivered" sections below). What existed before phase 1, verified against the tree on 2026-09-02, is the material the IR was lifted from:

**`Render.tree` in `@tsdoctor/model` is not the seed.** `packages/model/src/Render.ts` renders a plain-markdown BODY — H1, a deprecation blockquote, summary, one `ts` fence for the signature, a parameters list, `### member` headings with fences, an examples section — in about a hundred lines. That is a serviceable fallback for a consumer with no framework at all, but it is not the product's page. Everything the product needs that the body lacks is in the adapter's generators: the `ApiSignature` / `ApiMember` / `ApiExample` elements carrying DUAL `code` (display) and `source` (type-check) props, `ParametersTable` and `EnumMembersTable` as JSON props, member `id=` anchors from the shared `memberAnchors` map, the synthetic "Base Class" section, the "Available from" line, release-tag badges, deprecation notices, the `SourceCode` toolbar link, and frontmatter with head tags. Therefore **`@tsdoctor/pages` is the generators' structure lifted into typed blocks**; the model's `Render` is the thing that gets superseded, not extended (see [Open decisions](#open-decisions) for its fate). The earlier "Stage 2 output convergence" note in `build-architecture.md` deferred exactly this convergence — the diff it cites (`docs/superpowers/notes/2026-06-01-renderitem-vs-pagegen-diff.md`) no longer exists in the tree, and phase 5 resolves the deferral rather than re-deriving it.

**The display/source split already exists as data.** `markdown/helpers.ts`'s `prependHiddenImports` builds the `source` prop as the external `import type` lines, a `// ---cut---` line, then the code; `hide-cut-transformer.ts` hides the pre-cut lines at RSPress render time. The display `code` prop is the Prettier-formatted, directive-stripped text the copy button and the non-Twoslash path show. The IR only has to carry what the generators already compute.

**Navigation is emitted as files today.** `writeMetadata` (`build-stages.ts`) writes a root `_meta.json` and one per category folder, and RSPress derives the sidebar from them. VitePress's sidebar is CONFIG — `themeConfig.sidebar`, an object of groups with `text`/`link`/`items`/`collapsed` (`.repos/vitepress/docs/en/reference/default-theme-sidebar.md`). Navigation therefore cannot stay a write-stage side effect.

**Head tags are already neutral.** `@tsdoctor/seo`'s `headTags` returns a `HeadTag[]` the RSPress adapter renders into frontmatter `head` pairs (`structured-data-and-og.md`). VitePress accepts the same `[tag, attrs]` pair form in per-page frontmatter `head` (`.repos/vitepress/docs/en/reference/frontmatter-config.md`), plus a `[tag, attrs, innerHTML]` triple for script bodies (`HeadConfig` in upstream `types/shared.d.ts` at v2.0.0-alpha.19 — outside the sparse checkout, verified against the tag), and exposes `transformHead` / `transformPageData` hooks (`.repos/vitepress/src/node/siteConfig.ts`).

**Prose cross-linking is neutral; code-block cross-linking is not.** The model `CrossLinker` links prose; `ShikiCrossLinker` post-processes RSPress's remark-rendered HAST (`cross-linking-architecture.md`).

**The kit's MDX vocabulary is real.** `@effected/markdown@0.7.0` constructs and serializes `MdxJsxFlowElement` / `MdxJsxAttribute` / `MdxJsxAttributeValueExpression`, proof-tested by `packages/model/__test__/mdx-vocabulary.test.ts` against precisely the `<ApiSignature code={...} />` shape the RSPress emitter needs.

### Phase 1 delivered

`packages/pages` (`@tsdoctor/pages`) landed on `feat/phase-5` (commits `9eacf09..4760e88`, 2026-09-02). What exists: the block vocabulary (`Blocks.ts`), the page record and per-API navigation tree (`Page.ts`, `Nav.ts`), display/source preparation with Prettier formatting living in the package as the Effect-typed `formatExampleCode` failing with `ExampleFormatError` (`Examples.ts`, plus the shared directive/cut regexes in `TwoslashDirectives.ts`), the neutral plain-markdown emitter (`Markdown.ts`), the llms.txt text transforms (`Llms.ts`) and the API scope naming helpers (`Scope.ts`). Two of the Tier 2 moves below are therefore done. The builders, the RSPress emitter and the golden gate followed in phase 2, below. See `packages/pages/CLAUDE.md` for the package's own invariants.

### Phase 2 delivered

The RSPress switch landed on `feat/phase-5` (commits `7307600`, `4ef86d2`, `babe06a`, 2026-09-02). What exists:

- **`packages/pages/src/Build.ts`** — `buildPage`, one builder per item kind lifted from the generators as a characterization (same blocks, same order, same text), plus `buildIndexPage` for the landing page and `isPageKind` for the kinds that get a page. `BuildPageInput` is neutral: the item, the category facts, the work item's `availableFrom` / `syntheticBase` / `memberAnchors`, the namespace member's qualified name (which decides the route and the nav label), the source-link target and the per-API `CrossLinker`. `Page` gained a required `kind` (`PageKind`) so an emitter can choose component imports and layout without re-inspecting the item; the landing page is a separate, small `IndexPage` schema (route, title, description — no blocks). `buildPage` returns `Option<Page>` and its error channel is `never`: Prettier failures degrade through the `onExampleFormatError` hook to the unformatted code, which is where the adapter emits its `PrettierError` event.
- **The RSPress emitters** — `platforms/rspress/src/emit/mdx.ts` (`emitMdxBody` plus `escapeMdxGenerics`; the labelled `unescapeLiteral` shim it shipped with is deleted since the kit's 0.8.0 adoption — see [Kit expansion via dogfood](#kit-expansion-via-dogfood)) and `src/emit/meta.ts` (the root and per-category `_meta.json` from the nav tree, `index.mdx` from the `IndexPage`). The decisions behind the MDX emitter are recorded under [RSPress MDX emitter](#rspress-mdx-emitter).
- **Deleted from the adapter:** the eight generator classes under `markdown/page-generators/`, `markdown/prose-linker.ts` (see the race below), and the `twoslash-patterns.ts` / `code-post-processor.ts` re-export shims; the generator tests went with them. `markdown/helpers.ts` keeps only `generateFrontmatter`. `generateSinglePage` now calls `buildPage` then `emitMdxBody` and reassembles the frontmatter-plus-body text the generators produced, so the frontmatter parse, the spacing normalization and the snapshot hashes read exactly what they always read; `writeMetadata` builds the nav tree with `buildNav` and renders through `emit/meta.ts` (`page-generation-system.md`).
- **The golden gate held, with one labelled deviation** — a real bug, recorded under [Gate result](#gate-result).
- **Three `@effected/markdown` gaps** surfaced by the lift; they were raised through the dogfood loop the same day and closed in the kit's 0.8.0 round — see [Kit expansion via dogfood](#kit-expansion-via-dogfood).

### Phase 3 delivered

The VitePress adapter and its fixture site landed on `feat/phase-5` (commits `25716a9`, `b09db83`, `e9dfa6a`, `9bf24f8`, 2026-09-02/03), followed by the kit-adoption commits (`53f08bf`, `935248e`) and a dead-code sweep of the RSPress adapter (`8ef0aa0`, `2e0a8aa`). What exists:

- **`platforms/vitepress/` (`vitepress-plugin-api-extractor`)** — built with `@savvy-web/bundler`'s `build()` rather than `@savvy-web/rspress-builder`, which is RSPress-specific; the tsconfig extends `@savvy-web/bundler/tsconfig/ecma.json` and `vitepress` is a peer. One public helper, `apiExtractor(options)` (`src/ApiExtractor.ts`), awaited by the site's `docs/.vitepress/config.mts` at config-load time, returning `{ sidebar, codeTransformers, hooks: { buildEnd }, generated }` for the site to merge into `defineConfig`. `buildEnd` persists the Twoslash result cache and disposes the runtime; under `vitepress dev` it never fires, so a dev session does not save the cache. This resolves the generation-trigger decision on its lean.
- **The modules.** `Generate.ts` is the Effect program — `discoverBundle` → `Model.load` → `ApiExtractedPackage.toVfs` plus import prepending → external types through `@tsdoctor/registry` (degrading) → `resolveTypeScriptConfig` → `prepareWorkItems` → `buildPage` → emit → write, every file written on every build. `Registry.ts` composes the registry stack over the shared `"tsdoctor"` XDG namespace; `Twoslash.ts` builds `transformerTwoslash` from `@shikijs/vitepress-twoslash`; `TwoslashCache.ts` is `TwoslashCacheStore`, a `Context.Service` over an `@effected/store` `Cache` (`Cache.degrading`) persisting `@tsdoctor/vfs`'s generation blobs; `Categories.ts` holds `DEFAULT_CATEGORIES`, mirroring the RSPress defaults; `emit/{markdown,frontmatter,sidebar}.ts` are the emitters described under [VitePress markdown emitter](#vitepress-markdown-emitter).
- **Two lifts into core made the second consumer cheap.** `prepareWorkItems` moved from the RSPress `build-stages.ts` into `@tsdoctor/pages` as `WorkItems.ts` — entry-point deduplication, synthetic bases, categorization, collision detection, the priority-arbitrated route map, member anchors and namespace members — with `uncategorized` items and route `collisions` returned as DATA. The RSPress adapter keeps a reporting wrapper of the same name that emits `ItemSkipped` per uncategorized item and `RouteCollisionDetected` per collision before throwing `Routes.RouteCollisionError`, exactly as before; the VitePress adapter dies on a collision and reports `uncategorized` in its result. And the Twoslash result cache moved into `@tsdoctor/vfs`, closing the second open decision — see [Tier 2 core moves](#tier-2-core-moves).
- **`sites/vitepress-basic` (`@sites/vitepress-basic`)** consumes the same `modules/kitchensink` model folder `sites/basic` does — kitchensink's `meta.localPaths` populates both — and sets `siteOrigin`, so the canonical / Open Graph / JSON-LD path is exercised end to end. Its theme file (`docs/.vitepress/theme/index.ts`) registers `@shikijs/vitepress-twoslash`'s client plugin (`TwoslashFloatingVue`) and stylesheet: the transformer's own documented setup, required for the SSR hover markup to render, and not a component the site or the adapter authors. The emitted markdown stays component-free.
- **Two deliberate deviations** from the emitter description as first written — the VFS goes in as `extraFiles`, not `fsMap`, and declaration fences carry `// @noErrors` — are recorded under [VitePress markdown emitter](#vitepress-markdown-emitter).
- **The alpha gate held** — see [Alpha gate result](#alpha-gate-result).

## The IR

### A page, not a body

The unit of the IR is a **page**: the facts the frontmatter is built from (title parts, description, route, the `HeadTag[]` from `@tsdoctor/seo`), an ordered list of **blocks**, and the page's entry in the navigation tree. The model's body-only rendering had no place for any of those, which is why the adapter grew its own generators around it.

### Block vocabulary

The vocabulary is the set of things the eight generators emit, named once. At the level this document commits to, a page is built from: a title with an optional release-tag badge and deprecation notice; an "available from" line for multi-entry items; prose sections (summary, remarks, returns, see-also) as mdast `FlowContent`; a **signature block**; **member blocks** (constructor, property, method, each with its own signature, summary and anchor); **parameter** and **enum-member tables** as typed rows, not pre-rendered markdown; **example blocks**; the synthetic **base-class section**; and a **source link**. Category-specific pages (function, type alias, variable, enum, namespace) compose the same blocks in different orders; the namespace page nests member pages' blocks under qualified headings. The exact field lists are the package's job to define and the code's job to document — see `packages/pages/src/Blocks.ts`.

**Anchors arrive as data.** A member block carries the anchor id computed once by `ApiItems.memberAnchors` (`@tsdoctor/model`) and threaded through the work item. No emitter recomputes an anchor: `cross-linking-architecture.md` records the dead cross-links a second spelling produced, and the invariant is that the route map's `#fragment` and the page's element id come from one computation. The RSPress emitter writes it as the `id=` prop; the VitePress emitter writes it as a custom heading anchor (`### name {#id}`, the syntax `.repos/vitepress/docs/en/guide/markdown.md` documents).

**Prose is linked before it enters the IR.** `Build.ts` applies the per-API model `CrossLinker` (`fromRoutes` over the same route map the Shiki linker is built from) to a prose string and then parses the linked string as commonmark mdast, so a prose block is already linked mdast and every emitter renders identical links. The parse is total — a pathological string degrades to a text node. Two generator quirks are carried deliberately, because the golden gate cannot see a fix and normalizing them is a product change for a later, labelled commit: the summary paragraph is NOT cross-linked (no generator linked it), and the namespace member index routes members into the DEFAULT category folders rather than the configured ones. Code-block linking stays an emitter concern — see [The emitters](#the-emitters).

### The display/source split

A code-bearing block (signature, member, example) carries **two separate text fields**: `display`, the Prettier-formatted, directive-stripped code a reader sees and copies, and `source`, the type-check text — hidden imports, then `// ---cut---`, then the code, with any Twoslash directives intact. This is the shape `prependHiddenImports` already produces, made explicit. Each emitter spends them differently:

- **RSPress** emits both as props (`code` and `source`), exactly as today. Shiki and Twoslash run in the remark pass on the `source` prop; `hide-cut-transformer.ts` hides the pre-cut lines; the `code` prop feeds the copy button and the SSG-MD branch.
- **VitePress** emits `source` as the fence body with a `ts twoslash` meta and lets Twoslash cut it: `// ---cut---` is native Twoslash notation (`.repos/twoslash/docs/refs/notations.md`, "Cutting a Code Sample") — the pre-cut text is type-checked, offsets are re-fitted and the reader sees only what follows the marker, which is the display code. No hide-cut transformer is needed. When a block is not type-checked (Twoslash disabled, or a `display` that deliberately differs from the cut result), the emitter falls back to `display` in a plain fence.

The split is the one place the two frameworks' render pipelines genuinely differ, and carrying both fields is cheaper than teaching either emitter to derive one from the other.

### Navigation output

The IR produces one **navigation tree per API**: category groups (label, folder, collapsible/collapsed settings from the resolved category config) containing pages (label, route), sorted the way `writeMetadata` sorts today, plus the index page. The RSPress adapter renders it to the root and per-category `_meta.json` files; the VitePress adapter renders it to a `themeConfig.sidebar` entry keyed by the API's base route. The tree is data, so both renderings are pure functions of it and the RSPress one is covered by the golden gate.

### What stays adapter-side

- **Frontmatter assembly.** The IR carries the facts; the adapter builds the block. RSPress needs `overview: true` on the index page and the `children` attribute spelling for a JSON-LD `<script>` body (`structured-data-and-og.md`); VitePress's `HeadConfig` has its own spelling for script bodies. More importantly, the frontmatter hash the snapshot system takes (`snapshot-tracking-system.md`) is over the FINAL assembled frontmatter in the generate stage, and that contract does not move.
- **Component import lines** (`import { ApiSignature, … } from "rspress-plugin-api-extractor/runtime"`) — an RSPress emitter detail.
- **Everything in the three coupled areas** `tsdoctor-package-architecture.md` names: runtime components, the remark/HAST pipeline, lifecycle wiring.

### Representation

**Settled, confirmed by code on `effect@4.0.0-rc.109`:** blocks are `Schema.Class` variants carrying `Schema.tag` on a **domain-named** discriminant (`kind`), unioned with `Schema.Union` (`packages/pages/src/Blocks.ts`) — the house sum-type model recorded in the `effect-v4-house-style` rules, and the same shape `@effected/markdown` uses for mdast nodes (whose discriminant is `type`). `packages/pages/__test__/blocks.test.ts` pins what the choice had to prove: the union covers every variant exactly once, a block encode/decode round-trips with class identity on decode, mdast prose nested in a block decodes back to kit node classes rather than plain objects, `kind` narrows without ceremony and a mismatched discriminant is rejected. Not `Data.TaggedEnum`: the IR must be Schema-typed so it can be decoded, validated at construction and, later, serialized as a stable artifact, and a `TaggedEnum` is none of those. Not `Schema.TaggedClass`: it hardwires `_tag`, and a vocabulary that sits beside mdast nodes discriminated on `type` reads better with its own named key. Package rule: `@tsdoctor/pages` is I/O-free, imports no framework and no `shiki`/`hast`/`react`, and fails with typed errors — Effect v4 house style throughout.

## Package topology

**`packages/pages` (`@tsdoctor/pages`)** — publishable, fresh 0.x line, `private: true` in source with `publishConfig` doing the publishing like every sibling, `@effected/*` via `catalog:effected`. Depends on `@tsdoctor/model` (items, TSDoc, routes, anchors, the `CrossLinker`) and `@effected/markdown` (mdast and, for the RSPress emitter's benefit, the MDX vocabulary); `@tsdoctor/seo` only for the `HeadTag` type the page facts carry. One module per concern, in the same spirit as `packages/seo`:

| Module | Contents |
| --- | --- |
| `Blocks.ts` | The block vocabulary — the `Schema.Class` variants and their union (delivered) |
| `Page.ts` | The page record: facts, blocks, nav entry (delivered) |
| `Nav.ts` | The per-API navigation tree (delivered) |
| `Examples.ts` / `TwoslashDirectives.ts` | Display/source preparation for code blocks: hidden-import prepending, directive stripping, formatting, and the cut/directive grammar both sides share (delivered) |
| `Markdown.ts` | The neutral plain-markdown emitter — the IR's dependency-free serializer, superseding the model's `Render.tree` (delivered) |
| `Llms.ts` | The llms.txt text transforms, moved from the adapter (delivered) |
| `Scope.ts` | API scope naming — `apiScopeOf`, `unscopedName`, `normalizeBaseRoute` (delivered) |
| `Build.ts` | The `ApiItem` → `Page` builders, one per item kind, plus `buildIndexPage` and `isPageKind` — the lifted generators (delivered, phase 2) |
| `WorkItems.ts` | `prepareWorkItems` — the per-API step from a loaded model to work items plus the cross-link route map, with `uncategorized` and `collisions` returned as data (delivered, phase 3, lifted from the RSPress adapter) |

**Settled (2026-09-02): the public surface is FLAT.** `src/index.ts` re-exports every symbol by name; there are no `export * as` namespace modules, unlike `@tsdoctor/model`. API Extractor's dts rollup cannot attribute a class referenced across a namespace boundary — `Page` → its `Block` members, `buildExample` → `Example` — and the namespaced first cut produced 25 warnings including the CI-fatal `ae-forgotten-export`. The consequence is concept-qualified names where a bare one would collide or read ambiguously in a flat list: `ExampleGroup`, `ParameterTable`, `EnumMemberTable`, `buildNav`, `sortNavPages`, `buildExample`, `formatExampleCode`, `renderMarkdown`, `markdownTree`. Prefer that spelling for anything added later rather than reintroducing a namespace to disambiguate.

Example formatting is inside the package deliberately. Prettier is CPU-bound and I/O-free, and both adapters must format identically or the golden gate cannot be shared and llms output diverges between frameworks; the RSPress generators already run it before the text is placed in a prop, so this is a move, not a new step.

**`platforms/vitepress/`** (delivered, phase 3 — module list under [Phase 3 delivered](#phase-3-delivered)) — the second adapter, the VitePress config helper plus the markdown emitter and the Twoslash/VFS wiring. **Settled (2026-09-02): the package is `vitepress-plugin-api-extractor`**, for symmetry with `rspress-plugin-api-extractor` — the framework-adapter reading, one naming rule for every `platforms/*` workspace. `@tsdoctor/vitepress` was considered and not taken; the org namespace stays for the core packages. Remember `pnpm --filter` matches the package name, not the folder.

**The RSPress emitters** live in `platforms/rspress/src/emit/` (`mdx.ts`, `meta.ts`) — RSPress-shaped MDX and sidebar files belong with the runtime components and lifecycle they target.

**`sites/vitepress-basic` (`@sites/vitepress-basic`)** (delivered, phase 3) — a fixture site consuming the same `modules/kitchensink` bundle `sites/basic` consumes, through the same `@tsdoctor/bundle` discovery. It is the alpha's proving ground and the second half of the "same bundles" clause in the gate.

## The emitters

### RSPress MDX emitter

**Delivered (phase 2):** `src/emit/mdx.ts` and `src/emit/meta.ts`. Owns: the component import lines (chosen from `Page.kind`); JSX elements built as `@effected/markdown` MDX nodes (`MdxJsxFlowElement` with `JSON.stringify`'d attribute expressions — the shape the proof consumer pins); parameter and enum tables as JSON props to `ParametersTable` / `EnumMembersTable`; `_meta.json` from the nav tree and `index.mdx` from the `IndexPage`. Frontmatter assembly and the head-tag pairs stay in `markdown/helpers.ts`, called from the generate stage. Unchanged and untouched by phase 5: the remark plugins, `ShikiCrossLinker`, the hide-cut transformers, the snapshot hashing in `generateSinglePage`, the SSG-MD runtime components. The emitter replaced the eight generator classes and reproduces their bytes — see [Extraction by characterization](#extraction-by-characterization).

Four decisions inside the MDX emitter are worth recording, because each one is a place a later change could quietly break byte parity:

- **Per-top-level-node serialization, with the emitter owning the joins.** Each block's node is serialized as its own one-node `Root` and the emitter places the separator — a blank line, or the single newline the generators left between an enum signature and its members table. Serializing the page as one tree is not an option: the kit's MDX-presence escaping is tree-wide, so the moment a `MdxJsxFlowElement` is present it rewrites `{` in every prose node of the tree, and the generators emitted that prose raw. Nothing in this module assembles MDX from string fragments; the joins are the one thing it spells itself.
- **Generics escaping is done on the mdast tree**, not on the serialized string: a `<T>` / `<K, V>` run in a `Text` node (or a raw-HTML node that IS a generic) becomes an `InlineCode` node, which the kit serializes as the backticked form `escapeMdxGenerics` produced. The string-level regex would no longer see the generic after the kit escaped the `<`. It is applied exactly where the generators applied `escapeMdxGenerics` — the deprecation notice, member summaries and returns, function-level parameter descriptions, the function's returns section, see-also references and the namespace member index — and deliberately NOT to member-level parameter descriptions or enum member descriptions, which the generators emitted unescaped. That inconsistency is preserved, and flagged: fixing it is a product change for a later, labelled commit, not a lift.
- **Prose enters the IR by parsing the linked string** (commonmark), so what the emitter serializes is what the generators wrote. The lift checked that parse-then-stringify is the identity over the real TSDoc strings the fixture sites produce (roughly five hundred of them); the golden gate is the durable form of that check.
- **Nothing post-processes the kit's bytes.** A labelled `unescapeLiteral` shim used to reverse the kit's `\_` / `\&` escaping in headings and member-index link text; `@effected/markdown` 0.8.0 escapes both minimally (see [Kit expansion via dogfood](#kit-expansion-via-dogfood)) and the shim is deleted (`935248e`), the tests pinning the raw bytes directly. Author prose never passed through it and still does not — except that a written `\_` which cannot bind emphasis now round-trips to `_`, the kit dropping a redundant escape.

### VitePress markdown emitter

**Delivered (phase 3):** `platforms/vitepress/src/emit/markdown.ts`, `emit/frontmatter.ts`, `emit/sidebar.ts`. Owns: fenced blocks with `ts twoslash` meta carrying `source` (cut markers native, no hide transformer); GFM tables from the typed rows (the kit's `Table` / `TableRow` / `TableCell` nodes); custom heading anchors from the member anchor ids (`### name {#anchor}`, the suffix riding as trailing text in the `Heading`); the sidebar object from the nav tree (`sidebarFor(navTree)`, one `themeConfig.sidebar` entry keyed by `${baseRoute}/`); per-page frontmatter `head` from the `HeadTag[]`. Unlike the RSPress emitter it serializes the page as ONE tree — there is no JSX to trigger the kit's presence-keyed escaping — and nothing post-processes the kit's bytes. **Settled:** head tags ride the frontmatter `head` route exactly as they do on RSPress — a `meta`/`link` tag becomes a `[tag, attrs]` pair and the JSON-LD `script` becomes the `[tag, attrs, innerHTML]` triple VitePress's `HeadConfig` defines for inner HTML — so `transformHead` is not needed for the alpha. The one spelling difference from RSPress (a third tuple element rather than a `children` attribute) is precisely why frontmatter assembly stays adapter-side.

Two deviations from this section as first written are deliberate:

- **Declaration fences carry `// @noErrors`.** A signature, member or base-class excerpt is not a program — its type parameters and the sibling types it names are out of scope — so Twoslash annotated nearly every such line with "Cannot find name": 964 error annotations across the fixture site without the directive. `declarationFence` prepends it (unless the source already carries it), so the block keeps its hovers and drops the diagnostics. Examples are untouched: the builder decides their `@noErrors` through `suppressExampleErrors`. RSPress never type-checks these blocks at all, so this is strictly more type information, not less.
- **The VFS goes in as `twoslashOptions.extraFiles`, not `fsMap`** — the next paragraph.

The Twoslash environment is the same one RSPress uses, reached through a different door. `@shikijs/vitepress-twoslash`'s `transformerTwoslash` (`.repos/shiki/packages/vitepress-twoslash/src/index.ts`) wraps `createTransformerFactory` from `@shikijs/twoslash/core` and spreads its options through, so the adapter (`src/Twoslash.ts`) supplies the combined VFS as `twoslashOptions.extraFiles` plus the compiler options from `@tsdoctor/vfs`'s seam through `toProgrammaticCompilerOptions` (`type-loading-vfs.md`) — the same inputs, the same normalization — and passes a `typesCache`. **Not `fsMap`, which this paragraph first named.** Twoslash treats a supplied `fsMap` as the ENTIRE file system (`useFS = !!createOptions.fsMap` in the engine — the local `node_modules` overlay switches off), so handing it the combined VFS alone drops every `lib.*.d.ts` and type-checks against nothing. `extraFiles` is overlaid on the compiler's own libs, which is how the RSPress transformer builds the same environment; "the same VFS and compiler options" means the same overlay. `typesCache` is the `TwoslashTypesCache` extension point from `@shikijs/twoslash` (`.repos/shiki/packages/twoslash/src/types.ts`), implemented by `@tsdoctor/vfs`'s `makeTwoslashCache` (moved there from the RSPress adapter — [Tier 2 core moves](#tier-2-core-moves)), so both adapters share one persisted cache and one keying scheme (`render-phase-instrumentation.md`). The adapter also passes `throws: false` and `handbookOptions.noErrorValidation`, so a diagnostic renders as an annotation rather than failing the build — examples are documentation, not a test suite. The transformer is registered through `markdown.codeTransformers` (`.repos/vitepress/src/node/markdown/plugins/highlight.ts`). VitePress's `explicitTrigger` defaults to `true`, so the emitter marks every type-checked fence with the `twoslash` meta and nothing else in the site is affected.

**Code-block cross-links are out of scope for the alpha — settled.** `ShikiCrossLinker` is a three-phase HAST walk over RSPress's Twoslash output, coupled to that renderer's span structure; VitePress renders through `rendererFloatingVue` with a different HAST shape, so a port is a rewrite, not a copy. It could be done as a Shiki transformer later, but the gate is "renders a real API doc site", and prose links plus working anchors satisfy it. Recording it as out of scope keeps the alpha from spending its budget on the one piece of RSPress-side logic the architecture doc already classifies as adapter-owned.

**Where generation runs — RESOLVED on the lean.** VitePress has no pre-scan hook comparable to RSPress's `config()` that can write pages before routing; its config file is ESM and can top-level await, and `buildEnd` / `postRender` run after the fact. Generation runs at config-load time behind `apiExtractor()`, which the site's `.vitepress/config.mts` awaits; it returns the sidebar entry, the `codeTransformers` entry and the `buildEnd` hook to merge into `defineConfig`. The CLI pre-step alternative (`@tsdoctor/cli`) stays unscheduled and the alpha does not depend on it.

## Extraction by characterization

The RSPress switch is a refactor with a hard oracle: **byte-identical generated output for all five fixture sites** (`basic`, `versioned`, `i18n`, `multi`, `effect`), taken as golden files before the switch and diffed after. Two measurements, both required:

- **`diff -r` of the generated `api/` trees** (every `.mdx` and `_meta.json`) against the captured golden. Zero differences.
- **The snapshot rebuild count.** A rebuild of each site over the IR must report every file unchanged, and a subsequent no-change rebuild must stay byte-identical — the same evidence `structured-data-and-og.md` used, for the same reason: a unit test can pass forever on an input no caller produces, and only a rebuild count over the real pipeline sees what the pipeline actually emits. `sites/basic` is the site with `siteOrigin` and `ogImage` configured, so it is the one that exercises head tags and timestamp preservation end to end.

Byte-identity is achievable because `normalizeMarkdownSpacing` runs in the generate stage and the snapshot system preserves timestamps across a rebuild (`snapshot-tracking-system.md`) — phase 4 proved a no-change rebuild is `diff -r` clean. The gate is taken over the WRITTEN files, after normalization, which is also what a consumer's git diff would show.

**No unlabelled deviation.** A byte difference is either an IR bug or a deliberate fix, and a deliberate fix is recorded in this document with its cause before the golden is regenerated — the precedent is the `index.mdx` double-quoting note in `page-generation-system.md`. The expectation was zero fixes in the first cut: the lift is structural, and any behaviour change it tempts is a separate commit.

### Gate result

Run on 2026-09-02 against goldens captured before any adapter change. Three sites byte-identical: `basic` (46 files), `i18n` (46), `effect` (30). Two sites differ by exactly one file each — `versioned` at v1's `class/logger.mdx`, `multi` at effect-kit's `namespace/runmanifest.mdx` — and both are the ONE labelled deviation, which is a real bug the lift fixed rather than introduced.

The old generators linked prose through the module-level `markdown/prose-linker.ts` holder, and `generateApiDocs` runs once per API at concurrency 2. Whichever API installed the holder last owned it for every page generated afterwards, so under a multi-API build one API's prose was linked against another's route map: on `versioned`, v1 pages linked into v2's default-version routes (`/api/class/logger` instead of `/v1/api/class/logger`); on `multi`, effect-kit pages were linked against kitchensink's map, so `Encoded` was never linked at all. The IR builder takes the `CrossLinker` per API through the pipeline context (`GenerateSinglePageContext.linker`), so links are now deterministic — `cross-linking-architecture.md` records the defect beside the Shiki-side equivalent that was fixed in the pre-phase-4 refactor. The goldens were NOT regenerated: the two files now differ from a golden that was wrong.

The second measurement held on every site: a rebuild over the IR reports every file unchanged, and a subsequent no-change rebuild is `diff -r` clean; `sites/basic` proves head tags and timestamp preservation end to end.

The golden files are a one-time capture in the scratch tree, not a committed fixture — committing 200-odd MDX files per site to pin a refactor would leave a corpus nobody maintains. The durable regression coverage is the existing generator and pipeline test suite, re-pointed at the emitter, plus the snapshot rebuild check which costs nothing to keep running.

## Tier 2 core moves

`tsdoctor-package-architecture.md`'s Core-Move Candidates section left a Tier 2 set whose destinations wanted a second consumer to decide. The VitePress adapter is that consumer.

- **`llms-processing.ts` → `@tsdoctor/pages` (`Llms.ts`) — DONE (phase 1).** Pure string transforms over the cross-framework llms.txt standard, with zero imports of any kind (verified); the roadmap's "llms.txt wiring stays in the adapter" was a miss for this half. It moves so a second adapter emits byte-identical per-package files. `llms-program.ts` (I/O, RSPress `outDir`, `afterBuild`) stays.
- **`path-derivation.ts` — resolved by splitting it; the neutral half is DONE (phase 1, `Scope.ts`).** `deriveOutputPaths` encodes the `docs/{locale}/{version}/…` layout that RSPress's multiVersion and i18n conventions dictate; the alpha excludes both, so there is still no second consumer for the layout and it stays adapter-side as product policy. The scope-naming helpers (`apiScopeOf`, `unscopedName`, `normalizeBaseRoute`) move to `@tsdoctor/pages` beside the nav tree, because the API scope string must agree across adapters — it keys the Twoslash cache generations and names the per-package llms files.
- **`twoslash-cache.ts` → `@tsdoctor/vfs` (`TwoslashCache.ts`) — DONE (phase 3, commit `25716a9`).** Its only framework-flavoured edge was the `TwoslashTypesCache` type from `@shikijs/twoslash`, and the VitePress transformer consumes that same interface, so the cache is genuinely shared. It landed on the lean — beside `TsEnvironment` and the VFS hash it is keyed on — with `@shikijs/twoslash` as an optional peer of vfs alongside `typescript` and `@typescript/vfs`. The keying scheme and `TWOSLASH_CACHE_FORMAT` are unchanged, so warm caches stayed warm across the move. Each adapter keeps its own persistence service (`TwoslashCacheService` in RSPress, `TwoslashCacheStore` in VitePress) over the same XDG `tsdoctor/twoslash.sqlite` store and the same blob keys. **Measured:** the VitePress fixture's first build opened the generation the RSPress `sites/basic` build had already written, under the SAME environment hash — 14 hits on that first build, 100/100 on the warm rebuild — so a site built by either adapter warms the other.
- **`prepareWorkItems` → `@tsdoctor/pages` (`WorkItems.ts`) — DONE (phase 3, commit `b09db83`).** Not on the original candidate list, which scored it as adapter orchestration; the second consumer showed it is the per-API step every adapter runs. What the adapter kept is reporting — see [Phase 3 delivered](#phase-3-delivered).
- **Stays in the adapter:** the observability cluster (infrastructure, not logic — and a second adapter without diagnostics is a worse product, but that is a phase-6 question) and `category-resolver.ts` (sidebar presentation and multiVersion policy, settled in the Tier 1 record).

**The next tier, measured by building the second consumer and not yet taken.** Each is a place the VitePress adapter re-spells something the RSPress adapter already has, and each is labelled in the source as recorded Tier 2 duplication:

- `Generate.ts` re-spells the neutral half of RSPress's `layers/config-resolution.ts`: import prepending (`prependImportsToVfs`), dependency extraction from `package.json`, tsconfig resolution through `resolveTypeScriptConfig`, and the `PackageManifest` decode → `packageContext` derivation. The RSPress version is adapter-shaped — events, metrics, the multi-API and multi-version cascades — which is why the neutral parts were re-spelled rather than extracted in the alpha.
- `Categories.ts` duplicates the RSPress `DEFAULT_CATEGORIES` plus the override merge; the two must stay in step or the adapters generate different routes from one bundle.
- `Registry.ts` duplicates the registry-stack composition (`PlatformLive`, `AppDirsLive`, the metadata `Cache`, the `TypeRegistry` layer) that `TypeRegistryService.layer` and `layers/xdg.ts` compose in RSPress — including the `"tsdoctor"` namespace literal, so the drift hazard `build-architecture.md` records for that literal now spans two packages.
- RSPress's `hide-cut-transformer.ts` hand-matches `// ---cut---` line by line instead of using the directive helpers `@tsdoctor/pages` exports (`TwoslashDirectives.ts`).

Destinations are not decided here. The point of recording them is that the third consumer, or the 1.0 stabilization, takes them from a list rather than re-measuring.

**llms.txt for the VitePress alpha is out of scope — settled.** RSPress has `@rspress/plugin-llms` to post-process; VitePress has no first-party equivalent, so the adapter would have to generate `llms.txt` / `llms-full.txt` from scratch. With `Llms.ts` in core the pure half is ready when that work is scheduled; the alpha gate does not include it.

## Kit expansion via dogfood

**Settled rule:** any capability the IR needs that `@effected/markdown` lacks is closed by a dogfood loop against the sibling `effected` checkout — `/silk:dogfood`, `file:` overrides for the tinkered packages and their peers, the push hook blocking while linked, adoption on the next kit release wave — never by a local reimplementation. The posture and protocol are in `tsdoctor-package-architecture.md`.

**Known to exist (0.7.0, verified):** the 28 mdast node classes as `Schema.Class` instances with `FlowContent` / `PhrasingContent` content sets, `Table` / `TableRow` / `TableCell`, a `Frontmatter` node and codecs, `Markdown.stringify`, and the MDX vocabulary — `MdxJsxFlowElement`, `MdxJsxAttribute`, `MdxJsxAttributeValueExpression` — with escape-on-MDX-presence and byte-identical output for non-MDX trees (`packages/model/__test__/mdx-vocabulary.test.ts`).

**Round 1 (2026-09-02) — closed.** The three gaps the phase-2 lift surfaced against 0.7.0 were raised as one request and answered the same day; `@effected/markdown` 0.8.0 (PR spencerbeggs/effected#583, release pending — this tree rides it through `file:` overrides in `pnpm-workspace.yaml` until it ships) carries the outcome:

- **(a) Over-escaping in stringify — FIXED.** Inline text escaping is now minimal: `_` is escaped only where it can bind emphasis (raw between two Unicode alphanumerics), `&` only when the rest of the value is entity-shaped, `>` only at a line start, and `#` in a heading only as an ATX closing sequence. `# DEFAULT_PIPELINE_OPTIONS`, `Getters & Setters` and the `parse("# A_B\n")` → stringify identity are pinned in the kit's conformance corpus. Adopted: both downstream shims are DELETED — `unescapeLiteral` in the RSPress MDX emitter (`935248e`) and `unescapeHeadingLiteral` in the VitePress emitter (`53f08bf`). The golden gate over all five RSPress fixture sites held at 0 diff lines and the VitePress site's 738 hovers were unchanged. One prose byte changed, correctly: an author-written `snake\_case` now round-trips to `snake_case`, the kit dropping a redundant escape.
- **(b) Tree-wide MDX-presence escaping and no join control — DECLINED, with a hatch.** The presence-keyed `{` escape is a kit design invariant — a plain-markdown tree's byte-stability must not depend on a flag every caller has to know about — so there is no stringify option, no per-node flag and no separator option; `Markdown.stringify` stays option-free. The raw hatch already exists: an inline `Html` node is `PhrasingContent` and emits its `value` verbatim on any tree. Note that `<` is always-escaped regardless of MDX presence (it can open raw HTML or an autolink); only `{` is presence-keyed. The RSPress emitter therefore KEEPS per-top-level-node serialization and owns its joins: collapsing to one tree needs every pre-escaped run to become an `Html` node, and the enum-signature single-newline join needs a separator the kit deliberately does not offer. Adopting the hatch is a downstream refactor for a later round, not an ask.
- **(c) Two JSX normalizations — CONFIRMED intentional.** An empty-children `MdxJsxFlowElement` self-closes and nested JSX siblings are blank-line separated because both are the `mdast-util-mdx-jsx` oracle defaults, pinned upstream; a change in either direction would be a kit regression, not a drift.
- **Custom heading anchors (`## Heading {#id}`) — PINNED.** A non-MDX tree serializes `Setters {#setters}` raw; the `#` needed the heading-hash rule above to survive. The VitePress emitter relies on it with no shim.

**Still plausible, unconfirmed:** MDX parsing (absent by design; the emitters never parse MDX, so it only becomes real if the characterization gate wants to compare trees rather than bytes), and `~` / `|` remaining always-escaped — the same over-escape class as (a), deliberately left out of round 1 because neither bit (the only `\|` emitted sits inside GFM table cells, where it is correct).

## The alpha gate

The roadmap's phrase — *a working VitePress adapter alpha renders a real API doc site from the same bundles the RSPress plugin consumes* — means, concretely:

1. `sites/vitepress-basic` consumes `modules/kitchensink`'s built bundle through `@tsdoctor/bundle` discovery, the same folder `sites/basic` points at.
2. `vitepress build` is green in CI and produces one page per exported item across every category the RSPress `basic` site generates, with the same routes and the same member anchors.
3. Signatures, members and examples are Twoslash-checked through the native transformer over the same VFS and compiler options the RSPress build resolves, with hidden imports cut and hovers rendering.
4. Prose cross-links resolve to the generated pages; member anchors resolve within them.
5. The sidebar is derived from the nav tree; the `HeadTag[]` from `@tsdoctor/seo` reaches each page's head.
6. The RSPress adapter is on the IR with the golden gate held, so the seams the alpha exercises are the seams the first consumer already runs on.

Explicitly excluded from the gate: Vue components; code-block cross-links; llms.txt; multiVersion, i18n and multi-API sites; OG image generation; incremental (snapshot-tracked) writes in the VitePress adapter — `@tsdoctor/snapshot` is neutral and can be wired later, but the alpha writes every file; the `serve` dev/preview runner; any user documentation beyond the fixture site. Each is a design question with an obvious home, not a gap in the architecture, and the gate is deliberately the smallest thing that proves the boundary.

### Alpha gate result

Measured on 2026-09-03 against `sites/vitepress-basic` (`vitepress build`, cold then warm):

| Gate item | Result |
| --- | --- |
| 1. Same bundle | `dir: ./lib/models/kitchensink` — the model folder kitchensink's `meta.localPaths` populates for both `sites/basic` and this site — through `@tsdoctor/bundle`'s `discoverBundle` |
| 2. Route set and anchors | 38 routes = 38: 37 pages plus the index, matching `sites/basic` category for category (class 11, enum 2, function 12, interface 5, namespace 2, type 3, variable 2); member anchors render as element ids |
| 3. Twoslash | 738 `twoslash-hover` spans in the built HTML across 36 of 37 pages, 0 error annotations, hidden imports cut. RSPress `sites/basic` renders 562 — examples only, since it never type-checks declaration blocks |
| 4. Cross-links | prose links resolve to generated pages: `pipeline.html` alone carries 36 distinct `/api` hrefs, member anchors included |
| 5. Sidebar and head | the sidebar renders from the nav tree; canonical, Open Graph, Twitter, `article:*` and the JSON-LD script are present in the built HTML |
| 6. RSPress on the IR | golden gate held — [Gate result](#gate-result) |
| Build, typecheck, suite | `vitepress build` green; monorepo typecheck and the full suite green |

Skipped for the alpha, as excluded above and repeated here so their absence is not read as a gap: snapshot-tracked incremental writes (every file is written every build, both timestamps are the build time), OG image resolution, llms.txt, code-block cross-links, multiVersion / i18n / multi-API, the `serve` runner. One more that is not an exclusion but a fact about the repo: **no CI workflow builds any fixture site** — the root `ci:build` script filters `!@sites/*`, so `sites/vitepress-basic` participates in CI only through `typecheck`, exactly like the five RSPress sites. The numbers above are a local measurement.

## Open decisions

1. **How the VitePress adapter triggers generation — RESOLVED** on the lean: at config-load time behind the awaited `apiExtractor()` helper (see [The emitters](#the-emitters)).
2. **Where `twoslash-cache.ts` lands — RESOLVED:** `@tsdoctor/vfs`; see [Tier 2 core moves](#tier-2-core-moves).
3. **The fate of the model's `Render` — the one decision still open.** `Render.tree` / `Render.item` / `Render.docs` are public in `@tsdoctor/model`, and the model cannot depend on `@tsdoctor/pages` without a cycle, so the IR's markdown serializer lives in `pages`. Lean: deprecate `Render` in the model on the release that ships `pages` and delete it a minor later; the alternative is keeping it as the model's dependency-light body renderer for consumers who want text and no page. The phase-5 close-out now in progress (the changesets release and the `Render` deprecation) is taking the lean.

## Rationale

- **Why lift the generators rather than grow `Render.tree`:** the body renderer is the subset; the generators are the product. Growing the subset toward the product means re-deriving decisions already taken and tested, and each one would land first in whichever consumer needed it.
- **Why the RSPress adapter switches now, behind a gate:** an IR built for one consumer while the other keeps its own generators is shaped by that one consumer — the same outcome as designing it up front. The golden gate makes the switch a refactor with an oracle instead of a rewrite with a hope.
- **Why display and source are two fields:** the two frameworks spend them at different stages (a remark pass on a prop versus markdown-it on a fence), and only Twoslash's own cut notation lets one text serve both roles in the VitePress case. Carrying both is one field of redundancy against a transformer per framework.
- **Why navigation is IR output:** a sidebar that is files in one framework and config in another can only be neutral as data.
- **Why the alpha is markdown-only:** Vue components would be a second component layer to design before the seams are proven, and the seams are what the gate is for. Native `@shikijs/vitepress-twoslash` gives hovers and type errors for free on plain fences.
- **Why frontmatter assembly stays adapter-side:** the frontmatter hash contract lives in the RSPress generate stage and moving it would re-open the phase-4 change-detection work for no gain; the IR carrying facts rather than a block keeps both adapters honest about their own spellings.
- **Why the kit, not local code, closes gaps:** the consolidation exists to shorten the loop between `@effected` and its consumers, and a local mdast helper is exactly the drift it eliminates.

## Related documentation

- **Umbrella roadmap and the phase-5 gate:** `roadmap-1.0.md`
- **Package architecture, the adapter contract and the Tier 2 candidate list:** `tsdoctor-package-architecture.md`
- **The pipeline stages that run the IR, and the helpers that stayed adapter-side:** `page-generation-system.md`
- **Member anchors, the `CrossLinker` and `ShikiCrossLinker`:** `cross-linking-architecture.md`
- **The VFS, `TsEnvironment` and compiler-option seam both adapters share:** `type-loading-vfs.md`
- **The `HeadTag[]` seam and the rebuild-count lesson:** `structured-data-and-og.md`
- **The frontmatter hash and the no-change rebuild:** `snapshot-tracking-system.md`
- **The Twoslash result cache and its `typesCache` seam:** `render-phase-instrumentation.md`
- **`llms-processing.ts` and the RSPress llms wiring that stays:** `llms-integration.md`
- **Adapter structure and the "Stage 2 convergence" deferral this resolves:** `build-architecture.md`
- **The VitePress adapter's own invariants:** `platforms/vitepress/CLAUDE.md`
