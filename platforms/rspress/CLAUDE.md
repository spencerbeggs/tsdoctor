# platforms/rspress/CLAUDE.md

The publishable `rspress-plugin-api-extractor` package — the RSPress adapter
over the `@tsdoctor/*` core in `packages/` (the repo-root `plugin/` is the
unrelated Claude Code plugin).

## Architecture

Built via `build()` from `@savvy-web/rspress-builder` (`savvy.build.ts`, self-executing) passing `runtime: true`, `bundledPackages` and `meta.tsdoc.suppressWarnings` (`ae-forgotten-export`). Published via `publishConfig.directory` (`dist/dev/pkg`, npm-only) — no `files` field.

| Artifact | Entry | Target | Output |
| -------- | ----- | ------ | ------ |
| Plugin | `src/index.ts` | Node.js | per-file `.js` under `dist/<mode>/pkg/` (`index.js`, `serve.js`, etc.) |
| Runtime | `src/runtime/` | bundleless per-file JS | `dist/<mode>/pkg/runtime/` (RSPress does the final per-site compile) |
| API model | — | `.api.json` | `dist/<mode>/meta/` |

### Runtime ships bundleless

The React runtime ships as per-file compiled JS under `runtime/` (mirroring `src/runtime/`), with `react`/`@theme` external and `import.meta.env.SSG_MD` left for RSPress to resolve per site build — that is what makes dual-mode (HTML vs markdown) rendering work; a single bundle froze it. `plugin.ts` registers `ApiLlmsPackageActions` (`globalUIComponents`) and `ApiLlmsViewOptions` (`resolve.alias`) by a **zero-level** `path.resolve(pluginDir, "runtime/components/<Name>/index.js")`, layout-invariant across the dev and published roots. Never reintroduce a `../../src/runtime/` prefix — it broke `llms: true` builds when published.

### Effect service layer

Load when rewiring a service, layer, `Context.Reference`, sink or sync
emitter:

- @./CLAUDE.services.md

### Inert configuration

`api: null`, `apis: null` and `apis: []` are valid `PluginOptions` that make the plugin **inert**. `classifyApiConfig` (`config-utils.ts`) returns `"disabled"` and `plugin.ts` computes `isInert` once at factory time; `config()`/`afterBuild()` then skip everything that needs an API model (doc generation, LLMs injection and post-processing, the build summary, `issues.json`). Remark registration and the runtime `source.include` entry still run so `with-api` blocks keep working. Omitting BOTH keys is still an error, as is an explicit `undefined` — only a present, non-`undefined` empty value is an opt-in.

Keep creating the empty `.api-docs/snapshot/` directory on the inert path: no runtime is built there, but a stray sync emitter can force one and SQLite opens its file eagerly.

## Key Dependencies

- `effect` (v4, `catalog:effect`) — core runtime plus the merged-in `FileSystem`
  and `effect/unstable/sql` modules; do not add `@effect/platform` or
  `@effect/sql` back.
- `@effect/platform-node` — `NodeFileSystem`. `@effect/sql-sqlite-node` and
  `gray-matter` are **gone** (`@tsdoctor/snapshot` / `@tsdoctor/model`)
- `ioredis` + the `@effected/*` closure (`semver`/`store`/`tsconfig-json`/
  `xdg`/`github`/`glob`/`npm`/`package-json`/`walker`/`yaml`/`jsonc`/
  `markdown`) + `@typescript/vfs` — peer-closure deps, some imported directly
  (`services/TypeRegistryService.ts`, `sync-node-fs.ts`).
  Do NOT prune as "unused" — see `effect-service-layer.md` (dependency
  closure). Declare `@effected/*` as `catalog:effected`; never
  hand-pin a version range.
- `@tsdoctor/vfs` (`workspace:*`) — the `Vfs` currency type, the
  compiler-options seam (`resolveTypeScriptConfig` in
  `layers/type-environment.ts`; `toProgrammaticCompilerOptions` in
  `twoslash-transformer.ts` — the **single** tsconfig→programmatic
  conversion; fingerprint environments on the ENCODED value) and the Twoslash
  result cache (`twoslashEnvHash`, `makeTwoslashCache`, blob codec) that
  `services/TwoslashCacheService.ts` persists. The adapter's `twoslash-cache.ts`
  is **gone**; keys are unchanged, so warm caches stay warm and the VitePress
  adapter shares them
- `@tsdoctor/registry` (`workspace:*`) — external package types into a `Vfs`;
  tag ids `"@tsdoctor/registry/..."`, XDG namespace `"tsdoctor"`
- `@tsdoctor/model` (`workspace:*`) — consumed **directly** as Effect v4
  namespace modules (`Model`, `Tsdoc`, `ApiItems`, `Routes`, `CrossLinker`,
  …) plus `ApiExtractedPackage`, `TypeReferenceExtractor` and the
  `Frontmatter` helpers (see "Core Package Consumption" in
  `build-architecture.md`)
- `@tsdoctor/pages` (`workspace:*`) — the page pipeline. `build-stages.ts`'s
  `prepareWorkItems` is a **reporting wrapper** over the package's (emits
  `ItemSkipped` per uncategorized item, `RouteCollisionDetected` then throws
  `Routes.RouteCollisionError`; `WorkItem` is the pages type over
  `CategoryConfig`); `generateSinglePage` is `buildPage` → `emitMdxBody`
  (`src/emit/mdx.ts`) → frontmatter; `writeMetadata` is `buildNav` →
  `src/emit/meta.ts`. Scope helpers and `stripTwoslashDirectives` are imported
  from the package directly (no `path-derivation.ts` re-export).
  `emit/mdx.ts` post-processes none of the kit's bytes — the `unescapeLiteral`
  shim is gone with `@effected/markdown@0.8.0`; per-top-level-node
  serialization stays (no kit separator option; the enum-signature
  single-newline join needs it)
- `@tsdoctor/bundle` (`workspace:*`) — bundle discovery for the
  `fromDir`/`fromParentDir` config helpers, plus npm/GitHub bundle fetchers
- `@tsdoctor/snapshot` (`workspace:*`) — `SnapshotService.layer(dbPath)` plus
  the standalone `hashContent`/`hashFrontmatter` helpers
- `@tsdoctor/seo` (`workspace:*`) — every `<head>` concern behind one seam:
  `deriveSiteUrl` (`layers/config-resolution.ts`), `attributionFacts` +
  `packageContext` once per API (`build-program.ts`), `deriveScriptBody` +
  `headTags` (`generateSinglePage`), and the `HeadTag` vocabulary rendered
  into RSPress frontmatter `head` pairs (`markdown/helpers.ts`). Only
  `OgService` (probing a configured image) stays here. Never compose head
  tags in the adapter — `headTags` decides which a page gets
- `@microsoft/api-extractor-model` — `.api.json` parsing (via `Model.load`)
- `@shikijs/twoslash` — highlighting with type information
- `mdast-util-to-hast` — a **runtime** dep and staying one (markdown→HTML is
  out of `@effected/markdown`'s scope); `mdast-util-from-markdown` is dev-only.
  Parse with `dialect: "commonmark"` (the kit defaults to GFM).
- `open` — best-effort browser launch for `serve()`
- Dev only: `@effect/vitest`; `@effected/memfs` is the in-memory `FileSystem`
  for tests (`TypeCache.test.ts`'s `layerNoop` is fault injection — keep it).

## Biome Override

`biome.jsonc` disables `useImportExtensions` for CSS and runtime component
files (the global rule would rewrite `.css` imports to `.js`).

## Source Structure

Load when locating a module or iterating on runtime component styling:

- @./CLAUDE.source-map.md

## Testing

All tests live in `__test__/`, mirroring `src/` — no colocated `*.test.ts`.

```bash
pnpm vitest run platforms/rspress/   # all plugin tests
```

`__test__/**/*.ts` is in the tsconfig `include`, so `pnpm typecheck` covers tests. Fixtures in `__test__/__fixtures__/`, regeneration scripts in `__test__/scripts/`.

Prefer a service's own `makeTest`/`layerTest` double over a hand-written stub; read "0 tests passed" with exit 0 as an import-time throw — see @./CLAUDE.services.md.

## Design Docs

**Build & infrastructure** — load when modifying services, layers,
`Context.Reference`s, either `ManagedRuntime`, hooks, config resolution,
or `savvy.build.ts`:

- @../../.claude/design/rspress-plugin-api-extractor/build-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/effect-service-layer.md
- @../../.claude/design/rspress-plugin-api-extractor/plugin-lifecycle.md
- @../../.claude/design/rspress-plugin-api-extractor/configuration-system.md
- @../../.claude/design/rspress-plugin-api-extractor/build-tooling.md
- @../../.claude/design/rspress-plugin-api-extractor/snapshot-tracking-system.md

**Page generation & markdown** — load when modifying the Stream pipeline
or cross-linking:

- @../../.claude/design/rspress-plugin-api-extractor/page-generation-system.md
- @../../.claude/design/rspress-plugin-api-extractor/cross-linking-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/import-generation-system.md

**Page IR & emitters** — load when modifying `src/emit/` or how
`build-stages.ts` feeds `@tsdoctor/pages`:

- @../../.claude/design/rspress-plugin-api-extractor/doc-ir-and-pages.md
- @../../.claude/design/rspress-plugin-api-extractor/rspress-mdx-emitter.md

**Runtime components & SSG** — load when modifying React components or
SSG-MD rendering:

- @../../.claude/design/rspress-plugin-api-extractor/component-development.md
- @../../.claude/design/rspress-plugin-api-extractor/ssg-compatible-components.md

**Type loading, VFS & multi-entry points** — load when modifying Twoslash,
external types, VFS generation, or multi-entry resolution:

- @../../.claude/design/rspress-plugin-api-extractor/type-loading-vfs.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-point-support.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-resolution.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-vfs.md

**LLMs integration** — load when modifying llms.txt post-processing,
per-package files, or scope-aware UI:

- @../../.claude/design/rspress-plugin-api-extractor/llms-integration.md

**SEO & head metadata** — load when modifying canonical URLs, OG/Twitter
tags, attribution, or JSON-LD:

- @../../.claude/design/rspress-plugin-api-extractor/structured-data-and-og.md

**Observability** — load when modifying metrics, logging, error tracking, the
heartbeat, or `issues.json`:

- @../../.claude/design/rspress-plugin-api-extractor/performance-observability.md
- @../../.claude/design/rspress-plugin-api-extractor/error-observability.md
- @../../.claude/design/rspress-plugin-api-extractor/build-progress-and-issues.md
- @../../.claude/design/rspress-plugin-api-extractor/render-phase-instrumentation.md
