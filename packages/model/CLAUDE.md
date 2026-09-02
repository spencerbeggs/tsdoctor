# packages/model/CLAUDE.md

`@tsdoctor/model` (publishable, versioned via changesets) — framework-neutral
analysis and rendering of Microsoft API Extractor models: Effect-typed model
loading, TSDoc extraction, categorization, multi-entry resolution,
route/collision computation, synthetic-base detection, signature formatting,
prose cross-linking and markdown rendering.

Seeded in phase 1 from the dissolved `api-extractor-llms` npm package, then
**redesigned in phase 2** as idiomatic Effect v4 namespace modules; it also
absorbed the plugin's former `multi-entry-resolver.ts`, `route-collisions.ts`
and `synthetic-bases.ts`, and later its `api-extracted-package.ts`,
`type-reference-extractor.ts` and `frontmatter.ts`. Runtime deps are
`@microsoft/api-extractor-model`, `@microsoft/tsdoc` and `@tsdoctor/vfs`
(`workspace:*`, for `VirtualPackage`); peers are `effect`,
`@effected/markdown`, `@effected/yaml` and `@effected/package-json`
(catalog-pinned). `@tsdoctor/snapshot` is a **test-only** devDependency — the
frontmatter characterization tests pin literal digests, so they hash through
the real `hashFrontmatter`; never promote it to a runtime dep. Keep the package
framework-free: no RSPress, no React, no I/O beyond model loading.

## Key Facts

- Public surface (`src/index.ts`) is namespace modules: `Model` (Effect-typed
  loading; `ModelNotFoundError`/`ModelParseError`/`EmptyModelError`), `Tsdoc`
  (pure TSDoc accessors), `ApiItems` (`categorize` → `{ items, uncategorized }`,
  `namespaceMembers`), `EntryPoints` (`resolve` dedupe + `availableFrom`),
  `Routes` (`RouteCandidate`, `detectCollisions`, `RouteCollisionError`,
  `sanitizeId`, `memberAnchor`, `memberAnchors`, `memberRouteKeys`),
  `SyntheticBases` (`detect`, `BASE_CLASS_ANCHOR`), `Signature`
  (`format`, de-classed), `Render` (string API + `@alpha` `Render.tree` on
  `@effected/markdown`), the `CrossLinker` class
  (`fromRoutes`/`fromRefs`/`empty`/`link`/`linkHtml`). Shared types in
  `types.ts`; helpers in `internal/`. The `@alpha` `StructuredData` stub is
  **deleted** (phase 4) — schema.org derivation lives in `@tsdoctor/seo`, not
  here. Do not re-add an SEO seam to this package.
- Three non-namespace exports came over from the adapter and are the model's
  api.json → TypeScript bridge:
  - `ApiExtractedPackage` — extends `@tsdoctor/vfs`'s `VirtualPackage` to
    reconstruct high-fidelity `.d.ts` from an `ApiPackage`
    (`fromApiModel`/`fromPackage`, then `toVfs()`; the `generateVfs` alias is
    gone). `VirtualPackage` validates at construction, hence the scratch-instance
    pattern in `fromPackage` — the entries map must exist before `super` runs.
    Its private `extractPlainText` is a **different** algorithm from this
    package's prose extraction: it PRESERVES `{@link X.Y}` and reconstructs code
    fences for `.d.ts`/JSDoc output. Do not unify the two.
  - `TypeReferenceExtractor` (+ `TypeReference`, `ImportStatement`) — classifies
    canonical references and emits the `import type` lines a VFS entry needs.
  - `Frontmatter.ts` (`parseFrontmatter`, `stringifyFrontmatter`,
    `emitFrontmatterBlock`, `ParsedFrontmatter`) — splits fences via
    `@effected/markdown`'s `FrontmatterSource.split` (strict grammar: a fence
    line is exactly `---`, an unterminated block is not frontmatter) and emits
    via `FrontmatterSource.join` + `Yaml.stringify({ quoteCompat: "yaml-1.1",
    quoteStyle: "double" })`. The hand-rolled gray-matter-quirk scanner is
    deleted; do not restore it.
- Primary consumer is `platforms/rspress/`, which imports these modules
  **directly** — the four phase-1 delegation shims are deleted (see "Core
  Package Consumption" in `build-architecture.md`).
  `Routes.sanitizeId` is the **single** anchor
  algorithm for the whole monorepo — the adapter's second copy in
  `markdown/helpers.ts` is deleted, because the two had drifted (`_` and `$`
  handled differently) and every member name containing either had a
  cross-link that landed nowhere. `Routes.memberAnchors` keys by **member**,
  not by sanitized name, so both halves of a static/instance collision get
  distinct ids; `ApiItems.memberAnchors`/`memberRouteKeys` are the `ApiItem`
  views. Do not add a third spelling.
  `internal/prose.ts`'s `phrasingFromMarkdown`
  uses `@effected/markdown`'s `Markdown.parsePhrasingResult` rather than a
  full parse + `Paragraph` splice.
- `__test__/mdx-vocabulary.test.ts` is the proof-consumer suite for
  `@effected/markdown`'s MDX vocabulary (construction/serialization),
  seeding the phase-5 `@tsdoctor/pages` IR seam.
- Builds with `defineBuild()` (`savvy.build.ts`, `@savvy-web/bundler`);
  tsconfig extends `@savvy-web/bundler/tsconfig/ecma.json`. Source
  `package.json` stays `"private": true`; `publishConfig` drives publishing.

## Commands

```bash
pnpm --filter @tsdoctor/model run build:dev
pnpm vitest run packages/model/
```

## Design Docs

Consumption boundaries and the target architecture:

- @../../.claude/design/rspress-plugin-api-extractor/build-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/tsdoctor-package-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-resolution.md
- @../../.claude/design/rspress-plugin-api-extractor/cross-linking-architecture.md
