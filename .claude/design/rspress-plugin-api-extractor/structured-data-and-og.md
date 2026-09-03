---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-08-26
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/roadmap-1.0.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
dependencies: []
---

# Structured Data and Head Metadata (`@tsdoctor/seo`)

> This is the deferred phase-4 design doc named in `roadmap-1.0.md`'s "Deferred Design Docs" table. It records the DELIVERED design: the `@tsdoctor/seo` workspace, the single `headTags` adapter seam, the schema.org JSON-LD derivation, and the change-detection defect the work uncovered and closed. Implemented against a working plan and spec (the 2026-08-25 SEO layer plan, untracked and since archived — `.claude/plans/` is gitignored); this document is the record.

## Table of Contents

- [Overview](#overview)
- [Current State](#current-state)
- [Package Topology](#package-topology)
- [The `headTags` Seam](#the-headtags-seam)
- [Canonical URLs and Open Graph](#canonical-urls-and-open-graph)
- [Attribution](#attribution)
- [Structured Data (JSON-LD)](#structured-data-json-ld)
- [Injection: JSON-LD Rides the Frontmatter `head`](#injection-json-ld-rides-the-frontmatter-head)
- [Data Threading Through the Adapter](#data-threading-through-the-adapter)
- [The Change-Detection Defect](#the-change-detection-defect)
- [Error Posture](#error-posture)
- [Testing and the Gate](#testing-and-the-gate)
- [Out of Scope](#out-of-scope)
- [Rationale](#rationale)
- [Related Documentation](#related-documentation)

## Overview

Every generated API page now carries complete `<head>` metadata — a canonical
`<link>`, the Open Graph block, the Twitter card block, and a schema.org
JSON-LD `<script>` — derived by a new framework-neutral workspace,
**`@tsdoctor/seo`** (`packages/seo`), and rendered into RSPress's frontmatter
`head` shape by the adapter.

The design rule the whole layer is built around: **`@tsdoctor/seo` decides
WHICH tags a page gets; an adapter only renders a `HeadTag` into whatever its
framework calls a head entry.** That is what makes the phase-5 VitePress
adapter a rendering change rather than a second SEO implementation.

## Current State

Phase 4 tasks 1–10 of the SEO layer plan are complete and landed on
`feat/phase-4` (2026-08-26). Delivered:

- `packages/seo` — the fifth core `@tsdoctor/*` package, framework-neutral and
  pure (no filesystem, no network, no native dependencies).
- Canonical `<link>` tags, which this plugin had never emitted.
- Twitter card vocabulary, likewise new.
- schema.org JSON-LD over the newly released `@effected/schema-org@0.1.0`,
  conformance-gated offline in CI.
- Attribution (author, maintainers, license, repository, keywords) derived
  from an `@effected/package-json` `PackageManifest`.
- A fix to `hashFrontmatter` plus a pipeline-stage move that together make
  head-tag changes visible to incremental-build change detection **for the
  first time** — see [The Change-Detection Defect](#the-change-detection-defect).

**Deferred out of phase 4, deliberately:** the OG *image generation* pipeline
(satori + resvg-js). It needs a native binary and its own persistence story,
and it rides on the head-tag seam this work built, so building the seam first
makes the image branch a leaf change rather than a second architecture. The
adapter's `OgService` already resolves a *configured* image (filesystem
probing for dimensions), and that is unchanged.

Two deletions worth naming: `packages/model/src/StructuredData.ts` — the
`@alpha`, zero-consumer, throwing phase-4 stub the roadmap originally sited
schema.org derivation in — is **gone**, along with its export from the model
barrel. The adapter's `og-resolver.ts` and `schemas/opengraph.ts` are **gone**
too; their contents moved into `@tsdoctor/seo`.

## Package Topology

`packages/seo` (`@tsdoctor/seo`), one module per concern:

| Module | Contents |
| --- | --- |
| `HeadTag.ts` | The neutral tag vocabulary: the `HeadTag` interface plus `meta`, `metaNamed`, `link`, `jsonLd`, `escapeScriptBody` |
| `Canonical.ts` | `deriveSiteUrl`, `canonicalUrl`, `resolveUrl`, `imageMimeType` — moved out of the adapter's `og-resolver.ts` |
| `OpenGraph.ts` | `OpenGraphImageConfig` / `OpenGraphImageMetadata` / `OpenGraphMetadata` schemas, `createPageMetadata`, `ogAltText`, `openGraphTags`, and the new `twitterTags` — moved out of the adapter's `schemas/opengraph.ts` |
| `Attribution.ts` | `attributionFacts(manifest) → AttributionFacts` |
| `StructuredData.ts` | `packageContext`, `derive`, `deriveScriptBody`, `StructuredDataError` |
| `Seo.ts` | `headTags(input: SeoPageInput) → ReadonlyArray<HeadTag>` — the one adapter seam |

**Why a separate package rather than filling in `@tsdoctor/model`'s stub.**
The model's job is the API model; SEO is a different domain that will keep
growing (images, sitemaps, robots). And the phase-5 VitePress adapter must
IMPORT this logic rather than reimplement it, which is the stated reason the
core packages exist at all.

**Why not a separate `@tsdoctor/open-graph`.** Considered and rejected. OG
metadata and JSON-LD are both answers to "what goes in this page's head," they
share the same inputs (manifest, item facts, resolved URLs), and the adapter
composes them at one call site. Two packages would mean two dependency edges
and two release cadences for one concern.

**What the adapter keeps:** `OgService` (filesystem probing of a configured
local image — genuinely I/O and genuinely RSPress-path-shaped), the
frontmatter emission, and the RSPress head injection.

### Dependencies

`@tsdoctor/seo` declares `@effected/package-json`, `@effected/schema-org` and
`@effected/spdx` (all `catalog:effected` / `catalog:effected:peers`) plus
`effect`. It is `private: true` in source with `publishConfig` doing the
publishing, like every sibling.

The adapter gains `@tsdoctor/seo: workspace:*`, and `@effected/package-json`
was already in its dependency closure. `pnpm-workspace.yaml`'s
`configDependencies` bumped `@effected/pnpm-plugin-effect` to `0.6.11`, which
carries the `@effected/schema-org` catalog entry; `@effected/spdx@0.5.0` and
`@effected/package-json@0.13.0` shipped in the same wave.

## The `headTags` Seam

```typescript
export function headTags(input: SeoPageInput): ReadonlyArray<HeadTag>;
```

`SeoPageInput` carries `siteUrl`, `pageRoute`, `description`,
`publishedTime`, `modifiedTime`, `section`, `packageName`, and the optional
`ogImage`, `twitterSite` and `structuredData` (a serialized graph).

A `HeadTag` is deliberately dumb — `{ tag: "meta" | "link" | "script"; attrs:
Record<string, string>; body?: string }`. RSPress renders one into a
frontmatter `head` pair; VitePress would render the same value into a
`transformHead` entry. Keeping the type this stupid is what makes the second
adapter cheap.

**Tag order is fixed** — canonical link, Open Graph block, Twitter block, then
the JSON-LD script. The order carries no semantics (a crawler reads the tags
as a set); it is fixed so that a page's emitted head is stable build-to-build
and a diff over generated pages stays readable.

**`twitterSite` is a seam input with no adapter wiring yet.** `headTags`
threads it into `twitterTags` and the package tests pin that, but the RSPress
adapter passes no value for it today — there is no plugin option that supplies
a `twitter:site` handle. Adding one is a config change, not an architecture
change.

## Canonical URLs and Open Graph

`deriveSiteUrl(siteOrigin, base)` is unchanged in behaviour from its former
home in the adapter: it joins RSPress's own `siteOrigin` and `base` in the
documented `siteOrigin + base + routePath` order, and with no `siteOrigin`
yields `""` — a **root-relative** prefix rather than nothing. That fallback is
why head tags are still emitted, and still inspectable, under `rspress dev` on
localhost where no configured origin could be right.

The consequence for the emit gate is stated once and load-bearing in two
places: the adapter gates head-tag emission on `packageName` (and the presence
of a resolved `siteUrl` value) rather than on a NON-EMPTY site URL. Gating on
non-emptiness would silently drop every tag on a dev build.

`resolveUrl` was `resolveOgUrl` in the adapter; canonical links resolve through
the same function, so the OG-specific name no longer fitted. It rejects a bare
relative path rather than guessing a base to resolve it against.

`openGraphTags` is the tag-emission logic that was inlined in the adapter's
`generateFrontmatter`, lifted unchanged — same tag order, same conditional
emission of each optional image sub-tag. `twitterTags` is new.

## Attribution

`attributionFacts(manifest: PackageManifest): AttributionFacts` is total and
synchronous: a manifest carrying none of these fields yields empty arrays and
no optional properties, never a failure. Per-field degradation is the
contract — an unparseable license drops only the license facts, an
unrecognized repository reference drops only the repository URL. Every value
here ends up in markup a crawler reads as authoritative, so a field that
cannot be derived is **absent rather than guessed**.

Three decisions inside it are worth recording:

- **The SPDX screen is the grammar, not a list.** `licenseExpressionOf` from
  `@effected/package-json` IS the screen for npm's non-SPDX spellings
  (`UNLICENSED`, `SEE LICENSE IN <file>`): the grammar declines them, so
  discarding the parse failure answers "is this an expression at all". The
  hand-rolled list this replaced would have gone stale the day npm admitted a
  third spelling; a grammar does not.
- **`licenseUrls` (plural) exists because `licenseUrl` (singular) is not
  enough.** `primaryLicenseId` is absent for an `AND` expression, where every
  term binds at once and naming one would silently drop a license that legally
  applies — so a dual-licensed package reading only the singular emitted **no**
  schema.org `license` at all. `licenseUrls` lists the canonical page for every
  license the expression names. URLs come from each catalog entry's own
  `referenceUrl`, never from concatenating an id onto
  `https://spdx.org/licenses/`: that is exactly the string-building the catalog
  exists to prevent, and it is wrong for a `LicenseRef`, which has no such
  page. A license outside the catalog drops out of the array rather than
  appearing as a fabricated URL. `licenseIds` and `licenseUrls` are therefore
  **not index-aligned**.
- **`repositoryUrl` prefers `Repository.directoryUrl` and falls back to
  `browseUrl`.** `browseUrl` ignores `directory`, so on a monorepo every member
  reports the repository root — and that URL is exactly what a crawler uses to
  tell two packages apart. `directoryUrl` returns `None` rather than fabricating
  a path convention for a host it does not recognize. The fallback is
  deliberate: schema.org's `codeRepository` denotes the REPOSITORY, so the root
  is a *true* location, merely one that does not distinguish the package from
  its siblings. Precision loss, not a correctness bug, and better than omitting
  the field.

## Structured Data (JSON-LD)

Built on `@effected/schema-org@0.1.0` (first release, produced by round 2 of
the effected dogfood loop; consumed from the registry — the loop is closed and
the tree is unlinked).

Two upstream facts that a reader coming from the phase-4 plan will need,
because the plan's sketch guessed differently: the node-graph types are
**`JsonLdDocument` / `JsonLdNode` / `NodeRef`**, renamed mid-round from
`Graph` / `GraphNode` / `Ref` because `effect` exports both `Ref` and `Graph`
from its own root; and the validator lives on the **`./validate`** subpath, not
`./conformance` (the package's `exports` are exactly `.`, `./validate` and
`./package.json`). The vocabulary itself is domain-neutral and lives
in the kit — on the same principle that put the SPDX catalog in
`@effected/spdx`. What lives in `@tsdoctor/seo` is only the **mapping**: which
documentation concept becomes which schema.org node, and how the nodes on a
page reference each other.

### Surface

```typescript
function packageContext(input: PackageNodeInput): PackageContext;
function derive(pkg: PackageContext, page: PageNodeInput):
  Result<JsonLdDocument, StructuredDataError>;
function deriveScriptBody(pkg: PackageContext, page: PageNodeInput):
  Result<string, StructuredDataError>;
type StructuredDataError =
  ConflictingTermError | DuplicateNodeIdError | InvalidNodeIdError;
```

**`packageContext` is derived ONCE PER API**, in `build-program.ts`, and
carried across the page pipeline. It holds the `SoftwareSourceCode` node, every
`Person` node the package credits, and the `@id` they are referenced by.
Deriving it per page would mint several hundred identical nodes per build and
re-run the attribution derivation behind each one. `PackageContext` is opaque
by intent: build it with `packageContext` and carry it, do not assemble one by
hand.

`derive` assembles the page's `@graph`: the package's nodes plus a
`TechArticle` for the page and an `APIReference` for the symbol, linked by
`isPartOf` and `mainEntity`, so a crawler reading any one node can reach the
other two.

### Identity

The `@id` scheme uses fragments on real routes, so a node is distinguishable
from the page that happens to sit at that route:

| Node | `@id` |
| --- | --- |
| Package | `{canonical(baseRoute)}#source` |
| Person | `{canonical(baseRoute)}#person-{encodeURIComponent(name)}` |
| Article | `{canonical(pageRoute)}#article` |
| Symbol | `{canonical(pageRoute)}#symbol` |

Every page in an API references the same package `@id`, which is what makes
the package node deduplicate across a crawl.

### Modelling decisions

- **`version`, not `softwareVersion`.** The latter reads like the right name
  and is defined on `SoftwareApplication`, not on `SoftwareSourceCode`. It
  would serialize fine and be silently ignored; the conformance validator is
  what catches it.
- **Everyone credited is a `Person`.** The author is a `Person` when the
  manifest named a human and an `Organization` when the name reads as a scope —
  but npm carries no such distinction, so guessing would be fabrication. An
  organization ends up modelled as a person with an organization's name, which
  is imprecise rather than wrong; inventing a type from a string's shape would
  be neither.
- **Every identity failure lands in one place.** `@effected/schema-org` types
  every `@id` as a plain string and defers validation to
  `JsonLdDocument.buildResult`, so a malformed id, a duplicate id and a
  colliding catch-all key all surface on the error channel rather than throwing
  out of a constructor. Node construction cannot fail; `derive` passes the one
  typed failure straight through.

### Serialization: `toScriptBody`, never `JSON.stringify`

`deriveScriptBody` serializes via `JsonLdDocument.toScriptBody()`. **Never
`JSON.stringify(graph.toJsonLd())`** — `toScriptBody` is the only serializer
that escapes the sequences that would close the surrounding `<script>`
element. Every string in the graph originates in author-written TSDoc, so a
summary containing a literal `</script>` would otherwise inject markup into
the page.

The adapter's own `escapeScriptBody` (in `HeadTag.jsonLd`) escapes `<`, `>`
and `&` to `<` / `>` / `&`. `&` is escaped at a different layer
and for a different reason: XHTML parses script content as ordinary element
content, where a bare `&` is a well-formedness error, and nothing in a docs
pipeline guarantees which parse a consumer serves. **The escape is
idempotent** — no sequence it emits contains `<`, `>` or `&` — so a body that
arrives already escaped by `toScriptBody` survives a second pass unchanged.
That idempotence is what makes the two layers compose rather than
double-escape.

## Injection: JSON-LD Rides the Frontmatter `head`

The adapter renders a `HeadTag` into an RSPress frontmatter `head` pair in
`generateFrontmatter` (`markdown/helpers.ts`): `[tagName, attrs]`, with every
value whitespace-normalized exactly as the previous hand-rolled emitter did, so
the PARSED data — and therefore the snapshot frontmatter hash — is unchanged
for tags that already existed. Quoting and escaping are the emitter's job
(`@effected/yaml`, via `@tsdoctor/model`'s `Frontmatter.ts`).

**A `script` body becomes the `children` attribute.** That is the attribute
name unhead maps onto `innerHTML` for a `<script>` element, which is how a
JSON-LD body reaches the page. RSPress renders a head entry as
`React.createElement(tag, attrs)`; any other spelling emits an empty
`<script>` and fails silently in the browser rather than in the build.

## Data Threading Through the Adapter

`ResolvedApiConfig` (`services/ConfigService.ts`) gained
`manifest?: PackageManifest` — the same `package.json` decoded through
`@effected/package-json`'s `PackageManifest` tier, which is the shape
attribution derives from.

Deliberately NOT the discovery-tier `LenientManifest`, which leaves `author`
and `repository` as raw `string | Record` unions with no decoding at all.
`PackageManifest` is presence-lenient but **shape-strict**, so one malformed
field (a `version` of `"1.0"`, an `author` that is neither a string nor an
object) fails the whole decode. That is the right strictness for a layer that
needs real `Person` / `Repository` / SPDX values — and it degrades to the field
being absent, with a `ConfigValidationWarning` emitted, never to a failed
build. The loose `packageJson` field stays alongside it; it feeds dependency
extraction, and replacing it is a separate refactor.

`decodeManifest` in `layers/config-resolution.ts` performs the decode at both
resolution sites (single-API and multi-API).

`build-program.ts` then derives `structuredDataPkg` once per API from that
manifest plus the resolved `siteUrl`, and threads it into the pipeline input
alongside `siteUrl`, `docsRoot` and `ogImage`.

## The Change-Detection Defect

The most important thing this work uncovered, and the least obvious from the
diff.

### The symptom

Head tags were **invisible to incremental-build change detection**. Every
`og:image`, canonical URL and JSON-LD change had been invisible since the
frontmatter hash was written.

### Two causes, one of them a false fix

`hashFrontmatter` (`@tsdoctor/snapshot`'s `content-hash.ts`) used to exclude
the whole `head` key from the hash alongside the timestamp fields. Commit
`6d0d475` fixed that properly: `head` now participates, and timestamps are
stripped **recursively** instead — the meta-pair form (a `content` value whose
sibling `property`/`name` names `article:published_time` /
`article:modified_time`) and the JSON-LD date keys (`datePublished`,
`dateModified`, `uploadDate`) inside a parsed script body. The walk must be
recursive because `head` is an array of `[tagName, attrs]` pairs, so a shallow
pass would see nothing.

**But nothing ever passed it a frontmatter containing `head`.** The hash was
taken in `generateSinglePage` over the page generator's own frontmatter, which
carries no `head` at all; head tags were built one stage later, in
`writeSingleFile`. So the fix landed on a path nothing reached — and its unit
test passed the whole time, because it called `hashFrontmatter` directly with
a `head` array no caller ever produced.

### The fix

Head-tag construction — OG image resolution, JSON-LD derivation, and the
`headTags` call — **moved from `writeSingleFile` into `generateSinglePage`**,
so the frontmatter hash covers the final frontmatter. `writeSingleFile` now
writes `result.content` directly; the generate stage assembles the final text.
See `page-generation-system.md` for the resulting stage responsibilities.

This is only sound because `hashFrontmatter` strips every timestamp it can
reach. The adapter builds a local `finalFrontmatter(published, modified)` and
calls it **twice**: once with the build time, to hash, and once with the
resolved timestamps, to write. The two hash identically. Without the recursive
stripping, the hash would depend on the timestamps the hash itself decides.

### Measured

End-to-end on `sites/basic` (the one fixture site with `siteOrigin` set):

| Check | Before | After |
| --- | --- | --- |
| Bump only the fixture package's `version`, rebuild | **0 of 46 rewritten** | **37 of 46 rewritten** |
| Rebuild with no changes | all unchanged | all unchanged, `diff -r` byte-identical |

The 9 that stay unchanged are `_meta.json` and index pages, which carry no
JSON-LD.

### The transferable rule

**A fix can be correct and land on a path nothing takes, with a passing unit
test the whole time, because the test called the function with an input no
caller produces.** Strengthening the unit test would not have helped. Only
changing one real input and counting what actually got rewritten could see it.
When a change-detection fix ships, the acceptance evidence is a rebuild count,
not a unit assertion.

## Error Posture

**Degrade, never fail.** No SEO derivation may abort a docs build. Both
failure paths follow the posture `OgService` already established:

| Failure | Handling |
| --- | --- |
| `OgImageError` (misconfigured OG image) | `ConfigValidationWarning` emitted (reaching `issues.json`); page renders without an `og:image` |
| `StructuredDataError` (a malformed, duplicated or colliding `@id`) | `ConfigValidationWarning` emitted; page renders without a JSON-LD block |
| `PackageManifest` decode failure | `ConfigValidationWarning` emitted; `manifest` absent, so the API gets no `structuredDataPkg` and no page in it carries JSON-LD |

A structured-data failure is a defect in how ids are minted, not a reason to
stop a docs build — and because it is typed rather than thrown, it reaches the
artifact an agent reads rather than a stack trace.

## Testing and the Gate

**The roadmap's phase-4 gate — "structured data validates against schema.org
tooling" — is met offline and in CI**, not against a live Google endpoint.
`Conformance.check` from `@effected/schema-org/validate` runs over five
manifest fixtures in `packages/seo/__test__/structured-data.test.ts`, asserted
to `[]`, plus a root-relative-site-URL case and a strict
`unknownTerms: "fail"` run that an invented term would fail.

Validation is **fixture-level only** — there is no per-page conformance check
in a production build. The vocabulary is static, so fixtures covering each node
kind cover the shapes; running the validator per page would spend build time to
re-derive a constant answer.

The rest of the suite: `packages/seo/__test__/` covers each module
(`head-tag`, `canonical`, `open-graph`, `attribution`, `seo`,
`structured-data`); the adapter side adds
`platforms/rspress/__test__/markdown/head-tags.test.ts` (rendering a
`HeadTag[]` into frontmatter) and the two hash-direction tests in
`build-stages.test.ts` — a head-tag change must move the frontmatter hash, and
the build time must not. `og-resolver.test.ts` is deleted with the module it
covered; the equivalent assertions live in the seo package now.

One spec item has no automated test by design: the manual Google Rich Results
confirmation, which is a human step recorded as evidence.

## Out of Scope

- **OG image *generation*** (satori + resvg-js) — deferred, see
  [Current State](#current-state). Configured images are resolved today.
- **Sitemaps and `robots.txt`** — plausible future residents of this package,
  not built.
- **A `twitter:site` plugin option** — the seam accepts one; no config surfaces
  it yet.
- **Per-page conformance validation in a production build** — see above.

## Rationale

- **Why one seam rather than a set of exported emitters:** an adapter that
  composes tags itself is an adapter that can disagree with the next one about
  which tags a page gets. `headTags` makes the composition a core decision and
  leaves adapters with a rendering job.
- **Why the vocabulary lives in `@effected/schema-org` and not here:**
  schema.org is domain-neutral. Owning it here would make every future kit
  consumer re-derive it, and would put an offline conformance corpus in a
  documentation package.
- **Why the package node is per-API rather than per-page:** it is identical on
  every page of an API. Per-page derivation would mint several hundred
  identical nodes per build and re-run attribution behind each.
- **Why `PackageManifest` rather than the lenient tier:** attribution needs
  decoded `Person` / `Repository` / SPDX values, not raw unions. Shape
  strictness is affordable precisely because the failure degrades to an absent
  field rather than a failed build.
- **Why head tags moved into the generate stage:** correctness of change
  detection. The write stage is the wrong place to produce content the hash is
  supposed to cover.

## Related Documentation

- **Umbrella roadmap and the phase-4 gate:** `roadmap-1.0.md`
- **Package architecture and the layer cake:** `tsdoctor-package-architecture.md`
- **Adapter structure, `ResolvedApiConfig` and the peer closure:** `build-architecture.md`
- **Pipeline stage responsibilities:** `page-generation-system.md`
- **The frontmatter hash and incremental builds:** `snapshot-tracking-system.md`
- **Where `ConfigValidationWarning` ends up:** `build-progress-and-issues.md`
