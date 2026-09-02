# platforms/rspress/CLAUDE.md

The publishable `rspress-plugin-api-extractor` package. It lives in
`platforms/rspress/` — the repo-root `plugin/` folder is the unrelated
api-docs Claude Code plugin, and `packages/` holds the core `@tsdoctor/*`
libraries it consumes.

## Architecture

Built via `build()` from `@savvy-web/rspress-builder` (`savvy.build.ts`, self-executing) passing `runtime: true`, `bundledPackages` and `meta.tsdoc.suppressWarnings` (the `ae-forgotten-export` rules). Runtime emission lives in the builder. Published via `publishConfig.directory` (`dist/dev/pkg`, npm-only) — no `files` field.

| Artifact | Entry | Target | Output |
| -------- | ----- | ------ | ------ |
| Plugin | `src/index.ts` | Node.js | per-file `.js` under `dist/<mode>/pkg/` (`index.js`, `serve.js`, etc.) |
| Runtime | `src/runtime/` | bundleless per-file JS | `dist/<mode>/pkg/runtime/` (RSPress does the final per-site compile) |
| API model | — | `.api.json` | `dist/<mode>/meta/` |

### Runtime ships bundleless

The React runtime ships as per-file compiled JS, not raw `.tsx` and not one bundle. The builder transpiles each component to its own `.js` under `runtime/`, mirroring `src/runtime/...`, with `react`/`@theme` external and `import.meta.env.SSG_MD` left unresolved — RSPress resolves it per site build, which is what produces the correct dual-mode (HTML vs markdown) rendering. A bundled `runtime/index.d.ts` is emitted alongside; the published `./runtime` export is `{ types: "./runtime/index.d.ts", import: "./runtime/index.js" }`. `ApiLlmsPackageActions` (`globalUIComponents`) and `ApiLlmsViewOptions` (`resolve.alias`) register against these transpiled files.

The component paths in `plugin.ts` are a **zero-level** resolve to the published `.js` — `path.resolve(pluginDir, "runtime/components/<Name>/index.js")` — not `src/runtime/.../index.tsx`. It is layout-invariant because the runtime sits next to `index.js` in both the dev (`dist/dev`) and published (flat root) layouts. The old `../../src/runtime/` path only worked in the linked dev layout; published, it overshot and broke `llms: true` builds. Do not reintroduce the `../../` prefix.

### Effect service layer

Load when rewiring a service, layer, `Context.Reference`, sink or sync
emitter:

- @./CLAUDE.services.md

### Inert configuration

`api: null`, `apis: null` and `apis: []` are valid `PluginOptions` that make the plugin **inert**. `classifyApiConfig` (`config-utils.ts`) returns `"disabled"` and `plugin.ts` computes `isInert` once at factory time; `config()`/`afterBuild()` then skip doc generation, the LLMs alias + scope/`globalUIComponents` injection, the build summary, `issues.json` and LLMs post-processing. Remark registration and the runtime `source.include` entry still run so `with-api` blocks keep working. Omitting BOTH keys is still an error, as is an explicit `undefined` — only a present, non-`undefined` empty value is an opt-in.

Keep creating the empty `.api-docs/snapshot/` directory on the inert path: no runtime is built there, but a stray sync emitter can force one and SQLite opens its file eagerly.

## Key Dependencies

- `effect` (v4, `catalog:effect`) — core runtime plus the merged-in `FileSystem`
  and `effect/unstable/sql` modules. `@effect/platform` and `@effect/sql` no
  longer exist as separate packages; do not add them back.
- `@effect/platform-node` — Node platform implementation (`NodeFileSystem`).
  `@effect/sql-sqlite-node` is **gone** — SQLite moved behind
  `@tsdoctor/snapshot`; `gray-matter` is gone too, and frontmatter handling
  left the adapter entirely for `@tsdoctor/model`'s `Frontmatter.ts`
- `ioredis` + the `@effected/*` closure (`semver`/`store`/`tsconfig-json`/
  `xdg`/`github`/`glob`/`npm`/`package-json`/`walker`/`yaml`/`jsonc`/
  `markdown`) + `@typescript/vfs` — peer-closure deps, some imported directly
  (`services/TypeRegistryService.ts`, `sync-node-fs.ts`).
  Do NOT prune as "unused" — see the peer dependency closure section in
  `build-architecture.md`. Declare `@effected/*` as `catalog:effected`; never
  hand-pin a version range.
- `@tsdoctor/vfs` (`workspace:*`) — the `Vfs` currency type and the
  compiler-options seam: `resolveTypeScriptConfig` (`layers/type-environment.ts`)
  and `toProgrammaticCompilerOptions` + `DEFAULT_COMPILER_OPTIONS`
  (`twoslash-transformer.ts`). That conversion is the **single** seam between
  the tsconfig spelling (`lib: ["esnext"]`) and the programmatic one; fingerprint
  environments on the ENCODED value. `internal-types.ts` re-exports
  `TypeResolutionCompilerOptions`/`TypeScriptConfig`/`CompilerOptionsInput`
  from here rather than declaring them
- `@tsdoctor/registry` (`workspace:*`) — npm package type definition loading
  into a `Vfs`; tag ids read `"@tsdoctor/registry/..."` and the XDG cache
  namespace is `"tsdoctor"` since phase 2
- `@tsdoctor/model` (`workspace:*`) — consumed **directly** as Effect v4
  namespace modules (`Model`, `Tsdoc`, `ApiItems`, `EntryPoints`, `Routes`,
  `SyntheticBases`, `Signature`, `CrossLinker`) plus `ApiExtractedPackage`,
  `TypeReferenceExtractor` and `parseFrontmatter`/`stringifyFrontmatter`/
  `emitFrontmatterBlock`; the four phase-1 shims are deleted (see "Core
  Package Consumption" in `build-architecture.md`)
- `@tsdoctor/bundle` (`workspace:*`) — bundle discovery for the
  `fromDir`/`fromParentDir` config helpers, plus npm/GitHub bundle fetchers
- `@tsdoctor/snapshot` (`workspace:*`) — `SnapshotService.layer(dbPath)` plus
  the standalone `hashContent`/`hashFrontmatter` helpers
- `@tsdoctor/seo` (`workspace:*`) — every `<head>` concern behind one seam:
  `deriveSiteUrl` (`layers/config-resolution.ts`), `attributionFacts` +
  `packageContext` once per API (`build-program.ts`), `deriveScriptBody` +
  `headTags` (`generateSinglePage`), and the `HeadTag` vocabulary rendered
  into RSPress frontmatter `head` pairs (`markdown/helpers.ts`).
  `og-resolver.ts` and `schemas/opengraph.ts` are **deleted** into it; only
  `OgService` (probing a configured image) stays here. Never compose head
  tags in the adapter — `headTags` decides which a page gets
- `@microsoft/api-extractor-model` — `.api.json` parsing (direct dep; loading
  flows through `@tsdoctor/model`'s `Model.load`)
- `@shikijs/twoslash` — syntax highlighting with type information
- `mdast-util-to-hast` — a **runtime** dep and staying one: markdown→HTML is
  permanently out of `@effected/markdown`'s scope. Its sibling
  `mdast-util-from-markdown` moved to devDeps when `renderMarkdown` switched
  to `Markdown.parseResult` + `Mdast.toMdast` (`dialect: "commonmark"` — the
  kit defaults to GFM, and adopting GFM would be a product change).
- `open` — best-effort browser launch for `serve()`
- Dev only: `@effect/vitest`, and `@effected/memfs` as the standard in-memory
  `FileSystem` for tests. `TypeCache.test.ts`'s hand-written `layerNoop` stays
  — that one is fault injection, which memfs cannot do.

## Biome Override

`biome.jsonc` here disables `useImportExtensions` for CSS and runtime
component files — the runtime imports `.css`, which the global rule would
rewrite to `.js`.

## Source Structure

Load when locating a module or iterating on runtime component styling:

- @./CLAUDE.source-map.md

## Testing

All tests live in `__test__/`, mirroring `src/` — no colocated `*.test.ts`.

```bash
pnpm vitest run platforms/rspress/   # all plugin tests
```

`__test__/**/*.ts` is in this workspace's tsconfig `include`, so `pnpm typecheck` covers tests. Fixtures in `__test__/__fixtures__/`, regeneration scripts in `__test__/scripts/`.

Prefer a service's own `makeTest`/`layerTest` double over a hand-written stub, and read "0 tests passed" with exit 0 as an import-time throw — see @./CLAUDE.services.md.

## Design Docs

**Build & infrastructure** — load when modifying services, layers,
`Context.Reference`s, either `ManagedRuntime`, or the plugin lifecycle:

- @../../.claude/design/rspress-plugin-api-extractor/build-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/snapshot-tracking-system.md

**Page generation & markdown** — load when modifying Stream pipeline,
page generators, or cross-linking:

- @../../.claude/design/rspress-plugin-api-extractor/page-generation-system.md
- @../../.claude/design/rspress-plugin-api-extractor/cross-linking-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/import-generation-system.md

**Runtime components & SSG** — load when modifying React components or
SSG-MD rendering:

- @../../.claude/design/rspress-plugin-api-extractor/component-development.md
- @../../.claude/design/rspress-plugin-api-extractor/ssg-compatible-components.md

**Type loading, VFS & multi-entry points** — load when modifying Twoslash,
external package types, VFS generation, or multi-entry point resolution:

- @../../.claude/design/rspress-plugin-api-extractor/type-loading-vfs.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-point-support.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-resolution.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-vfs.md

**LLMs integration** — load when modifying llms.txt post-processing,
per-package file generation, or scope-aware UI components:

- @../../.claude/design/rspress-plugin-api-extractor/llms-integration.md

**SEO & head metadata** — load when modifying canonical URLs, Open Graph,
Twitter cards, attribution, or schema.org JSON-LD:

- @../../.claude/design/rspress-plugin-api-extractor/structured-data-and-og.md

**Observability** — load when modifying metrics, logging, error tracking, the
progress heartbeat, or the `issues.json` artifact:

- @../../.claude/design/rspress-plugin-api-extractor/performance-observability.md
- @../../.claude/design/rspress-plugin-api-extractor/error-observability.md
- @../../.claude/design/rspress-plugin-api-extractor/build-progress-and-issues.md
- @../../.claude/design/rspress-plugin-api-extractor/render-phase-instrumentation.md
