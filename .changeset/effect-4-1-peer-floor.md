---
"@tsdoctor/bundle": minor
"@tsdoctor/manifest": minor
"@tsdoctor/model": minor
"@tsdoctor/pages": minor
"@tsdoctor/registry": minor
"@tsdoctor/seo": minor
"@tsdoctor/snapshot": minor
"@tsdoctor/vfs": minor
---

## Breaking Changes

The `effect` peer dependency is now `~4.1.1`, and every `@effected/*` peer moves to its release built on Effect 4.1. Projects still on Effect 4.0 must upgrade to Effect 4.1 before installing this version. The `@effected/*` releases built on Effect 4.0 cannot load under Effect 4.1, so the two lines cannot be mixed.
