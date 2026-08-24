---
"@tsdoctor/registry": minor
---

## Breaking Changes

The four `Context.Service` tag identifiers are renamed from `"type-registry-effect/..."` to `"@tsdoctor/registry/..."` (matching the package's new name). This is an observable service-identity change: consumers that reference a tag id string directly (rather than importing the tag itself) need to update it. Consumers of the exported service tags (`TypeRegistry`, `TypeCache`, `PackageFetcher`, …) are unaffected — only the underlying id string changed.
