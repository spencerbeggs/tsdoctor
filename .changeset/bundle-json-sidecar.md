---
"@tsdoctor/bundle": minor
"@tsdoctor/manifest": minor
"rspress-plugin-api-extractor": minor
"vitepress-plugin-api-extractor": minor
---

## Breaking Changes

### The sidecar manifest is `bundle.json`

A bundle's layer-3 manifest is now read from `bundle.json`, the name the `effected package build` meta pass writes. A `tsdoctor.json` beside a model is no longer read, so the site falls back to the model-derived name and loses the manifest's tagline and Open Graph images.

* Rename each checked-in `tsdoctor.json` to `bundle.json`; the contents are unchanged (spec 1)
* `TSDOCTOR_MANIFEST_FILENAME` is now `BUNDLE_MANIFEST_FILENAME` (`"bundle.json"`) in `@tsdoctor/bundle`

### The manifest schema comes from `@effected/manifest`

`@tsdoctor/bundle` re-exports `BundleManifest`, `decodeBundleManifest`, `encodeBundleManifest`, `ManifestSource` and the rest from the kit package `@effected/manifest`, which is now its peer dependency in place of `@tsdoctor/manifest`. Install `@effected/manifest` alongside `@tsdoctor/bundle`.

`@tsdoctor/manifest` is deprecated and re-exports `@effected/manifest` unchanged. Import from `@effected/manifest`, or from `@tsdoctor/bundle`.
