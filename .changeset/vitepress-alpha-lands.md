---
"vitepress-plugin-api-extractor": minor
---

## Features

First release. `vitepress-plugin-api-extractor` is a markdown-only VitePress
2.x adapter alpha for generating API documentation from TypeScript API
Extractor models, over the same `@tsdoctor/pages` IR and bundle discovery the
RSPress plugin uses.

Await `apiExtractor()` in `docs/.vitepress/config.mts` and merge its result
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

Generated pages are plain markdown with fenced code blocks — no Vue
components. Signatures, members and examples are type-checked through the
native `@shikijs/vitepress-twoslash` transformer over the same virtual file
system and compiler options the RSPress plugin resolves, with hidden imports
cut via Twoslash's own `// ---cut---` notation. The Twoslash result cache is
shared with the RSPress plugin through one XDG-backed store, so a site built
by either adapter warms the other. Prose cross-links, member anchors, the
sidebar and per-page head tags (canonical, Open Graph, Twitter, JSON-LD) all
carry over from the shared IR.

Out of scope for this alpha: Vue components, code-block cross-links,
llms.txt, multiVersion/i18n/multi-API sites, OG image generation, and
incremental (snapshot-tracked) writes — every file is written on every
build.
