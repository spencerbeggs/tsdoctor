# packages/seo/CLAUDE.md

`@tsdoctor/seo` (publishable, versioned via changesets) — framework-neutral
`<head>` metadata for static TypeScript API docs: canonical URLs, Open Graph
and Twitter cards, package attribution, and schema.org JSON-LD. The phase-4
package; the settled design lives in
`.claude/design/rspress-plugin-api-extractor/structured-data-and-og.md` and is
the authority for the seam, the JSON-LD mapping and the identity scheme.

Keep it pure: no filesystem, no network, no native dependencies, no framework
types. Filesystem probing of a configured OG image stays in the adapter's
`OgService`.

## Key Facts

- **`Seo.headTags(input: SeoPageInput) → ReadonlyArray<HeadTag>` is the single
  adapter seam.** This package decides WHICH tags a page gets; an adapter only
  renders a `HeadTag` into whatever its framework calls a head entry. Never
  export a set of emitters for adapters to compose themselves — that is how two
  adapters end up disagreeing about a page's head. Tag order is fixed
  (canonical, OG, Twitter, JSON-LD) so a page's head is stable build-to-build.
- Modules, one per concern: `HeadTag.ts` (the `HeadTag` interface + `meta`,
  `metaNamed`, `link`, `jsonLd`, `escapeScriptBody`), `Canonical.ts`
  (`deriveSiteUrl`, `canonicalUrl`, `resolveUrl`, `imageMimeType`),
  `OpenGraph.ts` (the OG schemas, `createPageMetadata`, `openGraphTags`,
  `twitterTags` — `og:title` and `og:site_name` come from the page `title`
  and optional `siteName`, no separate alt-text chain), `Attribution.ts`
  (`attributionFacts`),
  `StructuredData.ts` (`packageContext`, `derive`, `deriveScriptBody`,
  `StructuredDataError`), `Seo.ts` (`headTags`).
- `HeadTag` is deliberately dumb — `{ tag; attrs; body? }`. Keeping it stupid is
  what makes the phase-5 VitePress adapter a rendering change rather than a
  second SEO implementation.
- **`packageContext` is derived ONCE PER API**, not per page, and carried across
  the page pipeline; it is opaque by intent (build it, do not hand-assemble
  one). Per-page derivation would mint hundreds of identical nodes per build.
- **Serialize JSON-LD with `JsonLdDocument.toScriptBody()`, never
  `JSON.stringify(graph.toJsonLd())`** — only `toScriptBody` escapes sequences
  that would close the surrounding `<script>`. Every string originates in
  author-written TSDoc. `HeadTag.jsonLd`'s `escapeScriptBody` is idempotent, so
  the two layers compose rather than double-escape.
- `attributionFacts` is total and synchronous: per-field degradation, never a
  failure. A fact that cannot be derived is **absent rather than guessed** —
  every value ends up in markup a crawler reads as authoritative. Build license
  URLs from each SPDX catalog entry's own `referenceUrl`; never concatenate an
  id onto `https://spdx.org/licenses/`. `licenseIds` and `licenseUrls` are not
  index-aligned.
- **Degrade, never fail.** No derivation here may abort a docs build; the
  adapter maps `OgImageError` / `StructuredDataError` to a
  `ConfigValidationWarning` and renders the page without that tag.
- Peers: `effect` (`catalog:effect:peers`) plus `@effected/package-json`,
  `@effected/schema-org` and `@effected/spdx` (`catalog:effected:peers`) —
  never hand-pin an `@effected` range. Note `@effected/schema-org`'s validator
  lives on the `./validate` subpath, and its graph types are
  `JsonLdDocument`/`JsonLdNode`/`NodeRef`.
- Conformance is gated **offline in CI**: `Conformance.check` over the manifest
  fixtures in `__test__/structured-data.test.ts`, asserted to `[]`, plus a
  strict `unknownTerms: "fail"` run. There is no per-page validation in a
  production build — the vocabulary is static, so fixtures cover the shapes.
- Sole consumer today is `platforms/rspress/` (`workspace:*`), which deleted its
  `og-resolver.ts` and `schemas/opengraph.ts` into this package and re-exports
  the OG vocabulary from its own `src/index.ts`.
- **Out of scope (deliberate):** OG image *generation* (satori + resvg-js —
  deferred, needs a native binary and its own persistence story), sitemaps and
  `robots.txt`. `twitterSite` is a seam input with no adapter config yet.
- Builds with `defineBuild()` (`savvy.build.ts`, `@savvy-web/bundler`);
  tsconfig extends `@savvy-web/bundler/tsconfig/ecma.json`. Source
  `package.json` stays `"private": true`; `publishConfig` drives publishing.

## Commands

```bash
pnpm --filter @tsdoctor/seo run build:dev
pnpm vitest run packages/seo/
```

## Design Docs

- @../../.claude/design/rspress-plugin-api-extractor/structured-data-and-og.md
- @../../.claude/design/rspress-plugin-api-extractor/tsdoctor-package-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/snapshot-tracking-system.md
