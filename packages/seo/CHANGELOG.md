# @tsdoctor/seo

## 0.2.0

### Breaking Changes

- `SeoPageInput.title` (and `OpenGraphMetadata.title`) is now a **required**&#10;field — every caller must supply the page title used for `og:title` and&#10;`twitter:title`. `siteName` is a new optional field for `og:site_name`. The&#10;`ogAltText` helper is removed; a caller now composes its own fallback alt
  text rather than relying on a package-supplied wording. This package is
  still on a 0.x line, so the break ships as a minor per semver's pre-1.0
  convention. [#215][#215]

### Features

- `headTags` (and `createPageMetadata`) now emit `og:title`, `og:site_name`&#10;(when a site name is given) and `twitter:title` alongside the existing
  Open Graph and Twitter tags:

```ts
import { headTags } from "@tsdoctor/seo";

const tags = headTags({
	siteUrl,
	pageRoute,
	title: "MyClass",
	siteName: "my-package",
	description,
	publishedTime,
	modifiedTime,
});
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/tsdoctor/pull/215

## 0.1.2

### Maintenance

- Force package bumps

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.1

### Bug Fixes

#### Use catalog:effected for Peer Dependencies

- Switch to strict versioning of peer dependencies via `@effected/pnpm-plugin-effect` to keep disapline of release cycle.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.0

### Features

- First release of `@tsdoctor/seo`: framework-neutral `<head>` metadata for static TypeScript API documentation sites, factored out so a future adapter (VitePress and beyond) can render the same tags an RSPress site does.

#### `Seo.headTags`

- One seam that decides which `<head>` tags a page gets — a canonical link, Open Graph, Twitter card, and a schema.org JSON-LD script — returned as a neutral `HeadTag[]` for an adapter to render into whatever its framework calls a head entry.

#### Canonical URLs

- `deriveSiteUrl`, `canonicalUrl` and `resolveUrl` join a configured site origin with a page route in the documented `siteOrigin + base + routePath` order, falling back to a root-relative URL when no origin is configured.

#### Open Graph and Twitter cards

- `openGraphTags` and `twitterTags` derive the full OG block (title, description, type, URL, article section and timestamps, plus the image when one is configured) and the matching Twitter card tags from the same page facts.

#### Attribution

- `attributionFacts` derives author, maintainers, license and repository facts from a package's `package.json`, decoded through `@effected/package-json`'s `PackageManifest`. A field that cannot be derived is left out rather than guessed — every value here ends up in markup a crawler reads as authoritative.

#### Structured data (JSON-LD)

- `packageContext` plus `derive` / `deriveScriptBody` build a schema.org `@graph` per page: a `SoftwareSourceCode` node for the package, a `TechArticle` node for the page, an `APIReference` node for the documented symbol, and a `Person` node per credited author or maintainer, all linked to each other. Validated offline against `@effected/schema-org`'s conformance checker.

- Every derivation degrades rather than fails: a misconfigured image or an unassemblable graph renders the page without that tag rather than aborting the build.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.0

### Features

- First release of `@tsdoctor/seo`: framework-neutral `<head>` metadata for static TypeScript API documentation sites, factored out so a future adapter (VitePress and beyond) can render the same tags an RSPress site does.

#### `Seo.headTags`

- One seam that decides which `<head>` tags a page gets — a canonical link, Open Graph, Twitter card, and a schema.org JSON-LD script — returned as a neutral `HeadTag[]` for an adapter to render into whatever its framework calls a head entry.

#### Canonical URLs

- `deriveSiteUrl`, `canonicalUrl` and `resolveUrl` join a configured site origin with a page route in the documented `siteOrigin + base + routePath` order, falling back to a root-relative URL when no origin is configured.

#### Open Graph and Twitter cards

- `openGraphTags` and `twitterTags` derive the full OG block (title, description, type, URL, article section and timestamps, plus the image when one is configured) and the matching Twitter card tags from the same page facts.

#### Attribution

- `attributionFacts` derives author, maintainers, license and repository facts from a package's `package.json`, decoded through `@effected/package-json`'s `PackageManifest`. A field that cannot be derived is left out rather than guessed — every value here ends up in markup a crawler reads as authoritative.

#### Structured data (JSON-LD)

- `packageContext` plus `derive` / `deriveScriptBody` build a schema.org `@graph` per page: a `SoftwareSourceCode` node for the package, a `TechArticle` node for the page, an `APIReference` node for the documented symbol, and a `Person` node per credited author or maintainer, all linked to each other. Validated offline against `@effected/schema-org`'s conformance checker.

- Every derivation degrades rather than fails: a misconfigured image or an unassemblable graph renders the page without that tag rather than aborting the build. [#186][#186]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#186]: https://github.com/spencerbeggs/tsdoctor/pull/186
