---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-09-03
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 88
related:
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
  - rspress-plugin-api-extractor/rspress-mdx-emitter.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/render-phase-instrumentation.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
---

# VitePress adapter

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Generation at config load](#generation-at-config-load)
- [Resolving Open Graph images](#resolving-open-graph-images)
- [The markdown emitter](#the-markdown-emitter)
- [Twoslash wiring](#twoslash-wiring)
- [Head tags and the sidebar](#head-tags-and-the-sidebar)
- [Alpha scope](#alpha-scope)
- [Recorded duplication](#recorded-duplication)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

`vitepress-plugin-api-extractor` (`platforms/vitepress/`) is the second consumer of `@tsdoctor/pages` and the proof that the core/adapter boundary is drawn correctly. It targets VitePress 2.x (vendored at `.repos/vitepress`) and is markdown-only: no Vue components. Signatures, members and examples are fenced code blocks type-checked by the native `@shikijs/vitepress-twoslash` transformer; tables are markdown tables. The package is named for symmetry with `rspress-plugin-api-extractor` — one naming rule for every `platforms/*` workspace — and `pnpm --filter` matches that name, not the folder.

## Current state

| Module | Contents |
| --- | --- |
| `src/ApiExtractor.ts` | `apiExtractor(options)`, the one public helper; `ogImage?: string \| OpenGraphImage` is its platform-tier option |
| `src/Generate.ts` | The Effect program from bundle load to written files |
| `src/Registry.ts` | The registry stack over the shared `"tsdoctor"` XDG namespace, degrading external type loading |
| `src/Twoslash.ts` | `transformerTwoslash` from `@shikijs/vitepress-twoslash` over the combined VFS |
| `src/TwoslashCache.ts` | `TwoslashCacheStore`, persistence for `@tsdoctor/vfs`'s cache generations over `@effected/store`'s `Cache.degrading` |
| `src/Categories.ts` | `DEFAULT_CATEGORIES`, mirroring the RSPress defaults |
| `src/emit/markdown.ts`, `emit/frontmatter.ts`, `emit/sidebar.ts` | The emitters |

The package is built with `@savvy-web/bundler`'s `build()` (the RSPress builder is RSPress-specific); `vitepress` is a peer. `sites/vitepress-basic` is the fixture, consuming the same `modules/kitchensink` model folder `sites/basic` does, with `siteOrigin` set so the canonical, Open Graph and JSON-LD path is exercised end to end. Its theme file registers `@shikijs/vitepress-twoslash`'s client plugin and stylesheet — the transformer's own documented setup, not a component the adapter authors. See `platforms/vitepress/CLAUDE.md` for the package's invariants.

## Generation at config load

VitePress has no pre-scan hook comparable to RSPress's `config()`; its config file is ESM and can top-level await, and `buildEnd` / `postRender` run after the fact. So a site's `docs/.vitepress/config.mts` awaits `apiExtractor()`, which generates every page under `docs/` and returns `{ sidebar, codeTransformers, hooks: { buildEnd }, generated }` to merge into `defineConfig`. `buildEnd` persists the Twoslash result cache and disposes the runtime; under `vitepress dev` it never fires, so a dev session does not save the cache.

`Generate.ts` runs `loadBundle` → `Model.load` → `ApiExtractedPackage.toVfs` plus import prepending → external types through `@tsdoctor/registry` → `resolveTypeScriptConfig` → `prepareWorkItems` → `resolveBundleFrom` + `publishBundleAssets` → `buildPage` → emit → write. Every file is written on every build; there is no snapshot tracking. A route collision dies with a message naming the colliding items; uncategorized items are reported on the result (`multi-entry-resolution.md`).

## Resolving Open Graph images

`ApiExtractorOptions.ogImage?: string | OpenGraphImage` is the platform tier — ranked above the bundle's own `tsdoctor.json` — mapped the same way as RSPress's legacy `ogImage` option: an absolute `http(s)://` string becomes a `{ url }` image, any other string a `{ path }` relative to the bundle directory, an object passes through as the manifest image shape verbatim. `Generate.ts` calls `resolveBundleFrom(bundle, platform)`, derives `siteName` as `resolvedBundle.project?.value.name ?? resolvedBundle.name.value` and, when the resolved bundle carries an `openGraph` block, publishes its images via `publishBundleAssets` into `<docsDir>/public/tsdoctor/<unscopedName>/`. A publish failure degrades to no image — `Effect.orElseSucceed` swallows it — because this adapter has no event bus to carry a warning on, a recorded limitation rather than a design choice. Every page then emits `og:image` (when one resolved), `og:title` (the item's display name) and `og:site_name` (the resolved `siteName`) alongside the rest of the head block (`structured-data-and-og.md`).

## The markdown emitter

`emit/markdown.ts` serializes the page as one mdast tree — there is no JSX to trigger the kit's presence-keyed escaping — and nothing post-processes the kit's bytes:

- Type-checked blocks are fences with the `twoslash` meta carrying the block's `source`; `// ---cut---` is native Twoslash notation, so the pre-cut imports are type-checked, offsets are re-fitted and the reader sees the display code. No hide transformer is needed. A block that is not type-checked carries `display` in a plain fence.
- Declaration fences (signatures, members, base classes) get `// @noErrors` prepended. A declaration excerpt is not a program — its type parameters and the sibling types it names are out of scope — so without the directive Twoslash annotated nearly every such line with "Cannot find name". The block keeps its hovers and drops the diagnostics. Examples are untouched; the builder decides their `@noErrors` through `suppressExampleErrors`. RSPress never type-checks declaration blocks at all, so this is strictly more type information.
- Tables are the kit's GFM `Table` nodes from the typed rows. Member headings carry custom anchors (`### name {#id}`) from the anchor the IR carries.

## Twoslash wiring

`Twoslash.ts` supplies the combined VFS as `twoslashOptions.extraFiles` plus the compiler options from `@tsdoctor/vfs`'s seam through `toProgrammaticCompilerOptions` — the same inputs and normalization the RSPress transformer uses (`type-loading-vfs.md`). Not `fsMap`: Twoslash treats a supplied `fsMap` as the entire file system and switches off the local `node_modules` overlay, so handing it the VFS alone drops every `lib.*.d.ts` and type-checks against nothing. `extraFiles` is overlaid on the compiler's own libs.

The transformer takes a `typesCache` implemented by `@tsdoctor/vfs`'s `makeTwoslashCache`, so both adapters share one XDG store and one keying scheme — a site built by either adapter warms the other (`render-phase-instrumentation.md`). `throws: false` and `noErrorValidation` make a diagnostic render as an annotation rather than fail the build. The transformer is registered through `markdown.codeTransformers`; VitePress's `explicitTrigger` defaults to true, so only fences marked `twoslash` are affected.

## Head tags and the sidebar

`emit/frontmatter.ts` renders `@tsdoctor/seo`'s `HeadTag[]` into VitePress `HeadConfig`: a `meta` / `link` tag becomes a `[tag, attrs]` pair and the JSON-LD `script` becomes the `[tag, attrs, innerHTML]` triple. RSPress spells that body as a `children` attribute, which is why frontmatter assembly stays adapter-side. `emit/sidebar.ts` renders the nav tree to one `themeConfig.sidebar` entry keyed by the API's base route.

## Alpha scope

Deliberately excluded, each a design question with an obvious home rather than a gap in the architecture: Vue components; code-block cross-links (`ShikiCrossLinker` is a HAST walk coupled to RSPress's Twoslash output, so a port is a rewrite — prose links and working anchors satisfy the gate); llms.txt (`@tsdoctor/pages`'s `Llms.ts` is ready, but VitePress has no first-party post-processor to hook); multiVersion, i18n and multi-API sites; snapshot-tracked incremental writes; the `serve` runner. OG image resolution is no longer excluded — `ogImage` and the bundle-manifest path above cover it, with silent-degrade publish failures the one recorded gap against RSPress's warning path. No CI workflow builds any fixture site — the root `ci:build` filters `!@sites/*` — so the fixture participates in CI only through `typecheck`, like the RSPress sites.

## Recorded duplication

Building the second consumer measured the next tier of neutral logic the adapter re-spells, each labelled in the source: `Generate.ts` re-spells the neutral half of RSPress's `layers/config-resolution.ts` (import prepending, dependency extraction, tsconfig resolution, manifest decode to `packageContext`); `Categories.ts` duplicates `DEFAULT_CATEGORIES` and the override merge, and the two must stay in step or the adapters generate different routes from one bundle; `Registry.ts` duplicates the registry-stack composition and the `"tsdoctor"` namespace literal. Destinations are open; `tsdoctor-package-architecture.md` keeps the list.

## Rationale

- **Why markdown-only:** Vue components would be a second component layer to design before the seams are proven, and the seams are what the alpha is for. Native `@shikijs/vitepress-twoslash` gives hovers and type errors on plain fences for free.
- **Why generation runs at config load:** it is the only point before routing where an ESM config can await work, and the alternative (a CLI pre-step) stays unscheduled.
- **Why `extraFiles` and not `fsMap`:** "the same VFS and compiler options" as RSPress means the same overlay on the compiler's libs, not a replacement file system.

## Related documentation

- **The IR this adapter spends:** `doc-ir-and-pages.md`
- **The RSPress emitter:** `rspress-mdx-emitter.md`
- **The VFS and compiler-option seam both adapters share:** `type-loading-vfs.md`
- **The Twoslash result cache:** `render-phase-instrumentation.md`
- **The `HeadTag[]` seam and the bundle-resolved OG title/site name:** `structured-data-and-og.md`
- **`loadBundle`, `resolveBundleFrom` and `publishBundleAssets`:** `bundle-spec.md`
- **Core-move candidates:** `tsdoctor-package-architecture.md`
