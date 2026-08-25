---
"@tsdoctor/model": patch
---

## Bug Fixes

* Prose parsing in `Render` now uses `@effected/markdown`'s phrasing-level `Markdown.parsePhrasingResult` instead of a full document parse and paragraph splice — identical output for the whitespace-normalized single-line prose TSDoc extraction produces, without the per-fragment `Root` construction.
