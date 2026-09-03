# @tsdoctor/pages

[![npm](https://img.shields.io/npm/v/@tsdoctor%2Fpages?label=npm&color=cb3837)](https://www.npmjs.com/package/@tsdoctor/pages)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

The framework-neutral documentation page IR for static TypeScript API sites. A page is facts, an ordered list of typed doc blocks and its navigation entry; prose inside a block is `@effected/markdown` mdast, and code-bearing blocks carry a `display` / `source` pair. A framework adapter is an emitter over this IR.

## What you get

- **Blocks** — the block vocabulary (`Title`, `Signature`, `MemberGroup`, `ParameterTable`, `EnumMemberTable`, `ExampleGroup`, …) as Effect `Schema.Class` variants discriminated on `kind`, plus the `Block` union.
- **`Page`** — the page record: title parts, description, route, `HeadTag[]`, blocks and nav entry.
- **`buildNav`** — one `NavTree` per API (category groups, pages, index), sorted deterministically.
- **`buildExample`, `codeText`, `prepareExampleCode`, `stripTwoslashDirectives`, `prependHiddenImports`, `formatExampleCode`** — display/source preparation for code blocks, with Prettier formatting behind a typed `ExampleFormatError`.
- **`renderMarkdown` / `renderMarkdownResult`** — the neutral plain-markdown emitter over the IR.
- **`parseLlmsTxtLine`, `filterLlmsTxt`, `generateStructuredLlmsTxt`, …** — pure text transforms over the llms.txt standard.
- **`apiScopeOf`, `unscopedName`, `normalizeBaseRoute`** — API scope naming helpers shared by every adapter.

## Install

```bash
npm install @tsdoctor/pages
# or
pnpm add @tsdoctor/pages
```

Requires `effect` and `@effected/markdown` as peers.

## License

MIT
