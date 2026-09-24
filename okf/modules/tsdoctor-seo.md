---
type: Module
kind: package
title: "@tsdoctor/seo"
description: Framework-neutral head metadata — canonical URLs, Open Graph, Twitter cards, attribution, and schema.org JSON-LD — for static TypeScript API documentation.
resource: ../../packages/seo
layer: L2
generated:
  by: "okfit/claude-code"
  at: 2026-09-24T20:28:47Z
  body_sha256: c76d11f119a236c121dd039fb37cf501e04605e2d7ad797a470a072d88c58d8e
tags:
  - architecture
  - dx
status: stable
---

# @tsdoctor/seo

## Boundary and purpose

`@tsdoctor/seo` decides which `<head>` tags a generated API page gets:
canonical link, Open Graph block, Twitter card block, and a schema.org
JSON-LD `<script>`, derived from package metadata, a resolved bundle and an
API item's facts. It is pure — no filesystem, no network, no native
dependencies, no framework types. Filesystem probing of a configured Open
Graph image stays in the adapter's own service
(`platforms/rspress/src/services/OgService.ts`); this package only decides
which tags a page gets once that probe (or the resolved bundle) supplies an
image.

The rule the package is built around: `@tsdoctor/seo` decides which tags a
page gets, an adapter only renders a `HeadTag` into whatever its framework
calls a head entry. That is what keeps a second adapter's SEO output a
rendering change rather than a second SEO implementation.

## Dependencies

- `effect` (peer, `catalog:effect`)
- `@effected/package-json` (peer, `catalog:effected:peers`) — `PackageManifest`
  and the SPDX-aware license helpers used by `attributionFacts`
- `@effected/schema-org` (peer, `catalog:effected:peers`) — `JsonLdDocument` /
  `JsonLdNode` / `NodeRef`, the schema.org vocabulary and its `./validate`
  conformance checker
- `@effected/spdx` (dependency, `catalog:effected`) — the SPDX license
  catalog and expression grammar, used internally and absent from the
  public `.d.ts` surface, so it is not a peer (see
  [core-peers-follow-public-surface](../decisions/core-peers-follow-public-surface.md))

No dependency on `@tsdoctor/model`, `@tsdoctor/pages`, `@tsdoctor/bundle` or
any adapter package; consumers pass in already-resolved facts.

## Public surface

`src/index.ts` re-exports, one module per concern:

- `src/HeadTag.ts` — the `HeadTag` interface (`{ tag; attrs; body? }`) and
  `meta`, `metaNamed`, `link`, `jsonLd`, `escapeScriptBody`
- `src/Canonical.ts` — `deriveSiteUrl`, `canonicalUrl`, `resolveUrl`,
  `imageMimeType`
- `src/OpenGraph.ts` — the OG schemas, `createPageMetadata`, `openGraphTags`,
  `twitterTags`
- `src/Attribution.ts` — `attributionFacts`
- `src/StructuredData.ts` — `packageContext`, `derive`, `deriveScriptBody`,
  `StructuredDataError`
- `src/Seo.ts` — `headTags(input: SeoPageInput): ReadonlyArray<HeadTag>`, the
  one adapter seam

`HeadTag` is deliberately dumb: a tag name, an attribute record, and an
optional body. Nothing in the shape is framework-specific; each adapter maps
it into its own head representation (RSPress: a frontmatter `[tagName,
attrs]` pair rendered by `src/markdown/helpers.ts`'s `generateFrontmatter`;
VitePress: a `[tag, attrs]` pair or, for the JSON-LD script, a `[tag, attrs,
innerHTML]` triple rendered by `src/emit/frontmatter.ts`).

## Mechanisms

### The headTags seam

`headTags(input)` takes the site URL, page route, a required `title`, the
optional `siteName`, description, timestamps, section, package name, and the
optional `ogImage`, `twitterSite` and serialized `structuredData`. Tag order
is fixed — canonical, Open Graph, Twitter, JSON-LD — so a page's head is
stable build to build and a diff over generated pages stays readable; the
order carries no semantic meaning beyond that stability. `openGraphTags`
emits `og:title` (always) and `og:site_name` (when `siteName` is present)
immediately after `og:type`; `twitterTags` emits `twitter:title` alongside.
There is no separate alt-text helper competing with this seam: the only
alt-text chain is the one the bundle resolver in `@tsdoctor/bundle` computes
(an authored `alt`, then `tagline`, then `description`, then a generated
fallback), so a page's `og:image:alt` is decided once. `twitterSite` is a
seam input with no adapter wiring yet — there is no plugin option that
supplies a handle.

### Canonical and Open Graph

`deriveSiteUrl(siteOrigin, base)` joins a site origin and base path in the
order `siteOrigin + base + routePath` and yields `""` with no `siteOrigin` —
a root-relative prefix rather than nothing, so head tags still emit and are
inspectable under a dev build with no configured origin. `resolveUrl` rejects
a bare relative path rather than guessing a base. `openGraphTags` emits the
Open Graph block with conditional image sub-tags; `twitterTags` emits the
card block.

### Attribution

`attributionFacts(manifest: PackageManifest): AttributionFacts` is total and
synchronous — a manifest with none of the relevant fields yields empty
arrays and no optional properties, never a failure. Per-field degradation is
the contract: every value ends up in markup a crawler reads as authoritative,
so a field that cannot be derived is absent rather than guessed. Three
decisions inside it:

- **The SPDX screen is the grammar, not a hand-rolled list.** The license
  check declines npm's non-SPDX spellings (`UNLICENSED`, `SEE LICENSE IN
  <file>`) through `@effected/spdx`'s expression parser, rather than a list
  that would go stale the moment npm admits a third non-SPDX spelling.
- **`licenseUrls` is plural because `primaryLicenseId` is absent for an `AND`
  expression**, where every term binds at once and naming one would drop a
  license that legally applies. URLs come from each catalog entry's own
  `referenceUrl`, never from concatenating an id onto
  `https://spdx.org/licenses/` — wrong for a `LicenseRef`, which has no such
  page. A license outside the catalog drops out rather than appearing as a
  fabricated URL. `licenseIds` and `licenseUrls` are therefore not
  index-aligned.
- **`repositoryUrl` prefers `Repository.directoryUrl` and falls back to
  `browseUrl`.** On a monorepo, `browseUrl` reports the repository root for
  every member package, and that is the URL a crawler uses to tell packages
  apart; falling back to it is precision loss, not a correctness bug.

### Structured data

Built on `@effected/schema-org`, whose node-graph types are `JsonLdDocument`
/ `JsonLdNode` / `NodeRef` and whose validator lives on the `./validate`
subpath. The schema.org vocabulary itself is domain-neutral and lives in the
kit; what lives in this package is only the mapping — which documentation
concept becomes which schema.org node, and how the nodes on a page reference
each other.

`packageContext(input)` is derived once per API by the caller and carried
across the page pipeline rather than recomputed per page: the
`SoftwareSourceCode` node, every `Person` the package credits, and the `@id`
they are referenced by. `PackageContext` is opaque by design — build it with
`packageContext` and carry the value; deriving it per page would mint
several hundred identical nodes per build. `derive(pkg, page)` assembles the
page's `@graph`: the package's nodes plus a `TechArticle` for the page and an
`APIReference` for the symbol, linked by `isPartOf` and `mainEntity` so a
crawler reading any one node can reach the others. `@id`s are fragments on
real routes (`#source`, `#person-…` on the base route; `#article`, `#symbol`
on the page route), so a node is distinguishable from the page it is
attached to and the package node deduplicates across a crawl.

Modelling decisions worth remembering: `version` is used rather than
`softwareVersion` (the latter is defined on `SoftwareApplication`, not
`SoftwareSourceCode`, and would serialize fine while being wrong — only the
conformance validator catches that); everyone credited is modelled as a
`Person`, because npm carries no person/organization distinction and
guessing from a name's shape would be fabrication; every identity failure
lands on the error channel through `JsonLdDocument.buildResult` rather than
throwing out of a constructor.

**Serialize with `toScriptBody`, never `JSON.stringify`.**
`deriveScriptBody` calls `JsonLdDocument.toScriptBody()`, the only
serializer that escapes the sequences that would close the surrounding
`<script>` tag — every string in the graph originates in author-written
TSDoc. `HeadTag.jsonLd`'s own `escapeScriptBody` additionally escapes `<`,
`>` and `&` for XHTML parsing, and is idempotent — no sequence it emits
contains those characters — so the two layers compose rather than
double-escape.

## Testing

Conformance is checked offline, in CI, not per page in a production build:
`Conformance.check` from `@effected/schema-org/validate` runs over manifest
fixtures in `packages/seo/__test__/structured-data.test.ts`, asserted to
`[]`, plus a root-relative-site-URL case and a strict `unknownTerms: "fail"`
run that an invented schema.org term would fail. Validation stays
fixture-level because the vocabulary is static — running the validator on
every page in a production build would spend build time re-deriving a
constant answer.

## Out of scope

Open Graph image *generation* (satori + resvg-js — that now happens at build
time in the upstream `@savvy-web/bundler` meta pass, not in this package or
either adapter), sitemaps, `robots.txt`, and a configured `twitter:site`
handle (the seam input exists; no plugin option supplies it yet).

## Invariants

- An adapter never composes head tags itself — every tag a page gets comes
  from one call to `headTags`. Two adapters composing independently is
  exactly the drift this seam exists to prevent.
- JSON-LD is serialized only through `JsonLdDocument.toScriptBody()` followed
  by `HeadTag.jsonLd`'s `escapeScriptBody` — never `JSON.stringify` on the
  raw graph.
- `attributionFacts` never throws and never fabricates a value; a field
  either derives cleanly or is absent.
- `packageContext` is computed once per API and passed by value; it is not
  recomputed per page.

## Links

- [single-headtags-seam](../decisions/single-headtags-seam.md)
- [seo-degrades-never-fails](../conventions/seo-degrades-never-fails.md)
- [seo-headtags](../interfaces/seo-headtags.md)
- [head-tags-built-in-generate-stage](../decisions/head-tags-built-in-generate-stage.md)
