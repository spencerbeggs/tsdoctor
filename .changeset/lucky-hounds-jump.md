---
"rspress-plugin-api-extractor": minor
---

## Features

Config resolution now loads and resolves each documented API's
`tsdoctor.json` bundle, pinned to the API's already-known model file, and
publishes its manifest-declared Open Graph images into the site's public
directory, ranked below the plugin's own legacy `ogImage` option. Every
generated page now emits `og:title` and, when the bundle resolves a site
name, `og:site_name` alongside the existing Open Graph and Twitter tags. A
malformed `tsdoctor.json` fails the build the same way a malformed tsconfig
does; every other bundle-discovery or layer-read problem (an unrelated
second `*.api.json` in the model folder, a malformed `package.json`) and an
asset-publish failure both degrade to a warning, and the page renders
without a bundle-supplied `og:image`.

Dropping the plugin's `ogAltText` inference in favor of `@tsdoctor/seo`'s
single alt chain also changes every page's `og:image:alt`, from
`"<Item> - <package> API Documentation"` to `"<Item> API documentation"` —
different wording, and the package name no longer appears. Combined with
the new `og:title`/`og:site_name` tags, this rewrites the frontmatter `head`
block of every generated page once on the first rebuild after upgrading; a
subsequent rebuild with no other changes reports every page unchanged.
