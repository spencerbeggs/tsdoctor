# @tsdoctor/model

[![npm](https://img.shields.io/npm/v/@tsdoctor/model?label=npm&color=cb3837)](https://www.npmjs.com/package/@tsdoctor/model)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-5fa04e.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-3178c6.svg)](https://www.typescriptlang.org/)

Turn a Microsoft API Extractor `.api.json` model into plain markdown that reads cleanly for both people and language models. You get one markdown document per top-level export — an H1, the summary, a fenced `ts` signature, parameters, returns, container members and examples — with no site chrome, no HTML and no framework coupling.

## Why @tsdoctor/model

API Extractor already understands your `.d.ts` surface. What it will not do is hand you docs you can drop into a prompt, a wiki or a static site. That is the gap this package closes. The body of every rendered doc stays the same no matter where it ends up. Two things change between consumers: the frontmatter block at the top and the URL scheme for cross-links. You inject both, so one renderer feeds an RSPress site, an MCP server or a folder of bare `.md` files.

## Install

```bash
npm install @tsdoctor/model
# or
pnpm add @tsdoctor/model
```

The package is also published to GitHub Packages as `@spencerbeggs/@tsdoctor/model` if you prefer the scoped name; point your registry at `https://npm.pkg.github.com` for that scope and install it the same way.

This is an ESM-only package. Import it from a module context (`"type": "module"` or `.mjs`).

## Quick start

Load a model, render it, then write each doc wherever you want. The library does no I/O of its own. File writing is yours.

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { loadApiModel, renderPackage } from "@tsdoctor/model";

const pkg = await loadApiModel("./temp/my-pkg.api.json");

const docs = renderPackage(pkg, {
  packageName: "my-pkg",
  routeFor: (ref) => `/api/${ref.slug}`,
});

await mkdir("./out", { recursive: true });
for (const doc of docs) {
  await writeFile(`./out/${doc.slug}.md`, doc.markdown);
}

console.log(docs.map((d) => `${d.kind}: ${d.name}`));
// e.g. [ 'function: loadApiModel', 'class: CrossLinker', 'type: RenderedDoc' ]
// (the actual list depends on your model's exports)
```

Each entry in the returned array is a `RenderedDoc` with `name`, `kind`, `slug`, `summary`, `packageName` and the assembled `markdown`.

### Inject frontmatter

Pass a `frontmatter` function to prepend a block — YAML, TOML or whatever your target expects. Omit it for bare bodies.

```ts
const docs = renderPackage(pkg, {
  packageName: "my-pkg",
  frontmatter: (meta) => `---\ntitle: ${meta.name}\nkind: ${meta.kind}\n---\n\n`,
});

console.log(docs[0].markdown.startsWith("---"));
// true
```

`routeFor` and `frontmatter` are independent. Supply either, both or neither.

### Filter exports

By default `renderPackage` drops compiler-synthetic forgotten exports — the `*_base` classes TypeScript hoists for Effect class mixins, which API Extractor keeps in the model when it runs with `includeForgottenExports: true`. They stay in the `.api.json` (downstream `.d.ts` reconstruction needs them) but never reach the rendered markdown. That default lives in the exported `isEmittable` predicate.

Pass your own `filter` to change which top-level items are emitted. A filter that returns `true` keeps the item, both as a rendered doc and as a crosslink target. Supplying a `filter` fully replaces the default, so compose it with `isEmittable` when you want to keep the forgotten-export drop alongside your own rule.

```ts
import { isEmittable, renderPackage } from "@tsdoctor/model";

const docs = renderPackage(pkg, {
  packageName: "my-pkg",
  filter: (item) => isEmittable(item) && !item.displayName.startsWith("Internal"),
});

console.log(docs.every((d) => !d.name.startsWith("Internal")));
// true
```

## Features

- `loadApiModel(path)` reads a `.api.json` file from disk and returns its `ApiPackage`.
- `renderPackage(pkg, opts)` walks the first entry point and returns one `RenderedDoc` per top-level member, dropping compiler-synthetic forgotten exports unless you pass your own `filter`.
- `renderItem(item, opts)` renders a single API item to a markdown body, with an optional `CrossLinker`.
- `isEmittable(item)` is the default emit rule — it drops forgotten exports (`isExported === false`) and keeps everything else; compose it into a custom `filter` to keep that behaviour.
- `CrossLinker` wraps known item names in prose with links, skipping code spans and existing links, using your injected route scheme.
- `TypeSignatureFormatter` formats an API Extractor `Excerpt` into a clean type signature, wrapping long unions across lines.
- TSDoc helpers — `getSummary`, `getParams`, `getReturns`, `getExamples`, `getDeprecation`, `getReleaseTag`, `hasModifierTag` and `extractPlainText` — pull plain data off an `ApiItem` with no rendering.

## Generating a model

This package consumes the JSON that [Microsoft API Extractor](https://api-extractor.com/) produces. Run API Extractor against your project first with `docModel.enabled` set in your `api-extractor.json`, then feed the resulting `.api.json` to `loadApiModel`.

## License

[MIT](LICENSE)
