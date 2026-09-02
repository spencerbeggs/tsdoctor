---
"@tsdoctor/snapshot": patch
"rspress-plugin-api-extractor": patch
---

## Refactoring

Two capabilities this repository hand-rolled turn out to already exist in the kit, so both are adopted and the local implementations deleted.

`parseFrontmatter` now splits fences with `@effected/markdown`'s `FrontmatterSource.split` instead of a hand-rolled scanner emulating gray-matter's `indexOf` quirks. That emulation existed only to keep digests captured under gray-matter stable, which stopped mattering once this repository became the only consumer of those digests. The kit's grammar is strict — a fence line is exactly `---`, an unterminated block is not frontmatter — and every input where the two differ is malformed, which the emitters cannot produce because they go through `FrontmatterSource.join`. The four boundary tests are re-pinned to the strict grammar rather than deleted.

`hashFrontmatter` now canonicalizes through `@effected/jsonc`'s `JsoncFingerprint` (RFC 8785/JCS), the same spelling `@tsdoctor/bundle` already fingerprints through, rather than `JSON.stringify` plus a hand-rolled recursive key sort. `JSON.stringify` is not a canonical form: it drops `undefined`, turns `NaN` into `null`, and its number and string escaping are not JCS's, so a value it silently altered would have been hashed as something the document did not say. Such a value now fails loudly.

**Digests are unchanged.** The characterization tests pinning literal digests from before the swap still pass, and a no-change rebuild of the `basic` fixture site reports all 46 files unchanged.
