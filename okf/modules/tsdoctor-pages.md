---
type: Module
kind: package
title: "@tsdoctor/pages"
description: The framework-neutral documentation page IR for static TypeScript API sites — blocks, builders, navigation, and the plain-markdown emitter.
resource: ../../packages/pages
layer: L2
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T20:28:47Z
  body_sha256: 9b34bd231a804752c4c69f64dda8703fcfe81260b024029b764bb4356dd666db
tags:
  - architecture
  - dx
status: stable
---

# @tsdoctor/pages

## Boundary and purpose

`@tsdoctor/pages` owns what a generated API documentation page contains. A
page is a set of facts, an ordered list of typed doc blocks, and its
navigation entry; prose inside a block is `@effected/markdown` mdast. Each
adapter is an emitter that spends the IR in its own framework's dialect — MDX
with JSX components for RSPress, plain markdown with Twoslash-annotated
fences for VitePress. The package is pure: no filesystem, no network, no
`shiki` / `hast` / `react` / `@rspress` / `vitepress` imports, typed errors
only. Prettier is the one non-trivial dependency, kept here because it is
CPU-bound and I/O-free and both adapters must format examples identically or
llms.txt output diverges between frameworks.

The IR was extracted with two live consumers already depending on the shape
it needed to have, rather than designed up front for a hypothetical one — see
[page-ir-from-two-consumers](../decisions/page-ir-from-two-consumers.md).

## Dependencies

- `@tsdoctor/model` (dependency, `workspace:*`) — `ApiItems`, `Routes`,
  `EntryPoints`, `SyntheticBases`, the `CrossLinker`, TSDoc extraction
- `@tsdoctor/seo` (dependency, `workspace:*`) — the `HeadTag` type only
- `@microsoft/api-extractor-model` (dependency) — the `ApiItem` vocabulary
  the builders consume
- `prettier` (dependency) — example formatting
- `effect` (peer, `catalog:effect`)
- `@effected/package-json`, `@effected/schema-org`, `@effected/tsconfig-json`
  (peers, `catalog:effected:peers`): propagated from the public surfaces of
  `@tsdoctor/seo` and `@tsdoctor/model`, and each also a devDependency so the
  workspace satisfies it. See
  [core-peers-follow-public-surface](../decisions/core-peers-follow-public-surface.md).
- `@effected/markdown` (peer, `catalog:effected:peers`) — the mdast and MDX
  vocabulary the IR's prose and the plain-markdown emitter serialize through

## Public surface

`src/index.ts` re-exports every symbol by name — **no `export * as`
namespaces anywhere in the surface**. API Extractor's dts rollup cannot
attribute a class referenced across a namespace boundary (`Page` referencing
its `Block` members, `buildExample` referencing `Example`), so a namespaced
surface produced forgotten-export warnings that failed CI; three exported
names — `ExampleGroup`, `ParameterTable`, `EnumMemberTable` — are spelled with
their owning concept prefixed for exactly this reason, and any symbol added
later that would collide bare should follow the same pattern.

Modules, one per concern:

- `src/Blocks.ts` — the block vocabulary: `Schema.Class` variants carrying
  `Schema.tag` on the `kind` discriminant, unioned with `Schema.Union`
- `src/Page.ts` — the page record: required `kind`, title facts, description,
  route, `headTags: ReadonlyArray<HeadTag>`, `blocks`, `nav`
- `src/Nav.ts` — `buildNav`, `sortNavPages` — the per-API navigation tree
- `src/WorkItems.ts` — `prepareWorkItems`, a loaded model to per-API work
  items plus the cross-link route map, with `uncategorized` items and route
  `collisions` returned as data
- `src/Build.ts` — `buildPage` (one builder per item kind, returning
  `Option<Page>`), `buildIndexPage`, `isPageKind`
- `src/Examples.ts` / `src/TwoslashDirectives.ts` — display/source
  preparation: hidden-import prepending, directive stripping, Prettier
  formatting (`formatExampleCode`, the Effect-typed `ExampleFormatError`),
  the cut/directive grammar both adapters share
- `src/Markdown.ts` — the neutral plain-markdown emitter (`renderMarkdown`),
  the IR's dependency-free serializer
- `src/Llms.ts` — the llms.txt text transforms
- `src/Scope.ts` — API scope naming: `apiScopeOf`, `unscopedName`,
  `normalizeBaseRoute`

## Mechanisms

### A page, not a body

The unit of the IR is a page: the facts the frontmatter is built from (title
parts, description, route, the `HeadTag[]` from `@tsdoctor/seo`), an ordered
list of blocks, and the page's entry in the navigation tree. `Page` carries a
required `kind` so an emitter can choose imports and layout without
re-inspecting the item; the landing page is a separate, blockless `IndexPage`
built by `buildIndexPage`.

### Block vocabulary

A page is built from a title with an optional release-tag badge and
deprecation notice; an "available from" line for multi-entry items; prose
sections (summary, remarks, returns, see-also) as mdast; a signature block;
member groups whose members each carry their own signature, summary, and
anchor; parameter and enum-member tables as typed rows; example groups; the
synthetic base-class section; a source link; and, for namespaces, a member
index. Category-specific pages compose the same blocks in different orders.
`Blocks.ts` defines the exact field lists.

**Anchors arrive as data.** A member block carries the anchor id computed
once by `ApiItems.memberAnchors` (`@tsdoctor/model`) and threaded through the
work item. No emitter recomputes an anchor — the route map's `#fragment` and
the page's element id come from one computation. The builder falls back to
recomputing anchors only for out-of-pipeline callers; the pipeline path must
pass the map, or agreement silently reverts to two computations that can
drift.

**Prose is linked before it enters the IR.** `Build.ts` applies the per-API
`CrossLinker` to a prose string, then parses the linked string as commonmark
mdast, so a prose block is already linked and every emitter renders
identical links. The parse is total. Code-block linking stays an emitter
concern (RSPress's HAST-level `ShikiCrossLinker`).

**The error channel is `never`.** Example formatting runs through
`formatExampleCode`; a failure invokes the caller's `onExampleFormatError`
hook and the example carries its unformatted code — this package emits no
events and no logs, leaving that to whichever adapter maps the hook to its
own observability surface.

### The display and source split

A code-bearing block carries two text fields, produced once through
`codeText` / `buildExample` and never derived from each other in an emitter:
`display`, the Prettier-formatted, directive-stripped code a reader sees and
copies; and `source`, the type-check text — hidden imports, then `//
---cut---`, then the code with any Twoslash directives intact. Each emitter
spends them differently: RSPress emits both as props and hides the pre-cut
lines at render time; VitePress emits `source` as the fence body and lets
Twoslash's native cut notation hide them. See
[display-and-source](../glossary/display-and-source.md).

### prepareWorkItems and multi-entry resolution

`prepareWorkItems` orchestrates `@tsdoctor/model`'s `EntryPoints`,
`SyntheticBases`, `ApiItems` and `Routes` namespaces and returns work items,
the cross-link route map, uncategorized items and route collisions — all as
data, never as a thrown error or an emitted event. It resolves entry points
(`EntryPoints.resolve` dedup, so the same item re-exported from several entry
points collapses to one page), filters out synthetic base declarations
(`SyntheticBases.detect`), categorizes items and extracts namespace members,
builds route candidates, and detects collisions on the lowercased
`folder/name` (`Routes.detectCollisions`) — a naming or category-config
collision fails the build; there is no synthetic suffix. It also builds the
cross-link routes and kinds maps, where a bare name is owned by the
highest-priority kind (`crossLinkKindPriority` — value kinds beat type-only
kinds, namespaces rank last), computes `ApiItems.memberAnchors` for each
class and interface, and constructs the generic `WorkItem<WorkItemCategory>`
array, each carrying `availableFrom` plus `syntheticBase` and
`memberAnchors` where they apply.

`WorkItem` is generic in its category type: `WorkItemCategory` is the
neutral `ApiItems.CategorySpec` plus display, singular and folder names, and
each adapter instantiates it with its own category config shape. The route
and file path are always the plain lowercased `category/name`; the
navigation label is the plain display name.

**The caller must always check `collisions`.** `prepareWorkItems` reports,
never decides: RSPress's wrapper in `build-stages.ts` emits an `ItemSkipped`
event per uncategorized item and a `RouteCollisionDetected` event per
collision, then throws `Routes.RouteCollisionError` when any collision
exists; VitePress's `Generate.ts` dies on collisions directly and reports
uncategorized item names on its result. Ignoring the `collisions` array
silently writes two distinct items to one route.

**The "Available from" block.** `buildPage` pushes an `AvailableFrom` block
(`packageName` plus `entryPoints`) only when the work item's `availableFrom`
lists more than one entry point; a single-entry item gets none. Each emitter
spells the same paragraph — `` Available from: `package-name`,
`package-name/testing` `` — with `"default"` mapped to the bare package name
and named entries to subpath imports. Both emitters must render this block
identically: it is IR-owned precisely because two independently-written
paragraphs are a drift hazard neither adapter should carry alone.

### Cross-linking inputs the IR consumes

`prepareWorkItems`'s route map is what feeds both RSPress's prose
`CrossLinker` and its HAST-level `ShikiCrossLinker` — see
[rspress-plugin-api-extractor](rspress-plugin-api-extractor.md) §Cross-linking
in code blocks. Routes are `{baseRoute}/{categoryFolder}/{lowercased name}`
for top-level items, `.../{class}#{anchor}` for class and interface members,
and `.../{folder}/{namespace.member}` (lowercased qualified name) for
namespace members, with a PascalCase member also getting an unqualified
route when no top-level item claims the name. A namespace member's file path
is derived by replacing only the final route segment with the qualified
name — a first-occurrence replace of the simple name would corrupt the
category segment whenever a member's lowercased name equals its folder (a
type alias `Type` in the `type` folder, the Effect Schema companion-namespace
pattern).

When a `const` and a type alias share a `displayName` (the Effect Schema
companion pattern), they live in different category folders and never
collide; a bare reference resolves through `crossLinkKindPriority` so a bare
`Pipeline` links to `/variable/pipeline` rather than `/type/pipeline`. The
cross-link route always equals the generated file path.

### llms.txt text transforms

`Llms.ts` holds the pure text transforms both adapters can call: parsing
RSPress's llms.txt link-line grammar (`parseLlmsTxtLine`), removing API
entries and appending pointer lines when per-package scoping is off
(`filterLlmsTxt`), reorganizing the flat list into package sections when
scoping is on (`generateStructuredLlmsTxt`), removing whole API sections from
`llms-full.txt` (`filterLlmsFullTxt`), and producing the four per-package
files (`generatePackageLlmsTxt`, `generatePackageLlmsFullTxt`). These
functions are pure text operations over RSPress's own llms.txt grammar; the
file I/O and RSPress-specific orchestration live in the adapter's
`llms-program.ts`, which is the only current consumer — VitePress has no
first-party llms.txt equivalent to post-process, so that half is unused by
the second adapter today, a known gap in
[vitepress-alpha-scope](../limitations/vitepress-alpha-scope.md).

## What stays adapter-side

- **Frontmatter assembly.** The IR carries the facts; the adapter builds the
  block, because the two frameworks spell a JSON-LD script body differently
  (RSPress: a `children` attribute; VitePress: a third tuple element) and
  because RSPress's snapshot hash is taken over the final assembled
  frontmatter.
- **Component import lines and JSX** — an RSPress emitter detail with no
  VitePress equivalent (VitePress ships no Vue components in the alpha).
- **Code-block rendering, runtime components and lifecycle wiring** — the
  three framework-coupled areas that stay in each `platforms/*` adapter.

## Representation

Blocks are `Schema.Class` variants carrying `Schema.tag` on the domain-named
discriminant `kind`, unioned with `Schema.Union` — the same shape
`@effected/markdown` uses for mdast nodes, whose discriminant is `type`. Not
`Data.TaggedEnum`, because the IR must be decodable and serializable as a
stable artifact; not `Schema.TaggedClass`, because it hardwires `_tag` and a
vocabulary that sits beside mdast reads better with its own key. See
[blocks-are-schema-classes](../decisions/blocks-are-schema-classes.md).

## Carried quirks

Two behaviours of the RSPress generators this IR replaced are carried
deliberately, because the lift was validated by byte identity and
normalizing them now is a product change that needs its own labelled commit:

- The summary paragraph is not cross-linked (no prior generator linked it).
- The namespace member index routes members into the default category
  folders rather than the configured ones.

## Invariants

- `src/index.ts` re-exports by name only; no `export * as` namespace, ever —
  the dts rollup cannot attribute a cross-namespace class reference.
- `buildPage`'s error channel stays `never`; the only failure mode is
  example formatting, and it degrades through `onExampleFormatError`, never
  a thrown error.
- Anchors are computed once (`ApiItems.memberAnchors`) and carried, never
  recomputed inside an emitter.
- A code-bearing block always carries both `display` and `source`; neither
  emitter derives one from the other.
- A caller of `prepareWorkItems` must inspect `collisions` before writing any
  file — ignoring it is silent route corruption.

## Links

- [page-ir-from-two-consumers](../decisions/page-ir-from-two-consumers.md)
- [blocks-are-schema-classes](../decisions/blocks-are-schema-classes.md)
- [linker-is-a-scope](../decisions/linker-is-a-scope.md)
- [byte-parity-emitter-changes](../conventions/byte-parity-emitter-changes.md)
- [display-and-source](../glossary/display-and-source.md)
- [no-external-package-cross-links](../limitations/no-external-package-cross-links.md)
- [collision-detection-by-final-route](../limitations/collision-detection-by-final-route.md)
- [llms-post-process-not-generate](../decisions/llms-post-process-not-generate.md)
