---
"rspress-plugin-api-extractor": minor
---

## Features

### Full `<head>` metadata on every generated page

Every generated page now carries a complete `<head>` block: a canonical `<link>`, Open Graph tags, matching Twitter card tags, and a `<script type="application/ld+json">` schema.org graph — a `SoftwareSourceCode` node for the package, a `TechArticle` node for the page, an `APIReference` node for the documented symbol, and a `Person` node per author and maintainer, all linked to each other. Derivation is delegated to the new `@tsdoctor/seo` package.

Package-level facts (author, maintainers, repository, homepage, license, keywords) come from the documented package's own `package.json`. A field that cannot be derived is left out rather than guessed, and a metadata problem — a misconfigured image, an unassemblable graph — renders the page without that tag and is reported as a build warning rather than failing the build.

Only two things need configuring: RSPress's `siteOrigin` (for the absolute URL) and `ogImage`.

## Bug Fixes

### Head tags now participate in incremental-build change detection

`og:image`, canonical URL and JSON-LD changes were previously invisible to change detection: head tags were built one pipeline stage after the frontmatter hash was taken, so a change to any of them never triggered a page rewrite. Head-tag construction now happens before hashing, so these changes are detected like any other content change.

The first build after upgrading rewrites every affected page once; subsequent builds settle back to byte-identical output.
