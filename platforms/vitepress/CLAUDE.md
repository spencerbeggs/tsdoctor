# platforms/vitepress/CLAUDE.md

`vitepress-plugin-api-extractor` (publishable, versioned via changesets) — the
VitePress adapter over the `@tsdoctor/*` core, and the second live consumer of
the `@tsdoctor/pages` IR that proves the core/adapter boundary (phase 5 alpha).
Markdown-only: no Vue components. Design contract in
`.claude/design/rspress-plugin-api-extractor/doc-ir-and-pages.md`.

## Key Facts

- **One public helper, awaited at config load.** `apiExtractor(options)` in
  `src/ApiExtractor.ts` discovers the bundle, generates every page under the
  site's `docs/`, opens the Twoslash result cache and returns
  `{ sidebar, codeTransformers, hooks: { buildEnd }, generated }` for the site's
  `.vitepress/config.mts` to merge into `defineConfig`. VitePress has no
  pre-scan hook comparable to RSPress's `config()`, which is why generation
  runs at config-load time. `buildEnd` persists the cache and disposes the
  runtime — under `vitepress dev` it never fires, so the cache is not saved.
- **Generation is `src/Generate.ts`**, an Effect program over `FileSystem`,
  `Path` and the registry: `discoverBundle` → `Model.load` →
  `ApiExtractedPackage.toVfs` + import prepending → external types via
  `@tsdoctor/registry` (`src/Registry.ts`, degrading; `externalPackagesOf`
  reads them from the bundle's `package.json`) → `resolveTypeScriptConfig` →
  `prepareWorkItems` (`@tsdoctor/pages`; collisions die, uncategorized names
  are reported) → `buildPage` → `emitMarkdownBody` → write. This re-spells the neutral half of the RSPress `ConfigService`
  (recorded Tier 2 duplication); it emits no events and no snapshot tracking —
  every file is written on every build.
- **The emitter is `src/emit/markdown.ts`.** Signatures, members, base
  classes and type-checked examples are `ts twoslash` fences carrying the
  block's `source` (Twoslash's own `// ---cut---` hides the prepended imports;
  no hide transformer); non-type-checked examples carry `display` in a plain
  fence; declaration excerpts get `// @noErrors` prepended. Tables are the
  kit's GFM `Table` nodes; members get `### name {#anchor}` from the anchor
  the IR carries — nothing recomputes anchors. Nothing post-processes the
  kit's bytes: `@effected/markdown` 0.8.0 serializes the `{#id}` suffix and
  intraword `_` raw on a non-MDX tree (no shim is kept).
- **Frontmatter is adapter-side** (`src/emit/frontmatter.ts`): `head` is
  VitePress `HeadConfig` — `[tag, attrs]` pairs and the `[tag, attrs, innerHTML]`
  TRIPLE for the JSON-LD script (RSPress spells that body as a `children`
  attribute, which is why assembly is not shared).
- **Sidebar is IR output** (`src/emit/sidebar.ts`): `sidebarFor(navTree)`
  keys one `themeConfig.sidebar` entry by `${baseRoute}/`.
- **Twoslash** (`src/Twoslash.ts`): `transformerTwoslash` from
  `@shikijs/vitepress-twoslash` with the combined VFS as `extraFiles` (NOT
  `fsMap` — a supplied `fsMap` is the whole file system and drops every
  `lib.*.d.ts`), compiler options through `toProgrammaticCompilerOptions`,
  `throws: false` + `noErrorValidation`, `explicitTrigger` at its default.
  The result cache is `@tsdoctor/vfs`'s `makeTwoslashCache` persisted by
  `src/TwoslashCache.ts` (`TwoslashCacheStore` service) into the SAME XDG
  `tsdoctor/twoslash.sqlite` and blob keys the RSPress plugin uses, so either
  adapter warms the other.
- `DEFAULT_CATEGORIES` (`src/Categories.ts`) mirrors the RSPress defaults so
  both adapters generate the same routes from one bundle; keep them in step.
- Out of scope for the alpha, deliberately: code-block cross-links
  (`ShikiCrossLinker` is RSPress-HAST-shaped), llms.txt, multiVersion / i18n /
  multi-API, OG image resolution, snapshot-tracked writes, a `serve` runner.
- Builds with `build()` (`savvy.build.ts`, `@savvy-web/bundler`); tsconfig
  extends `@savvy-web/bundler/tsconfig/ecma.json`; `vitepress` is a peer.

## Commands

```bash
pnpm --filter vitepress-plugin-api-extractor run build:dev
pnpm --filter @sites/vitepress-basic run build   # the fixture site
pnpm vitest run platforms/vitepress/
```

## Design Docs

- @../../.claude/design/rspress-plugin-api-extractor/doc-ir-and-pages.md
- @../../.claude/design/rspress-plugin-api-extractor/type-loading-vfs.md
- @../../.claude/design/rspress-plugin-api-extractor/structured-data-and-og.md
