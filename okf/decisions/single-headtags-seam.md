---
type: Decision
status: draft
title: One seam decides every head tag, adapters only render
description: "@tsdoctor/seo's headTags(input) is the single source of truth for which head-element tags a page gets; adapters render a HeadTag into their framework's shape and never compose their own."
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 756431b8382fbbf7d5fef2622a609186bea8caa93c7a58aca751da0b09783c47
---

# One seam decides every head tag, adapters only render

## Context

Two adapters generate documentation pages from the same API model —
`platforms/rspress/` and `platforms/vitepress/` — and each page needs a
canonical link, an Open Graph block, a Twitter card block and a schema.org
JSON-LD script. If each adapter independently decided which tags to emit
and how to derive their values, the two adapters could disagree about a
page's head for the same input, and a fix made in one would not propagate
to the other.

## Decision

`Seo.headTags(input: SeoPageInput): ReadonlyArray<HeadTag>`
(`packages/seo/src/Seo.ts:62`) is the one seam an adapter calls. It decides
which tags a page gets and in what order — canonical link, then Open Graph,
then Twitter, then JSON-LD when structured data is present
(`Seo.ts:76-84`) — a fixed order that carries no semantics (a crawler reads
the head as a set) but keeps generated pages diffable build to build.
`HeadTag` (`packages/seo/src/HeadTag.ts`) is deliberately a dumb shape: a
tag name, an attribute record and an optional body. Each adapter renders
that shape into whatever its framework calls a head entry:
`platforms/rspress/src/markdown/helpers.ts` turns a `script` tag's body
into a `children` attribute (the spelling `unhead`, RSPress's underlying
head manager, maps onto `innerHTML`), while
`platforms/vitepress/src/emit/frontmatter.ts`'s `headConfig` renders the
same tag as a `[tag, attrs, innerHTML]` triple. That one spelling
difference is the reason frontmatter assembly stays adapter-side rather
than moving into `@tsdoctor/seo`.

Two further decisions inside the seam:

- **`ogAltText` was deleted.** The package used to export a helper that
  produced strings like `"<Api> - <package> API Documentation"`. It is
  gone; the one surviving alt-text chain is the bundle resolver's own
  fallback (an authored `alt`, then `tagline`, then `description`, then a
  generated `"<name> API documentation"`), consumed through
  `OgImageRequest.fallbackAlt` in `platforms/rspress/src/services/OgService.ts`.
  Two disagreeing alt-text helpers were worse than one, and the wording
  changed once, user-visibly, as a result.
- **schema.org vocabulary lives in `@effected/schema-org`, not this
  package.** `packages/seo/src/StructuredData.ts` only decides which
  documentation concept becomes which schema.org node (`version`, not
  `softwareVersion`, because the latter is only defined on
  `SoftwareApplication`; everyone credited is a `Person`, because npm
  carries no person/organization distinction and guessing would be
  fabrication) and serializes with `JsonLdDocument.toScriptBody()`, never
  `JSON.stringify`, because only that serializer escapes sequences that
  would close the surrounding `<script>` around author-written TSDoc text.

## Alternatives rejected

- **Export per-concern emitters (`canonicalTag`, `ogTags`, `jsonLdTag`,
  ...) and let each adapter compose its own head.** An adapter that
  assembles its own head can disagree with the next one about which tags a
  page gets, or about ordering, or about a derivation detail like alt text
  — which is exactly what having two live adapters exposed.
- **A separate `@tsdoctor/open-graph` package, split from JSON-LD.**
  Rejected: Open Graph and structured data answer the same question — what
  does this page's head need — from the same inputs (`SeoPageInput`) at one
  call site, so splitting them would only relocate the seam problem one
  level down.
- **Host the derivation inside `@tsdoctor/model` as a module.** SEO is a
  different, still-growing domain from the api.json vocabulary the model
  owns, and a second adapter must import the derivation directly rather
  than reimplement it against a model export it does not otherwise need.

## Consequences

- Every SEO decision — which tags exist, their order, their derivation —
  changes in one place, and every adapter picks it up automatically.
- An adapter can never add a head tag `@tsdoctor/seo` did not decide to
  emit; a framework-specific SEO need that does not fit `SeoPageInput` is a
  seam-extension exercise, not a local workaround.
- The package must stay pure — no filesystem, no network, no framework
  types — so both adapters can call it identically; any filesystem probing
  (e.g. locating a configured OG image on disk) has to live in the adapter
  instead, which is why RSPress's `OgService` exists as a separate
  service rather than folding into `headTags`.
