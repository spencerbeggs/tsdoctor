---
"@tsdoctor/seo": minor
---

## Features

`headTags` (and `createPageMetadata`) now emit `og:title`, `og:site_name`
(when a site name is given) and `twitter:title` alongside the existing
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

## Breaking Changes

`SeoPageInput.title` (and `OpenGraphMetadata.title`) is now a **required**
field — every caller must supply the page title used for `og:title` and
`twitter:title`. `siteName` is a new optional field for `og:site_name`. The
`ogAltText` helper is removed; a caller now composes its own fallback alt
text rather than relying on a package-supplied wording. This package is
still on a 0.x line, so the break ships as a minor per semver's pre-1.0
convention.
