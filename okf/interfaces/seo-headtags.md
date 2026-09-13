---
type: Interface
title: "@tsdoctor/seo headTags seam"
description: The single seam that decides which head-element tags a generated page gets.
kind: api
resource: ../../packages/seo/src/Seo.ts
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: d8b5f6598e54f4cfe5528f6d2893008f855b757e638fc5b481066f7b1517d625
sources:
  - id: seo-src
    resource: ../../packages/seo/src/Seo.ts
  - id: headtag-src
    resource: ../../packages/seo/src/HeadTag.ts
  - id: rspress-helpers
    resource: ../../platforms/rspress/src/markdown/helpers.ts
  - id: vitepress-frontmatter
    resource: ../../platforms/vitepress/src/emit/frontmatter.ts
---

# `@tsdoctor/seo` headTags seam

`headTags(input: SeoPageInput): ReadonlyArray<HeadTag>` is the one function
either adapter calls to learn what a page's `<head>` contains. This package
decides WHICH tags a page gets; an adapter's job is only to render a
`HeadTag` into whatever its framework calls a head entry — never to compose
tags itself.[^seo-src]

## Inputs (`SeoPageInput`)

`siteUrl` (from `deriveSiteUrl`; `""` leaves every URL root-relative),
`pageRoute`, a required `title` (used for both `og:title` and
`twitter:title`), an optional `siteName` (feeds `og:site_name` only when
present), a required `description`, `publishedTime` / `modifiedTime` (ISO
8601, for `article:*`), `section`, the documented package's `packageName`,
an optional resolved `ogImage`, an optional `twitterSite` handle and an
optional serialized `structuredData` JSON-LD string.[^seo-src]

## The `HeadTag` vocabulary

A `HeadTag` is deliberately dumb: `{ tag: "meta" | "link" | "script";
attrs: Readonly<Record<string, string>>; body?: string }`. `body` is only
meaningful for `script`. Constructors: `meta`, `metaNamed`, `link`, `jsonLd`
(which escapes `<`, `>` and `&` in the body via `escapeScriptBody` so a
JSON-LD payload — author-written TSDoc content — cannot close the
surrounding `<script>` element early).[^headtag-src]

## Order is fixed and carries no semantics

`headTags` returns, in order: the canonical `<link>`, the Open Graph block,
the Twitter block, then (when `structuredData` is non-empty) the JSON-LD
`<script>`. A crawler reads the tags as a set; the fixed order exists only
so a page's emitted head is stable build to build and a diff over generated
pages stays readable.[^seo-src]

## What is guaranteed and what is not

- `og:title` is always emitted. `og:site_name` is emitted only when
  `siteName` is present.
- `twitterSite` is accepted as an input with **no adapter wiring today** —
  neither the RSPress plugin options nor the VitePress config helper
  supplies a value for it, so it is presently always absent in practice.
- The image alt-text inference chain (`alt` → `tagline` → `description` →
  a generated fallback) is not this seam's concern: it lives in
  `@tsdoctor/bundle`'s resolver, upstream of the `ogImage` this seam
  receives already resolved.

## The two renderers

Both adapters consume the identical `HeadTag[]`; they differ only in how
their framework spells a head entry:

- **RSPress** (`markdown/helpers.ts`'s `generateFrontmatter`) renders each
  tag into a frontmatter `[tagName, attrs]` pair; a `script` body becomes
  the `children` attribute — the spelling unhead maps onto
  `innerHTML`.[^rspress-helpers]
- **VitePress** (`emit/frontmatter.ts`'s `headConfig`) renders a tag with no
  body as a `[tag.tag, attrs]` pair and a tag with a body as the
  `[tag.tag, attrs, body]` triple, VitePress's own `HeadConfig`
  shape.[^vitepress-frontmatter]

[^seo-src]: `packages/seo/src/Seo.ts`
[^headtag-src]: `packages/seo/src/HeadTag.ts`
[^rspress-helpers]: `platforms/rspress/src/markdown/helpers.ts:101-112`
[^vitepress-frontmatter]: `platforms/vitepress/src/emit/frontmatter.ts:45-48` (`headConfig`)

See also [single-headtags-seam decision](../decisions/single-headtags-seam.md)
and [seo-degrades-never-fails convention](../conventions/seo-degrades-never-fails.md).
