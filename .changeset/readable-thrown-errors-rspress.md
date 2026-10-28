---
"rspress-plugin-api-extractor": patch
---

## Bug Fixes

* Non-`Error` values thrown during a build now render their message or JSON in build errors and `issues.json` reasons instead of `[object Object]`.

## Other

* The first build after upgrading is slower than usual: the persisted Twoslash cache format changed, so existing caches are rebuilt once.
