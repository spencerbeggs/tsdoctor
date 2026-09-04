# vitepress-plugin-api-extractor

## 0.2.0

### Features

- Adds an `ogImage` option to `apiExtractor()`, ranked above the bundle's own&#10;`tsdoctor.json`: a string is either an absolute `http(s)://` URL or a path
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

- Every generated page now resolves the bundle manifest's Open Graph image
  (when no `ogImage` option overrides it) and emits it alongside `og:title`&#10;and, when the bundle resolves one, `og:site_name`. Bundle-relative images are
  published under `docs/public/tsdoctor/<name>/`. [#215][#215]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/bundle | dependency | updated | 0.2.4 | 0.3.0 |
| @tsdoctor/pages | dependency | updated | 0.1.1 | 0.1.2 |
| @tsdoctor/seo | dependency | updated | 0.1.2 | 0.2.0 |

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#215]: https://github.com/spencerbeggs/tsdoctor/pull/215

## 0.1.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/bundle | dependency | updated | 0.2.3 | 0.2.4 |

## 0.1.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/bundle | dependency | updated | 0.2.2 | 0.2.3 |
| @tsdoctor/model | dependency | updated | 0.6.0 | 0.6.1 |
| @tsdoctor/pages | dependency | updated | 0.1.0 | 0.1.1 |
| @tsdoctor/registry | dependency | updated | 0.3.1 | 0.3.2 |
| @tsdoctor/seo | dependency | updated | 0.1.1 | 0.1.2 |
| @tsdoctor/vfs | dependency | updated | 0.2.0 | 0.2.1 |

### Maintenance

- Force package bumps

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.0

### Features

- First release. `vitepress-plugin-api-extractor` is a markdown-only VitePress
  2\.x adapter alpha for generating API documentation from TypeScript API
  Extractor models, over the same `@tsdoctor/pages` IR and bundle discovery the
  RSPress plugin uses.

- Await `apiExtractor()` in `docs/.vitepress/config.mts` and merge its result
  into your VitePress config:

```ts
// docs/.vitepress/config.mts
import { defineConfig } from "vitepress";
import { apiExtractor } from "vitepress-plugin-api-extractor";

const { sidebar, codeTransformers, hooks } = await apiExtractor({
  dir: "./lib/models/my-package",
});

export default defineConfig({
  markdown: { codeTransformers },
  themeConfig: { sidebar },
  buildEnd: hooks.buildEnd,
});
```

- Generated pages are plain markdown with fenced code blocks — no Vue
  components. Signatures, members and examples are type-checked through the
  native `@shikijs/vitepress-twoslash` transformer over the same virtual file
  system and compiler options the RSPress plugin resolves, with hidden imports
  cut via Twoslash's own `// ---cut---` notation. The Twoslash result cache is
  shared with the RSPress plugin through one XDG-backed store, so a site built
  by either adapter warms the other. Prose cross-links, member anchors, the
  sidebar and per-page head tags (canonical, Open Graph, Twitter, JSON-LD) all
  carry over from the shared IR.

- Out of scope for this alpha: Vue components, code-block cross-links,
  llms.txt, multiVersion/i18n/multi-API sites, OG image generation, and
  incremental (snapshot-tracked) writes — every file is written on every
  build. [#208][#208]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effect/platform-node | dependency | added | — | 4.0.0-rc.109 |
| @effected/markdown | dependency | added | — | ^0.8.0 |
| @effected/package-json | dependency | added | — | ^0.13.0 |
| @effected/store | dependency | added | — | ^0.6.0 |
| @effected/tsconfig-json | dependency | added | — | ^0.7.0 |
| @effected/xdg | dependency | added | — | ^0.3.0 |
| @microsoft/api-extractor-model | dependency | added | — | ^7.33.11 |
| @shikijs/twoslash | dependency | added | — | ^4.4.3 |
| @shikijs/vitepress-twoslash | dependency | added | — | ^4.4.3 |
| @tsdoctor/bundle | dependency | added | — | 0.2.2 |
| @tsdoctor/model | dependency | added | — | 0.6.0 |
| @tsdoctor/pages | dependency | added | — | 0.1.0 |
| @tsdoctor/registry | dependency | added | — | 0.3.1 |
| @tsdoctor/seo | dependency | added | — | 0.1.1 |
| @tsdoctor/vfs | dependency | added | — | 0.2.0 |
| effect | dependency | added | — | 4.0.0-rc.109 |
| shiki | dependency | added | — | ^4.4.3 |
| typescript | dependency | added | — | ^6.0.3 |
| vitepress | peerDependency | added | — | ^2.0.0-alpha.19 |

[#208][#208]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#208]: https://github.com/spencerbeggs/tsdoctor/pull/208
