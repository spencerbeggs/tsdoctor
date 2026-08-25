# packages/model/CLAUDE.md

`@tsdoctor/model` (publishable, versioned via changesets) — framework-neutral
analysis and rendering of Microsoft API Extractor models: Effect-typed model
loading, TSDoc extraction, categorization, multi-entry resolution,
route/collision computation, synthetic-base detection, signature formatting,
prose cross-linking and markdown rendering.

Seeded in phase 1 from the dissolved `api-extractor-llms` npm package, then
**redesigned in phase 2** as idiomatic Effect v4 namespace modules; it also
absorbed the plugin's former `multi-entry-resolver.ts`, `route-collisions.ts`
and `synthetic-bases.ts`. Runtime deps are only
`@microsoft/api-extractor-model` + `@microsoft/tsdoc`; peers are `effect`,
`@effected/markdown` and `@effected/package-json` (catalog-pinned). Keep it
framework-free: no RSPress, no React, no I/O beyond model loading.

## Key Facts

- Public surface (`src/index.ts`) is namespace modules: `Model` (Effect-typed
  loading; `ModelNotFoundError`/`ModelParseError`/`EmptyModelError`), `Tsdoc`
  (pure TSDoc accessors), `ApiItems` (`categorize` → `{ items, uncategorized }`,
  `namespaceMembers`), `EntryPoints` (`resolve` dedupe + `availableFrom`),
  `Routes` (`RouteCandidate`, `detectCollisions`, `RouteCollisionError`,
  `sanitizeId`), `SyntheticBases` (`detect`, `BASE_CLASS_ANCHOR`), `Signature`
  (`format`, de-classed), `Render` (string API + `@alpha` `Render.tree` on
  `@effected/markdown`), the `CrossLinker` class
  (`fromRoutes`/`fromRefs`/`empty`/`link`/`linkHtml`) and the `@alpha`
  `StructuredData` stub. Shared types in `types.ts`; helpers in `internal/`.
- Primary consumer is `platforms/rspress/`, which imports these modules
  **directly** — the four phase-1 delegation shims are deleted (see "Core
  Package Consumption" in `build-architecture.md`). The plugin's
  `ApiExtractedPackage.extractPlainText` is a **different** algorithm from
  this package's prose extraction (it preserves `{@link}` and code fences);
  they are not interchangeable. `internal/prose.ts`'s `phrasingFromMarkdown`
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
