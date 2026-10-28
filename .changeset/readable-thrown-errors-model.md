---
"@tsdoctor/model": patch
---

## Bug Fixes

* Non-`Error` values thrown during model handling now render their message or JSON in error text instead of `[object Object]`. Output for `Error` and string values is unchanged.
