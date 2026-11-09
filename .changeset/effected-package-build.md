---
"@tsdoctor/bundle": patch
"@tsdoctor/manifest": patch
"@tsdoctor/model": patch
"@tsdoctor/pages": patch
"@tsdoctor/registry": patch
"@tsdoctor/seo": patch
"@tsdoctor/snapshot": patch
"@tsdoctor/vfs": patch
"rspress-plugin-api-extractor": patch
"vitepress-plugin-api-extractor": patch
---

## Build System

* Built with `effected package build` instead of `@savvy-web/bundler` and `@savvy-web/rspress-builder`; the published entry points and file layout are unchanged
* The RSPress runtime still ships one file per source, with `import.meta.env.SSG_MD` left for RSPress to resolve
