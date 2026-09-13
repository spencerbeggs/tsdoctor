---
type: Module
title: "@tsdoctor/model"
description: Framework-neutral analysis of Microsoft API Extractor models — loading, TSDoc extraction, multi-entry resolution, routes, cross-linking, signatures and the api.json-to-TypeScript bridge.
kind: package
layer: L2
resource: ../../packages/model
status: draft
tags: [architecture]
sources:
  - id: src
    resource: ../../packages/model/src
    last_modified: 2026-09-13T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: c67de084fba0d2c6cd66b82089b58b042a0a7662bc126ccf70701139e00c7831
---

# @tsdoctor/model

## Boundary and purpose

`@tsdoctor/model` owns everything that can be known about a documented
package from its Microsoft API Extractor model (`.api.json`) alone: typed
loading, TSDoc extraction, categorization, multi-entry-point
deduplication, route and anchor computation, synthetic-base detection,
signature formatting, prose cross-linking, and the reconstruction of
`.d.ts` declarations and their external `import type` statements for a
virtual TypeScript environment.[^src] It is framework-free: no RSPress, no
React, no I/O beyond model loading.

It was seeded from a dissolved sibling npm package (`api-extractor-llms`),
then redesigned as idiomatic Effect v4 namespace modules, and later
absorbed several modules that used to live in the RSPress adapter
(`multi-entry-resolver.ts`, `route-collisions.ts`, `synthetic-bases.ts`,
`api-extracted-package.ts`, `type-reference-extractor.ts`,
`frontmatter.ts`) once their consumer count and shape made clear they were
not RSPress-specific.

## Layer cake

Runtime dependency: `@tsdoctor/vfs` (`workspace:*`, for `VirtualPackage`,
which `ApiExtractedPackage` extends). Peers: `effect`, `@effected/markdown`,
`@effected/yaml`, `@effected/package-json` (all catalog-pinned).
`@tsdoctor/snapshot` is a **test-only** devDependency — the frontmatter
characterization tests pin literal digests hashed through the real
`hashFrontmatter`, so they need the real implementation rather than a
stub; it must never be promoted to a runtime dependency.

Both adapters (`platforms/rspress`, `platforms/vitepress`) import these
modules directly — there is no delegation-shim layer left in the adapter
side. `@tsdoctor/pages` builds its page IR on top of this package's
`ApiItems`, `EntryPoints`, `Routes`, `SyntheticBases` and `CrossLinker`.

## Public surface

Namespace modules and standalone exports, all from `src/index.ts`:[^src]

- `Model` (`src/Model.ts`) — Effect-typed model loading;
  `ModelNotFoundError`, `ModelParseError`, `EmptyModelError`.
- `Tsdoc` (`src/Tsdoc.ts`) — pure TSDoc accessors.
- `ApiItems` (`src/ApiItems.ts`) — `categorize` (returns
  `{ items, uncategorized }`), `namespaceMembers`, plus the `ApiItem`-shaped
  views of `Routes`'s anchor and key computations (`memberAnchors`,
  `memberRouteKeys`).
- `EntryPoints` (`src/EntryPoints.ts`) — `resolve`: deduplicates re-exports
  across a package's entry points and records each item's canonical
  `definingEntryPoint` plus every entry point it is `availableFrom`.
- `Routes` (`src/Routes.ts`) — `RouteCandidate`, `detectCollisions`,
  `RouteCollisionError`, `sanitizeId`, `memberAnchor`, `memberAnchors`,
  `memberRouteKeys`.
- `SyntheticBases` (`src/SyntheticBases.ts`) — `detect`,
  `BASE_CLASS_ANCHOR`.
- `Signature` (`src/Signature.ts`) — `format`.
- `Render` (`src/Render.ts`) — a string-rendering API plus an `@alpha`
  `Render.tree` over `@effected/markdown`. **Deprecated**, in favour of
  `@tsdoctor/pages`'s `buildPage` plus its `renderMarkdown` /
  `markdownTree`; the deprecation is a one-minor holding pattern before
  deletion (see the linked decision).
- `CrossLinker` (`src/CrossLinker.ts`) — a class, not a namespace:
  `fromRoutes`, `fromRefs`, `empty`, `link`, `linkHtml`.
- `ApiExtractedPackage` (`src/ApiExtractedPackage.ts`).
- `TypeReferenceExtractor`, `TypeReference`, `ImportStatement`
  (`src/TypeReferenceExtractor.ts`).
- `parseFrontmatter`, `stringifyFrontmatter`, `emitFrontmatterBlock`,
  `ParsedFrontmatter` (`src/Frontmatter.ts`).
- Shared types in `src/types.ts`: `ApiItemRef`, `DocMeta`,
  `FrontmatterRenderer`, `ItemKindSlug`, `RenderPackageOptions`,
  `RenderedDoc`, `RouteFormatter`.
- `src/internal/` holds helpers not on the public surface, including
  `internal/prose.ts`'s `phrasingFromMarkdown`, which uses
  `@effected/markdown`'s `Markdown.parsePhrasingResult` rather than a full
  parse plus a `Paragraph` splice.

There is no `@alpha` `StructuredData` stub in this package — schema.org
derivation lives entirely in `@tsdoctor/seo`; do not re-add an SEO seam
here.

## Absorbed mechanisms

### Multi-entry resolution and route collisions

`EntryPoints.resolve` groups items by the identity key
`displayName::kind`: the same key recurring across entry points is a
re-export and collapses to one record, preferring the `"default"` entry as
owner; the same `displayName` under a different `kind` (the Effect Schema
companion pattern of a `const` and a type alias sharing a name) stays two
distinct records, because the two route to different category folders.
The main entry point (an empty `displayName` in the model) is normalized
to `"default"`.

A route is `{categoryFolder}/{sanitized lowercased name}`. Two distinct
items resolving to the same route is a naming or category-configuration
problem, and the build fails rather than disambiguating with a synthetic
suffix: a silent suffix would make the generated route depend on
iteration order and hide a naming problem the author should fix instead.
`Routes.detectCollisions` groups candidates by route key on the
**lowercased** path — so it catches what a case-insensitive filesystem
would silently merge — and returns every group with more than one
distinct item; `Routes.RouteCollisionError` names each colliding item, its
kind and canonical reference. Detection is scoped to the final
`folder/name` route only: the same name in different folders never
collides, and the same `displayName::kind` recurring across entry points
is a re-export, never a collision, by construction.

### Anchors and cross-link keys — the single algorithm

`Routes.sanitizeId` is the **one** anchor-sanitization algorithm in the
monorepo (lowercase; spaces and underscores to hyphens; other specials
stripped). A second copy once existed in the RSPress adapter and had
drifted on how `_` and `$` were handled, silently producing dead
cross-links for every member name containing either character — that
second copy is deleted, and no third spelling should be added.
`Routes.memberAnchors(members)` computes every member's anchor for a class
in one pass, keyed by the member's canonical reference rather than by its
sanitized name — keying by sanitized name would collapse both halves of a
static/instance name collision onto the same id. When two members
sanitize to the same anchor, the higher-priority slot (static before
instance, method before property, etc.) keeps the bare anchor and the
other is prefixed; TypeScript forbids two members of the same static-ness
sharing a name, so a collision is always exactly one static and one
instance member, and only an `instance-` prefix is ever emitted.
`Routes.memberRouteKeys(className, members)` decides which member a
qualified reference such as `Registry.create` means (the static member
wins when both exist, matching the static-access-expression reading in
TypeScript), and emits the TSDoc selector forms
(`Registry.(create:static)`) only when a collision actually exists, since
every extra key pattern the prose linker must test against every string
costs something. `ApiItems.memberAnchors` / `memberRouteKeys` are the
`ApiItem`-shaped views of these two functions; there is no fourth
spelling either.

Companion names (a `const` and a type alias sharing a `displayName`, the
Effect Schema pattern) never collide because they live in different
category folders; a bare reference between them resolves by kind
priority — value kinds outrank type-only kinds, namespaces rank last. A
synthetic base class — an unexported class an exported class's `extends`
clause references — is not given its own page; it routes to an inline
"Base Class" section on the owning class's page at
`SyntheticBases.BASE_CLASS_ANCHOR`, registered only when the base name is
not already owned by a real page.

### Prose cross-linking

`CrossLinker` is immutable per scope: `fromRoutes` builds one linker from
a name-to-route map and there is no mutable "current scope" and no
`reinitialize`. `link` / `linkHtml` replace type names in prose with
markdown or HTML links, matching longest-name-first and skipping matches
inside existing links and inside backtick code spans (an odd backtick
count before the match indicates it is inside a span). The class does not
cross-link summary paragraphs — that is a carried behavior of the
generators this replaced, not an oversight, and normalizing it later is a
labelled product change, not a bug fix.

### The api.json-to-TypeScript bridge

`ApiExtractedPackage` extends `@tsdoctor/vfs`'s `VirtualPackage` to
reconstruct high-fidelity `.d.ts` output from an in-memory `ApiPackage`
(`fromApiModel` for an `.api.json` file, `fromPackage` for an in-memory
model, both ending in `toVfs()`). Because `VirtualPackage` validates its
entries map at construction, `fromPackage` builds the real entries map on
a scratch instance before constructing the instance it returns. Two
fidelity repairs live in its private excerpt renderer rather than reading
raw excerpt text: the `abstract` modifier is propagated onto reconstructed
class headers (including through a namespace-nested class), because
dropping it while the body still has abstract members produces "abstract
member in a non-abstract class" errors in the virtual environment; and
dts-rollup's `$N` alias suffixes (`Name$1`) are stripped from rendered
text when the de-suffixed form matches the token's canonical symbol,
because the import generator imports the canonical (unsuffixed) name and
would otherwise leave `Name$1` undefined.

`ApiExtractedPackage` keeps its own private `extractPlainText`, and it is
a **different algorithm** from this package's prose extraction used
elsewhere — it preserves `{@link X.Y}` syntax verbatim and reconstructs
fenced code blocks for `.d.ts`/JSDoc output, where prose extraction
flattens links to display text and drops fences. The two are not
interchangeable and must not be unified.

`TypeReferenceExtractor` classifies API Extractor's canonical type
references (`packageName!symbolName:kind`) into three buckets: built-in
(empty package name, or a quoted Node built-in such as `Promise` or
`Buffer`), internal (the documented package itself, already declared in
the VFS) — both filtered out — and external, which becomes a generated
`import type`. A namespaced reference (`Schema.Struct`, `z.ZodType`) is
reduced to its **namespace root**, the first dotted segment, not the
leaf: the reconstructed declaration body keeps the qualified form
verbatim, so the binding that must be in lexical scope is the root, and
importing only the leaf would leave the namespace identifier undefined
and collapse a `typeof X.Type` companion type into an error type.
`ImportStatement` (`packageName`, a `symbols` set, `typeOnly`) is the one
shape crossing this boundary, and it feeds both VFS import prepending and
`@tsdoctor/pages`'s hidden-import generation for example blocks.

### Frontmatter

`Frontmatter.ts` splits fences via `@effected/markdown`'s
`FrontmatterSource.split` under a strict grammar — a fence line must be
exactly `---`, and an unterminated block is not treated as frontmatter at
all — and emits via `FrontmatterSource.join` plus
`Yaml.stringify({ quoteCompat: "yaml-1.1", quoteStyle: "double" })`. The
earlier hand-rolled gray-matter-quirk scanner is deleted and must not be
restored.

## Invariants

- `Routes.sanitizeId` is the only anchor algorithm; no adapter or
  consumer may spell a second one.
- `Routes.memberAnchors` keys by member identity, never by sanitized
  name.
- `ApiExtractedPackage.extractPlainText` and the package's general prose
  extraction remain two separate algorithms.
- A route collision fails the build; there is no synthetic
  disambiguation suffix.
- `Render` is deprecated; new consumers reach for `@tsdoctor/pages`
  instead.
- No SEO derivation lives in this package.

## Links

- [Decision: single anchor algorithm](../decisions/single-anchor-algorithm.md)
- [Decision: route collisions fail the build](../decisions/route-collisions-fail-the-build.md)
- [Decision: import the namespace root, not the leaf](../decisions/import-namespace-root-not-leaf.md)
- [Decision: deprecate model Render](../decisions/deprecate-model-render.md)
- [Limitation: collision detection is by final route only](../limitations/collision-detection-by-final-route.md)
- [Limitation: generated imports do not trace re-exports](../limitations/imports-do-not-trace-re-exports.md)

[^src]: `packages/model/src/index.ts`, `packages/model/src/Model.ts`,
`packages/model/src/Tsdoc.ts`, `packages/model/src/ApiItems.ts`,
`packages/model/src/EntryPoints.ts`, `packages/model/src/Routes.ts`,
`packages/model/src/SyntheticBases.ts`, `packages/model/src/Signature.ts`,
`packages/model/src/Render.ts`, `packages/model/src/CrossLinker.ts`,
`packages/model/src/ApiExtractedPackage.ts`,
`packages/model/src/TypeReferenceExtractor.ts`,
`packages/model/src/Frontmatter.ts`, `packages/model/src/types.ts`.
