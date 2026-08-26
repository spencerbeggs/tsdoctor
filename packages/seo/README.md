# @tsdoctor/seo

[![npm](https://img.shields.io/npm/v/@tsdoctor%2Fseo?label=npm&color=cb3837)](https://www.npmjs.com/package/@tsdoctor/seo)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Framework-neutral `<head>` metadata for static TypeScript API documentation: schema.org JSON-LD, Open Graph and Twitter card vocabulary, canonical URLs, and package attribution derived from a `package.json` manifest. The package decides which tags a documentation page gets; a framework adapter only renders them into whatever its framework calls a head entry.

## The one seam

`headTags(input)` returns a flat array of neutral `HeadTag` values — a canonical `<link>`, the Open Graph block, the Twitter card block, then a JSON-LD `<script>`. A `HeadTag` is deliberately dumb (`{ tag, attrs, body? }`), so RSPress renders one into a frontmatter `head` pair and VitePress renders the same value into a `transformHead` entry. Composition living here is what keeps two adapters from disagreeing about which tags a page gets.

## What you get

- **`headTags(input: SeoPageInput)`** — every `<head>` tag for one page, in a fixed order so a diff over generated pages stays readable.
- **`HeadTag`, `meta`, `metaNamed`, `link`, `jsonLd`, `escapeScriptBody`** — the neutral tag vocabulary. `escapeScriptBody` is idempotent, so a body already escaped by an upstream serializer survives a second pass unchanged.
- **`deriveSiteUrl`, `canonicalUrl`, `resolveUrl`, `imageMimeType`** — URL derivation. With no configured origin the prefix is `""`, so URLs stay root-relative and the tags are still emitted rather than dropped.
- **`OpenGraphImageConfig`, `OpenGraphImageMetadata`, `OpenGraphMetadata`, `createPageMetadata`, `openGraphTags`, `twitterTags`, `ogAltText`** — the Open Graph and Twitter card vocabulary, as Effect Schemas plus the emitters over them.
- **`attributionFacts(manifest)`** — author, maintainers, repository URL, homepage, SPDX license ids and per-license canonical URLs, and keywords, derived from an `@effected/package-json` `PackageManifest`. Total and synchronous: a manifest carrying none of these yields empty arrays and no optional properties.
- **`packageContext`, `derive`, `deriveScriptBody`** — the schema.org graph. `packageContext` is derived once per package; `derive` assembles a page's `@graph` (a `SoftwareSourceCode`, a `TechArticle` and an `APIReference`, linked by `isPartOf` and `mainEntity`, plus a `Person` per credited human).

## Install

```bash
npm install @tsdoctor/seo
# or
pnpm add @tsdoctor/seo
```

This is an ESM-only package. `effect`, `@effected/package-json`, `@effected/schema-org` and `@effected/spdx` are peer dependencies. It is pure — no filesystem, no network, no native dependencies.

## Quick start

```ts
import { deriveSiteUrl, headTags } from "@tsdoctor/seo";

const siteUrl = deriveSiteUrl("https://docs.example.com", "/");
// "https://docs.example.com"

const tags = headTags({
  siteUrl,
  pageRoute: "/api/class/pipeline",
  description: "Composes transformation steps.",
  publishedTime: "2026-01-15T12:00:00.000Z",
  modifiedTime: "2026-01-17T10:30:00.000Z",
  section: "Classes",
  packageName: "my-library",
});

console.log(tags[0]);
// { tag: "link", attrs: { rel: "canonical", href: "https://docs.example.com/api/class/pipeline" } }
```

Structured data is a separate step because the package-level nodes are worth deriving once and reusing across every page of a package. `manifest` below is the documented package's `package.json` decoded through `@effected/package-json`'s `PackageManifest`, which is what gives attribution typed `Person`, `Repository` and SPDX license values to work from:

```ts
import { attributionFacts, deriveScriptBody, packageContext } from "@tsdoctor/seo";

const pkg = packageContext({
  siteUrl,
  baseRoute: "/api",
  packageName: "my-library",
  version: manifest.version,
  description: manifest.description,
  attribution: attributionFacts(manifest),
});

const body = deriveScriptBody(pkg, {
  pageRoute: "/api/class/pipeline",
  symbolName: "Pipeline",
  description: "Composes transformation steps.",
  section: "Classes",
  publishedTime: "2026-01-15T12:00:00.000Z",
  modifiedTime: "2026-01-17T10:30:00.000Z",
});
// a Result: Success carries the serialized @graph, Failure a StructuredDataError
```

Pass the serialized graph back as `headTags`'s `structuredData` and it becomes the page's JSON-LD `<script>`.

## Two postures worth knowing

**Degrade, never fail.** Nothing here should be able to stop a documentation build. A graph that cannot be assembled fails with a typed `StructuredDataError` rather than throwing, so a caller reports it as a diagnostic and renders the page without that tag. Identity mistakes — a malformed `@id`, a duplicate, a colliding term — all land on that one error channel.

**Absent rather than guessed.** Attribution omits a field it cannot derive instead of inventing one, because every value ends up in markup a crawler reads as authoritative. License URLs come from the SPDX catalog's own per-entry reference URL, never from concatenating an id onto a URL prefix — a `LicenseRef` has no such page and drops out of the array rather than appearing as a fabricated link. `licenseIds` and `licenseUrls` are therefore not index-aligned.

## Provenance

Added in phase 4 of the tsdoctor consolidation. It absorbed the Open Graph resolver and schema definitions that lived in `rspress-plugin-api-extractor`, and the schema.org vocabulary underneath it comes from `@effected/schema-org`, whose offline conformance validator gates this package's fixtures in CI.

## License

[MIT](LICENSE)
