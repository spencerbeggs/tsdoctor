---
type: Module
kind: package
title: vitepress-plugin-api-extractor
description: The VitePress adapter over the @tsdoctor/* core — markdown-only alpha proving the core/adapter boundary with a second consumer of the @tsdoctor/pages IR.
resource: ../../platforms/vitepress
layer: L3
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T14:07:05Z
  body_sha256: a4f6c4dfebd40853198a8fc1b70b3907c54fa7978d09e960ba2a2185be952084
tags:
  - architecture
  - dx
---

# vitepress-plugin-api-extractor

## Boundary and purpose

`vitepress-plugin-api-extractor` (`platforms/vitepress/`) is the second
consumer of the `@tsdoctor/pages` IR and the adapter that tests whether the
core/adapter boundary drawn for the RSPress plugin is actually correct, not
merely convenient for the first consumer. It targets VitePress 2.x and is
markdown-only: no Vue components. Signatures, members and examples are
fenced code blocks type-checked by the native `@shikijs/vitepress-twoslash`
transformer; tables are markdown tables. The package name mirrors
`rspress-plugin-api-extractor` for consistency across `platforms/*`
workspaces, even though the folder is `platforms/vitepress/` — `pnpm
--filter` matches the package name, not the folder.

## Dependencies

- `@tsdoctor/bundle`, `@tsdoctor/manifest`, `@tsdoctor/model`,
  `@tsdoctor/pages`, `@tsdoctor/registry`, `@tsdoctor/seo`, `@tsdoctor/vfs`
  (dependencies, `workspace:*`)
- `@effect/platform-node`, `@effected/markdown`, `@effected/package-json`,
  `@effected/store`, `@effected/tsconfig-json`, `@effected/xdg`
  (dependencies, `catalog:effected`)
- `@shikijs/twoslash`, `@shikijs/vitepress-twoslash` (dependencies)
- `effect` (dependency, `catalog:effect`)
- `vitepress` (peer, `^2.0.0-alpha.19`)

No `@tsdoctor/snapshot` dependency — this adapter does not track snapshots;
every file is written on every build.

## Public surface

One public helper: `apiExtractor(options)` in `src/ApiExtractor.ts`, awaited
from a site's `docs/.vitepress/config.mts`. It returns `{ sidebar,
codeTransformers, hooks: { buildEnd }, generated }` for the site to merge
into `defineConfig`. `ApiExtractorOptions.ogImage?: string | OpenGraphImage`
is the package's platform tier for Open Graph resolution.

Other modules under `src/`:

- `src/Generate.ts` — the Effect program from bundle load to written files
- `src/Registry.ts` — the registry stack over the shared `"tsdoctor"` XDG
  namespace, degrading external type loading
- `src/Twoslash.ts` — `transformerTwoslash` from `@shikijs/vitepress-twoslash`
  over the combined VFS
- `src/TwoslashCache.ts` — `TwoslashCacheStore`, persistence for
  `@tsdoctor/vfs`'s cache generations over `@effected/store`'s
  `Cache.degrading`
- `src/Categories.ts` — `DEFAULT_CATEGORIES`, mirroring the RSPress defaults
- `src/emit/markdown.ts`, `src/emit/frontmatter.ts`, `src/emit/sidebar.ts` —
  the three emitters

See the full contract at
[vitepress-api-extractor](../interfaces/vitepress-api-extractor.md).

## Mechanisms

### Generation at config load

VitePress has no pre-scan hook comparable to RSPress's `config()`; its
config file is ESM and can top-level await, and `buildEnd` / `postRender`
run after the fact. A site's `docs/.vitepress/config.mts` therefore awaits
`apiExtractor()`, which generates every page under `docs/` before
`defineConfig` is evaluated. `buildEnd` persists the Twoslash result cache
and disposes the runtime; under `vitepress dev` it never fires, so a dev
session never saves the cache.

`src/Generate.ts` runs `loadBundle` → `Model.load` →
`ApiExtractedPackage.toVfs` plus import prepending → external types through
`@tsdoctor/registry` → `resolveTypeScriptConfig` → `prepareWorkItems`
(`@tsdoctor/pages`) → `resolveBundleFrom` + `publishBundleAssets` →
`buildPage` → emit → write. Every file is written on every build; there is
no snapshot tracking. A route collision dies with a message naming the
colliding items; uncategorized items are reported on the result.

This re-spells the neutral half of RSPress's `ConfigService` — import
prepending, dependency extraction, tsconfig resolution, manifest decode to
`packageContext` — a recorded duplication the package accepts at the alpha
stage rather than extracting prematurely to a third consumer that does not
yet exist.

### Resolving Open Graph images

`ApiExtractorOptions.ogImage?: string | OpenGraphImage` is the platform
tier, ranked above the bundle's own `tsdoctor.json`, mapped the same way
RSPress's legacy `ogImage` option is: an absolute `http(s)://` string
becomes a `{ url }` image, any other string a `{ path }` relative to the
bundle directory, an object passes through as the manifest image shape
verbatim. `Generate.ts` calls `resolveBundleFrom(bundle, platform)`, derives
`siteName` as `resolvedBundle.project?.value.name ?? resolvedBundle.name.value`,
and, when the resolved bundle carries an `openGraph` block, publishes its
images via `publishBundleAssets` into
`<docsDir>/public/tsdoctor/<unscopedName>/`. A publish failure degrades to
no image — `Effect.orElseSucceed` swallows it, because this adapter has no
event bus to carry a warning on, a recorded limitation rather than a design
choice. Every page then emits `og:image` (when one resolved), `og:title`
(the item's display name), and `og:site_name` (the resolved `siteName`).

### The markdown emitter

`src/emit/markdown.ts` serializes the page as one mdast tree — there is no
JSX to trigger `@effected/markdown`'s presence-keyed escaping — and nothing
post-processes the kit's bytes:

- **Type-checked blocks** are fences with the `twoslash` meta carrying the
  block's `source`; `// ---cut---` is native Twoslash notation, so the
  pre-cut imports are type-checked, offsets are re-fitted, and the reader
  sees the display code. No hide transformer is needed, unlike RSPress.
- **Declaration fences** (signatures, members, base classes) get `//
  @noErrors` prepended. A declaration excerpt is not a program — its type
  parameters and sibling types are out of scope — so without the directive
  Twoslash annotated nearly every such line with "Cannot find name". The
  block keeps its hovers and drops the diagnostics. Examples are untouched;
  the builder decides their `@noErrors` through `suppressExampleErrors`.
  This is strictly more type information than RSPress provides, since RSPress
  never type-checks declaration blocks at all.
- **Tables** are `@effected/markdown`'s GFM `Table` nodes from the typed
  rows. Member headings carry custom anchors (`### name {#id}`) from the
  anchor the IR carries — nothing recomputes anchors.

### Twoslash wiring

`src/Twoslash.ts` supplies the combined VFS as `twoslashOptions.extraFiles`
— not `fsMap`, because Twoslash treats a supplied `fsMap` as the entire file
system and switches off the local `node_modules` overlay, dropping every
`lib.*.d.ts` and type-checking against nothing. `extraFiles` is overlaid on
the compiler's own libs. See
[twoslash-fsmap-drops-libs](../gotchas/twoslash-fsmap-drops-libs.md).

The compiler options come from `@tsdoctor/vfs`'s `toProgrammaticCompilerOptions`
— the same inputs and normalization the RSPress transformer uses. The
transformer takes a `typesCache` implemented by `@tsdoctor/vfs`'s
`makeTwoslashCache`, so both adapters share one XDG store and one keying
scheme (`~/.cache/tsdoctor/twoslash.sqlite`) — a site built by either adapter
warms the other's cache. `throws: false` and `noErrorValidation` make a
diagnostic render as an annotation rather than fail the build.

### Head tags and the sidebar

`src/emit/frontmatter.ts` renders `@tsdoctor/seo`'s `HeadTag[]` into
VitePress `HeadConfig`: a `meta` / `link` tag becomes a `[tag, attrs]` pair
and the JSON-LD `script` becomes the `[tag, attrs, innerHTML]` triple.
RSPress spells that body as a `children` attribute instead, which is why
frontmatter assembly stays adapter-side in both packages rather than in
`@tsdoctor/pages`. `src/emit/sidebar.ts` renders the nav tree to one
`themeConfig.sidebar` entry keyed by the API's base route.

### Alpha scope

Deliberately excluded, each a design question with an obvious home rather
than a gap in the architecture: Vue components; code-block cross-links
(`ShikiCrossLinker` is a HAST walk coupled to RSPress's Twoslash output, so a
port is a rewrite — prose links and working anchors satisfy the gate);
llms.txt (`@tsdoctor/pages`'s `Llms.ts` is ready, but VitePress has no
first-party post-processor to hook); multiVersion, i18n and multi-API sites;
snapshot-tracked incremental writes; the `serve` runner. OG image resolution
is not excluded — `ogImage` and the bundle-manifest path cover it, with
silent-degrade publish failures the one recorded gap against RSPress's
warning path. No CI workflow builds any fixture site; the fixture
participates in CI only through `typecheck`, like the RSPress sites. See
[vitepress-alpha-scope](../limitations/vitepress-alpha-scope.md).

### Recorded duplication

Building the second consumer measured the next tier of neutral logic the
adapter re-spells, each labelled in the source: `Generate.ts` re-spells the
neutral half of RSPress's `layers/config-resolution.ts`; `Categories.ts`
duplicates `DEFAULT_CATEGORIES` and the override merge, and the two must
stay in step or the adapters generate different routes from one bundle;
`Registry.ts` duplicates the registry-stack composition and the
`"tsdoctor"` namespace literal. Destinations are open.

## Invariants

- `apiExtractor()` must be awaited before `defineConfig` evaluates — there
  is no other point in VitePress's config lifecycle where async generation
  can run before routing.
- The Twoslash environment must receive the VFS through `extraFiles`, never
  `fsMap` — the latter replaces the compiler's entire file system.
- The Twoslash result cache key scheme and XDG namespace must match
  RSPress's exactly, or the two adapters stop warming each other's cache.
- `buildEnd` must not be relied on to persist the cache under `vitepress
  dev` — it never fires there.
- `DEFAULT_CATEGORIES` in `src/Categories.ts` must track RSPress's category
  defaults, or the same bundle generates different routes from each adapter.

## Links

- [vitepress-markdown-only-alpha](../decisions/vitepress-markdown-only-alpha.md)
- [vitepress-alpha-gates-1-0](../decisions/vitepress-alpha-gates-1-0.md)
- [vitepress-api-extractor](../interfaces/vitepress-api-extractor.md)
- [vitepress-alpha-scope](../limitations/vitepress-alpha-scope.md)
- [twoslash-fsmap-drops-libs](../gotchas/twoslash-fsmap-drops-libs.md)
- [vitepress-buildend-never-fires-in-dev](../gotchas/vitepress-buildend-never-fires-in-dev.md)
- [persisted-twoslash-result-cache](../decisions/persisted-twoslash-result-cache.md)
- [core-adapter-boundary](../decisions/core-adapter-boundary.md)
