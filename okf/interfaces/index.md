# Interface

* [@tsdoctor/seo headTags seam](seo-headtags.md) - The single seam that decides which head-element tags a generated page gets.
* [RSPress plugin options (PluginOptions)](rspress-plugin-options.md) - The Effect Schema PluginOptions decodes into ResolvedApiConfig; consumer-facing types are the Encoded (optional-field) shapes.
* [Vendored reference repos under .repos/](vendored-reference-repos.md) - Sparse, shallow, read-only git submodules pinned to the installed version of each upstream dependency.
* [rspress-plugin-api-extractor package exports](rspress-package-exports.md) - Three entry points -- ".", "./runtime", "./tsconfig/rspress.json" -- plus the "./env" types-only export.
* [tsdoctor.json manifest](tsdoctor-json-manifest.md) - The spec-1 sidecar manifest schema, its authoring shape, and who writes and reads it.
* [vitepress-plugin-api-extractor: apiExtractor()](vitepress-api-extractor.md) - The one awaited helper a site's docs/.vitepress/config.mts calls to generate pages and merge sidebar/codeTransformers/buildEnd into defineConfig.
