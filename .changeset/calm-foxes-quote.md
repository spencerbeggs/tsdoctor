---
"rspress-plugin-api-extractor": patch
---

## Bug Fixes

* Emitted frontmatter now quotes only the scalars a YAML 1.1 resolver would coerce (timestamps, `yes`/`no`/`on`/`off`, legacy octal and sexagesimal numbers) via `@effected/yaml`'s `quoteCompat: "yaml-1.1"`, instead of double-quoting every string value. Decoded data is identical across YAML 1.1 and 1.2 parsers, frontmatter hashes are unchanged, and unchanged pages are not rewritten; freshly written pages simply carry fewer gratuitous quotes.
* Frontmatter emission is assembled with `@effected/markdown`'s `FrontmatterSource.join` (byte-identical output); the parse path deliberately keeps its gray-matter-parity split, whose pinned `indexOf` quirks the kit's strict fence grammar rejects by design.
