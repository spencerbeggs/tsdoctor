# vitepress-plugin-api-extractor

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
