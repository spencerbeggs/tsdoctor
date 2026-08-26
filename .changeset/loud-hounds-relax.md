---
"@tsdoctor/model": minor
---

## Breaking Changes

The `@alpha` `StructuredData` namespace export is removed. It was a stub whose `derive` threw `"not implemented yet"` on every call and had no consumers. Schema.org derivation now lives in the new `@tsdoctor/seo` package's `packageContext` / `derive` / `deriveScriptBody`.
