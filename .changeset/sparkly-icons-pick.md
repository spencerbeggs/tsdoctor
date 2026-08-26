---
"@tsdoctor/seo": minor
---

## Features

First release of `@tsdoctor/seo`: framework-neutral `<head>` metadata for static TypeScript API documentation sites, factored out so a future adapter (VitePress and beyond) can render the same tags an RSPress site does.

### `Seo.headTags`

One seam that decides which `<head>` tags a page gets — a canonical link, Open Graph, Twitter card, and a schema.org JSON-LD script — returned as a neutral `HeadTag[]` for an adapter to render into whatever its framework calls a head entry.

### Canonical URLs

`deriveSiteUrl`, `canonicalUrl` and `resolveUrl` join a configured site origin with a page route in the documented `siteOrigin + base + routePath` order, falling back to a root-relative URL when no origin is configured.

### Open Graph and Twitter cards

`openGraphTags` and `twitterTags` derive the full OG block (title, description, type, URL, article section and timestamps, plus the image when one is configured) and the matching Twitter card tags from the same page facts.

### Attribution

`attributionFacts` derives author, maintainers, license and repository facts from a package's `package.json`, decoded through `@effected/package-json`'s `PackageManifest`. A field that cannot be derived is left out rather than guessed — every value here ends up in markup a crawler reads as authoritative.

### Structured data (JSON-LD)

`packageContext` plus `derive` / `deriveScriptBody` build a schema.org `@graph` per page: a `SoftwareSourceCode` node for the package, a `TechArticle` node for the page, an `APIReference` node for the documented symbol, and a `Person` node per credited author or maintainer, all linked to each other. Validated offline against `@effected/schema-org`'s conformance checker.

Every derivation degrades rather than fails: a misconfigured image or an unassemblable graph renders the page without that tag rather than aborting the build.