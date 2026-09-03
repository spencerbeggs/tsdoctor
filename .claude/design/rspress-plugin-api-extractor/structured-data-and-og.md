---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-08-26
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/configuration-system.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/vitepress-adapter.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
---

# Structured data and head metadata

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [The headTags seam](#the-headtags-seam)
- [Canonical URLs and Open Graph](#canonical-urls-and-open-graph)
- [Attribution](#attribution)
- [Structured data](#structured-data)
- [Injection into the frontmatter head](#injection-into-the-frontmatter-head)
- [Data threading through the adapter](#data-threading-through-the-adapter)
- [Change detection](#change-detection)
- [Error posture](#error-posture)
- [Testing](#testing)
- [Out of scope](#out-of-scope)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

Every generated API page carries complete `<head>` metadata — a canonical `<link>`, the Open Graph block, the Twitter card block and a schema.org JSON-LD `<script>` — derived by the framework-neutral `@tsdoctor/seo` (`packages/seo`) and rendered into each framework's head shape by its adapter. The rule the layer is built around: `@tsdoctor/seo` decides which tags a page gets; an adapter only renders a `HeadTag` into whatever its framework calls a head entry. That is what makes the VitePress adapter a rendering change rather than a second SEO implementation.

## Current state

| Module | Contents |
| --- | --- |
| `packages/seo/src/HeadTag.ts` | The neutral tag vocabulary: `HeadTag`, `meta`, `metaNamed`, `link`, `jsonLd`, `escapeScriptBody` |
| `packages/seo/src/Canonical.ts` | `deriveSiteUrl`, `canonicalUrl`, `resolveUrl`, `imageMimeType` |
| `packages/seo/src/OpenGraph.ts` | The OG schemas, `createPageMetadata`, `ogAltText`, `openGraphTags`, `twitterTags` |
| `packages/seo/src/Attribution.ts` | `attributionFacts(manifest)` |
| `packages/seo/src/StructuredData.ts` | `packageContext`, `derive`, `deriveScriptBody`, `StructuredDataError` |
| `packages/seo/src/Seo.ts` | `headTags(input)` — the one adapter seam |
| `platforms/rspress/src/services/OgService.ts` | Filesystem probing of a configured OG image (genuinely I/O, genuinely RSPress-path-shaped) |
| `platforms/rspress/src/markdown/helpers.ts` | RSPress frontmatter `head` pairs from `HeadTag[]` |
| `platforms/vitepress/src/emit/frontmatter.ts` | VitePress `HeadConfig` from the same `HeadTag[]` |

The package is pure — no filesystem, no network, no native dependencies — and depends on `@effected/package-json`, `@effected/schema-org` and `@effected/spdx` plus `effect`. OG image generation (satori + resvg) is not built; configured images are resolved by `OgService`.

## The headTags seam

`headTags(input: SeoPageInput): ReadonlyArray<HeadTag>` takes the site URL, page route, description, timestamps, section, package name and the optional `ogImage`, `twitterSite` and serialized `structuredData`. A `HeadTag` is deliberately dumb — a tag name, an attribute record and an optional body. Tag order is fixed (canonical, Open Graph, Twitter, JSON-LD) so a page's head is stable build to build and a diff over generated pages stays readable; the order carries no semantics. `twitterSite` is a seam input with no adapter wiring yet — there is no plugin option that supplies a handle.

## Canonical URLs and Open Graph

`deriveSiteUrl(siteOrigin, base)` joins RSPress's own `siteOrigin` and `base` in the documented `siteOrigin + base + routePath` order and yields `""` with no `siteOrigin` — a root-relative prefix rather than nothing, so head tags are still emitted and inspectable under `rspress dev`. The adapter therefore gates head-tag emission on `packageName`, not on a non-empty site URL; gating on non-emptiness would silently drop every tag on a dev build (`configuration-system.md`). `resolveUrl` rejects a bare relative path rather than guessing a base. `openGraphTags` emits the OG block with conditional image sub-tags; `twitterTags` the card block.

## Attribution

`attributionFacts(manifest: PackageManifest): AttributionFacts` is total and synchronous: a manifest with none of the fields yields empty arrays and no optional properties, never a failure. Per-field degradation is the contract — every value ends up in markup a crawler reads as authoritative, so a field that cannot be derived is absent rather than guessed. Three decisions inside it:

- **The SPDX screen is the grammar, not a list.** `licenseExpressionOf` from `@effected/package-json` declines npm's non-SPDX spellings (`UNLICENSED`, `SEE LICENSE IN <file>`); a hand-rolled list would go stale the day npm admitted a third.
- **`licenseUrls` (plural) exists because `primaryLicenseId` is absent for an `AND` expression**, where every term binds at once and naming one would drop a license that legally applies. URLs come from each catalog entry's own `referenceUrl`, never from concatenating an id onto `https://spdx.org/licenses/` (wrong for a `LicenseRef`, which has no such page); a license outside the catalog drops out rather than appearing as a fabricated URL. `licenseIds` and `licenseUrls` are not index-aligned.
- **`repositoryUrl` prefers `Repository.directoryUrl` and falls back to `browseUrl`.** On a monorepo `browseUrl` reports the repository root for every member, and that URL is what a crawler uses to tell packages apart. The root is still a true `codeRepository`, so the fallback is precision loss, not a correctness bug.

## Structured data

Built on `@effected/schema-org`, whose node-graph types are `JsonLdDocument` / `JsonLdNode` / `NodeRef` and whose validator lives on the `./validate` subpath. The vocabulary is domain-neutral and lives in the kit; what lives here is only the mapping — which documentation concept becomes which schema.org node and how the nodes on a page reference each other.

`packageContext(input)` is derived once per API in `build-program.ts` and carried across the page pipeline: the `SoftwareSourceCode` node, every `Person` the package credits and the `@id` they are referenced by. Deriving it per page would mint several hundred identical nodes per build. `PackageContext` is opaque by intent — build it with `packageContext` and carry it. `derive(pkg, page)` assembles the page's `@graph`: the package's nodes plus a `TechArticle` for the page and an `APIReference` for the symbol, linked by `isPartOf` and `mainEntity` so a crawler reading any one node can reach the others. `@id`s are fragments on real routes (`#source`, `#person-…` on the base route; `#article`, `#symbol` on the page route), so a node is distinguishable from the page at that route and the package node deduplicates across a crawl.

Modelling decisions: `version` rather than `softwareVersion` (the latter is defined on `SoftwareApplication`, not `SoftwareSourceCode`, and would serialize fine while being wrong — the conformance validator is what catches it); everyone credited is a `Person`, because npm carries no person/organization distinction and guessing from a name's shape would be fabrication; every identity failure lands on the error channel through `JsonLdDocument.buildResult` rather than throwing out of a constructor.

**Serialize with `toScriptBody`, never `JSON.stringify`.** `deriveScriptBody` uses `JsonLdDocument.toScriptBody()`, the only serializer that escapes the sequences that would close the surrounding `<script>` — every string in the graph originates in author-written TSDoc. The adapter's own `escapeScriptBody` (in `HeadTag.jsonLd`) additionally escapes `<`, `>` and `&` for XHTML parsing, and is idempotent — no sequence it emits contains those characters — so the two layers compose rather than double-escape.

## Injection into the frontmatter head

The RSPress adapter renders a `HeadTag` into a frontmatter `head` pair `[tagName, attrs]` in `generateFrontmatter`, with every value whitespace-normalized so the parsed data — and therefore the snapshot hash — matches what the earlier hand-rolled emitter produced. A `script` body becomes the `children` attribute, the name unhead maps onto `innerHTML`; any other spelling emits an empty `<script>` and fails silently in the browser rather than in the build. VitePress renders the same `HeadTag` as a `[tag, attrs, innerHTML]` triple (`vitepress-adapter.md`).

## Data threading through the adapter

`ResolvedApiConfig` carries `manifest?: PackageManifest`, the package's `package.json` decoded through `@effected/package-json`'s shape-strict tier (`configuration-system.md`). `build-program.ts` derives `structuredDataPkg` once per API from that manifest plus the resolved `siteUrl` and threads it into the pipeline input beside `siteUrl`, `docsRoot` and `ogImage`; `generateSinglePage` resolves the OG image, derives the script body and calls `headTags` (`page-generation-system.md`).

## Change detection

Head tags are covered by the snapshot system's frontmatter hash: `hashFrontmatter` hashes `head` with timestamps stripped recursively, and head-tag construction runs in the generate stage so the hash is taken over the final frontmatter. Two things were once wrong at once — `head` was excluded from the hash, and the fix for that landed on a path nothing took, because the hash was computed one stage before head tags existed, with a passing unit test the whole time that called the hasher with an input no caller produced. The acceptance evidence for a change-detection fix is a rebuild count over the real pipeline: bump one input, count what was rewritten. `snapshot-tracking-system.md` records the mechanism.

## Error posture

Degrade, never fail. No SEO derivation may abort a docs build:

| Failure | Handling |
| --- | --- |
| `OgImageError` (misconfigured OG image) | `ConfigValidationWarning` emitted; page renders without `og:image` |
| `StructuredDataError` (a malformed, duplicated or colliding `@id`) | `ConfigValidationWarning` emitted; page renders without JSON-LD |
| `PackageManifest` decode failure | `ConfigValidationWarning` emitted; `manifest` absent, so no page in that API carries JSON-LD |

Because each is typed rather than thrown, it reaches `issues.json` rather than a stack trace (`build-progress-and-issues.md`).

## Testing

Conformance is checked offline and in CI: `Conformance.check` from `@effected/schema-org/validate` runs over manifest fixtures in `packages/seo/__test__/structured-data.test.ts`, plus a root-relative-site-URL case and a strict `unknownTerms: "fail"` run that an invented term would fail. Validation is fixture-level only — the vocabulary is static, so running the validator per page in a production build would spend build time re-deriving a constant answer. The adapter side adds `platforms/rspress/__test__/markdown/head-tags.test.ts` and the two hash-direction tests in `build-stages.test.ts`. The manual Google Rich Results confirmation is a human step, not an automated test.

## Out of scope

OG image generation (needs a native binary and its own persistence story; it rides on this seam when built); sitemaps and `robots.txt`; a `twitter:site` plugin option; per-page conformance validation in a production build.

## Rationale

- **Why one seam rather than exported emitters:** an adapter that composes tags itself can disagree with the next one about which tags a page gets.
- **Why a separate package rather than a module of the model:** the model's job is the API model; SEO is a different domain that keeps growing, and the second adapter must import it, not reimplement it. A separate `@tsdoctor/open-graph` was rejected because OG and JSON-LD answer the same question from the same inputs at one call site.
- **Why the vocabulary lives in `@effected/schema-org`:** schema.org is domain-neutral; owning it here would put an offline conformance corpus in a documentation package.
- **Why `PackageManifest` rather than the lenient tier:** attribution needs decoded `Person` / `Repository` / SPDX values, and shape strictness is affordable because the failure degrades to an absent field.

## Related documentation

- **Site URL derivation and the manifest decode:** `configuration-system.md`
- **The generate stage that calls the seam:** `page-generation-system.md`
- **The frontmatter hash:** `snapshot-tracking-system.md`
- **The second renderer of `HeadTag[]`:** `vitepress-adapter.md`
- **Package architecture and the `@effected` dependency map:** `tsdoctor-package-architecture.md`
- **Where `ConfigValidationWarning` ends up:** `build-progress-and-issues.md`
