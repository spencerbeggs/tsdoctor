---
"vitepress-plugin-api-extractor": minor
---

## Features

Adds an `ogImage` option to `apiExtractor()`, ranked above the bundle's own
`tsdoctor.json`: a string is either an absolute `http(s)://` URL or a path
relative to the bundle directory, and an object is the manifest image shape
verbatim.

```ts
export default defineConfig({
	async extends() {
		return apiExtractor({
			// ...
			ogImage: "og/my-package.png",
		});
	},
});
```

Every generated page now resolves the bundle manifest's Open Graph image
(when no `ogImage` option overrides it) and emits it alongside `og:title`
and, when the bundle resolves one, `og:site_name`. Bundle-relative images are
published under `docs/public/tsdoctor/<name>/`.
