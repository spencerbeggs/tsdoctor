---
type: Interface
status: stable
kind: api
resource: ../../platforms/vitepress/src/ApiExtractor.ts
title: "vitepress-plugin-api-extractor: apiExtractor()"
description: The one awaited helper a site's docs/.vitepress/config.mts calls to generate pages and merge sidebar/codeTransformers/buildEnd into defineConfig.
tags: [compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: d5964c3f6e633aad4c91b1a92d3caf2aa1d10962613458e85af2b07281b63cce
---

# `apiExtractor(options)`

## The contract

A site's `docs/.vitepress/config.mts` awaits `apiExtractor(options:
ApiExtractorOptions)`[^1] and merges the returned
`ApiExtractorResult` into `defineConfig`:

```ts
const api = await apiExtractor({ dir: "./lib/models/kitchensink" });

export default defineConfig({
  themeConfig: { sidebar: api.sidebar },
  markdown: { codeTransformers: [...api.codeTransformers] },
  buildEnd: async () => { await api.hooks.buildEnd(); },
});
```

`ApiExtractorResult` is `{ sidebar, codeTransformers, hooks: { buildEnd },
generated }`[^1]: `sidebar` is the `themeConfig.sidebar` entry for the API,
`codeTransformers` is a one-element array (the Twoslash transformer) for
`markdown.codeTransformers`, `hooks.buildEnd` persists the Twoslash result
cache and disposes the runtime, and `generated` is the raw `GenerateResult`
for anything a site wants to inspect (route count, external types loaded,
uncategorized item names).

Generation runs at config-load time, inside the `await`, because VitePress
has no pre-route-scan hook comparable to RSPress's `config()`. **Every file
under `docsDir` is rewritten on every build** — there is no snapshot
tracking on this adapter. **A route collision throws** rather than degrading.
**`buildEnd` never fires under `vitepress dev`** — see
[../gotchas/vitepress-buildend-never-fires-in-dev.md](../gotchas/vitepress-buildend-never-fires-in-dev.md) —
so a dev session never persists the Twoslash cache.

## `ApiExtractorOptions`

| Field | Type | Default |
| --- | --- | --- |
| `dir` | `string` | required — the bundle folder |
| `cwd` | `string \| undefined` | `process.cwd()` |
| `docsDir` | `string \| undefined` | `"docs"` |
| `baseRoute` | `string \| undefined` | `"/api"` |
| `name` | `string \| undefined` | — |
| `siteOrigin` | `string \| undefined` | — |
| `base` | `string \| undefined` | — |
| `categories` | `Record<string, Partial<CategoryConfig>> \| undefined` | merged over `DEFAULT_CATEGORIES` |
| `externalPackages` | `ReadonlyArray<ExternalPackage> \| undefined` | the manifest's dependencies |
| `suppressExampleErrors` | `boolean \| undefined` | `true` |
| `source` | `{ url, ref? } \| undefined` | — |
| `ogImage` | `string \| OpenGraphImage \| undefined` | — |
| `log` | `boolean \| undefined` | `true` |

`ogImage`'s string form is resolved two ways[^1]: an absolute `http(s)://`
URL becomes `{ url }`; any other string is treated as a path relative to the
bundle directory and becomes `{ path }`. An object is passed through
verbatim as the manifest's Open Graph image shape (`path` XOR `url`, plus
`type`/`width`/`height`/`alt`). This option is the platform tier and
outranks the bundle's own `tsdoctor.json` Open Graph block — see
[../decisions/vitepress-markdown-only-alpha.md](../decisions/vitepress-markdown-only-alpha.md)
for how it composes with the rest of the alpha's scope.

## `vitepress` is a peer

`vitepress` is declared as a `peerDependency`, not a direct dependency —
consistent with the adapter shipping no Vue components at all. The site's
own theme file is responsible for registering
`@shikijs/vitepress-twoslash`'s client plugin and stylesheet; `codeTransformers`
alone does not wire the hover-popup UI.

[^1]: [platforms/vitepress/src/ApiExtractor.ts](../../platforms/vitepress/src/ApiExtractor.ts)
