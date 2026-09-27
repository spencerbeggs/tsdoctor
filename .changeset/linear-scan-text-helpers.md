---
"@tsdoctor/model": patch
"@tsdoctor/pages": patch
"@tsdoctor/seo": patch
"rspress-plugin-api-extractor": patch
---

## Bug Fixes

* Replaced regular expressions that could backtrack polynomially on adversarial input with linear scans or non-overlapping patterns: `.d.ts` excerpt and code-fence trimming in `ApiExtractedPackage`, llms.txt link-line and `llms-full.txt` section parsing, `deriveSiteUrl`'s slash trimming, and HTML tag stripping in the `ParametersTable` and `EnumMembersTable` SSG-MD output. Output is unchanged.
