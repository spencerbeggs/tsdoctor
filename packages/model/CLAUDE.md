# packages/model/CLAUDE.md

`@tsdoctor/model` (publishable, versioned via changesets) — pure rendering of
Microsoft API
Extractor models: api.json loading, TSDoc extraction, type-signature
formatting, prose cross-linking and per-item markdown rendering.

Seeded in phase 1 of the consolidation from the dissolved `api-extractor-llms`
npm package (`monorepo-consolidation.md`); same code, new name. Runtime deps
are only `@microsoft/api-extractor-model` + `@microsoft/tsdoc` — keep it pure
(no Effect, no framework, no I/O beyond model loading).

## Key Facts

- Modules: `model-loader.ts` (`loadApiModel`), `tsdoc.ts` (summary/params/
  returns/examples extraction), `formatter.ts` (`TypeSignatureFormatter`),
  `cross-linker.ts` (immutable `CrossLinker`), `render.ts`, `types.ts`.
- Primary consumer is `platforms/rspress/` via four thin shims (`loader.ts`,
  `model-loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`) — the
  delegation boundaries are in `build-architecture.md` ("Shared Library
  Delegation"). The plugin's `ApiExtractedPackage.extractPlainText` is a
  **different** algorithm from this package's `extractPlainText`; they are not
  interchangeable.
- API shape may be redesigned (open decision in
  `tsdoctor-package-architecture.md`) — but not silently; phase 1 froze it.
- Builds with `defineBuild()` (`savvy.build.ts`, `@savvy-web/bundler`);
  tsconfig extends `@savvy-web/bundler/tsconfig/ecma.json`. Source
  `package.json` stays `"private": true`; `publishConfig` drives publishing.

## Commands

```bash
pnpm --filter @tsdoctor/model run build:dev
pnpm vitest run packages/model/
```

## Design Docs

Delegation boundaries and the consolidation plan:

- @../../.claude/design/rspress-plugin-api-extractor/build-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/monorepo-consolidation.md
