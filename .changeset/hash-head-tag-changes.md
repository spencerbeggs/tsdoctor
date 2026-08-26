---
"@tsdoctor/snapshot": patch
---

## Bug Fixes

`hashFrontmatter` now detects changes to `head` tags. It previously dropped the entire `head` array from the hash to keep build timestamps from marking every page modified on every build, which also made an `og:image`, `og:description` or canonical URL change invisible to change detection — the page was never rewritten.

* Timestamp-valued entries are now stripped recursively instead of dropping the whole `head` array, so everything else in `head` participates in the hash
* Timestamps are recognized in both shapes: a `content` value whose sibling `property`/`name` is `article:published_time` / `article:modified_time`, and the `datePublished` / `dateModified` keys inside a JSON-LD script body
* A JSON-LD script body is parsed before its dates are stripped; a body that does not parse is left intact rather than throwing
* The top-level `publishedTime` / `modifiedTime` / `article:published_time` / `article:modified_time` drops are unchanged

The first build after upgrading rewrites every page once, then settles byte-identical.
