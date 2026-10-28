---
"@tsdoctor/registry": patch
---

## Bug Fixes

* Export-wildcard substitution now copies the captured subpath literally. Previously a subpath containing `$&`-style tokens was expanded, which resolved the wrong `.d.ts` file.
