---
type: Gotcha
status: draft
title: "--conditions=effected-built does not reach a static import in a VitePress config"
description: "The VitePress fixture runs under NODE_OPTIONS=--conditions=effected-built, yet a static import of the adapter in docs/.vitepress/config.mts resolves to src/, because Vite's config bundler rewrites bare imports to absolute paths using its own fixed conditions; a variable-specifier dynamic import is the workaround."
resource: ../../sites/vitepress-basic/docs/.vitepress/config.mts
tags: [dx, compat]
stale_after: 2027-02-07T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
sources:
  - id: site-config
    resource: ../../sites/vitepress-basic/docs/.vitepress/config.mts
  - id: site-pkg
    resource: ../../sites/vitepress-basic/package.json
  - id: vite-config-loader
    resource: npm:vite
integrity:
  generated:
    body: ded059370352f9a7
---

# `--conditions=effected-built` does not reach a static import in a VitePress config

## What you see

`sites/vitepress-basic`'s scripts all run under
`NODE_OPTIONS=--conditions=effected-built`[^site-pkg], and the adapter's
`exports` put an `effected-built` condition first, pointing at
`./dist/prod/npm/pkg/`. Write the ordinary
`import { apiExtractor } from "vitepress-plugin-api-extractor"` at the top
of `docs/.vitepress/config.mts` and the site still loads the adapter from
`src/index.ts`, not from its built output.

## What you will wrongly conclude

That the condition is missing from the environment, that the adapter's
`exports` map is wrong, or that the adapter has not been built. All three
check out fine, and a static import in a plain Node script resolves to
the built file under the same flag.

## What is actually true

Vite loads a config file by bundling it first (`loadConfigFromFile`, the
default bundle loader). Its `externalize-deps` plugin resolves every bare
import itself with `nodeResolveWithVite`, which passes a fixed condition
list (`node`, plus `module-sync` where supported), then rewrites the import
to that absolute file URL and marks it external.[^vite-config-loader] By
the time Node runs the bundled config the specifier is already a path to
`src/index.ts`, so Node's `--conditions` flag has nothing left to resolve.
The RSPress sites do not hit this: their config prepends `effected-built`
to rspack's `resolve.conditionNames` for the site bundle, and Node loads
`rspress.config.ts` itself under the flag.

## What to do

Import the adapter through a specifier held in a variable, which the
config bundler cannot resolve statically and leaves as a runtime
`import()` for Node to resolve with the flag:[^site-config]

```ts
const adapter = "vitepress-plugin-api-extractor";
const { apiExtractor }: typeof import("vitepress-plugin-api-extractor") = await import(adapter);
```

The `typeof import(...)` annotation keeps the type; it is erased before
bundling. Keep any other workspace package a VitePress config imports on
the same pattern. Revisit when Vite's config loader honours Node's
`--conditions` or exposes resolve conditions for the config bundle.

[^site-pkg]: `sites/vitepress-basic/package.json`
[^vite-config-loader]: `npm:vite` (`dist/node/chunks/node.js`, `externalize-deps` and `nodeResolveWithVite`)
[^site-config]: `sites/vitepress-basic/docs/.vitepress/config.mts`
