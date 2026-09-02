# @tsdoctor/model

[![npm](https://img.shields.io/npm/v/@tsdoctor%2Fmodel?label=npm&color=cb3837)](https://www.npmjs.com/package/@tsdoctor/model)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Framework-neutral analysis and rendering for Microsoft API Extractor `.api.json` models: Effect-typed loading, pure TSDoc extraction, categorization, multi-entry-point resolution, route/collision computation, synthetic-base detection, type-signature formatting, prose cross-linking, declaration reconstruction and markdown rendering.

## Why @tsdoctor/model

API Extractor's `.api.json` gives you a full symbol graph but no opinion on what to do with it. Turning that graph into documentation means walking TSDoc comments, formatting signatures, deduplicating re-exports across entry points, and deciding where each item's page lives — the same handful of problems every static-doc adapter (RSPress, VitePress, an MCP server, a folder of plain markdown) solves independently. This package solves them once, as pure functions and namespace modules with no I/O beyond loading the model file, so an adapter supplies only the two things that actually differ between consumers: frontmatter and the URL scheme.

## Install

```bash
npm install @tsdoctor/model
```

```bash
pnpm add @tsdoctor/model
```

Requires Node.js >=24.11.0. This is an ESM-only package.

`@effected/markdown`, `@effected/yaml` and `effect` are required peers — `Render` builds its output as `@effected/markdown` node trees, and the frontmatter helpers parse and emit through `@effected/yaml`. [`@tsdoctor/vfs`](https://www.npmjs.com/package/@tsdoctor/vfs) is an ordinary dependency, resolved for you: `ApiExtractedPackage` extends its `VirtualPackage`.

## Quick start

Load a model, render every top-level export to markdown, and write the files wherever you want — the library does no file I/O beyond the `Model.load` read itself.

```ts
import { mkdir, writeFile } from "node:fs/promises";
import { Effect } from "effect";
import { Model, Render } from "@tsdoctor/model";

const program = Effect.gen(function* () {
  const pkg = yield* Model.load("./temp/my-pkg.api.json");

  const docs = Render.docs(pkg, {
    packageName: "my-pkg",
    routeFor: (ref) => `/api/${ref.slug}`,
    frontmatter: (meta) => `---\ntitle: ${meta.name}\nkind: ${meta.kind}\n---\n\n`,
  });

  yield* Effect.promise(() => mkdir("./out", { recursive: true }));
  for (const doc of docs) {
    yield* Effect.promise(() => writeFile(`./out/${doc.slug}.md`, doc.markdown));
  }

  return docs;
});

const docs = await Effect.runPromise(program);
console.log(docs.map((d) => `${d.kind}: ${d.name}`));
// e.g. [ 'function: load', 'class: CrossLinker', 'interface: RenderedDoc' ]
// (the actual list depends on your model's exports)
```

`Model.load` fails with `ModelNotFoundError` or `ModelParseError` on the Effect error channel rather than throwing — a missing or malformed `.api.json` is an expected failure mode for a build pipeline, not a defect. `Render.docs` returns one `RenderedDoc` (`name`, `kind`, `slug`, `summary`, `packageName`, `markdown`) per top-level, emittable export.

`routeFor` and `frontmatter` are independent — supply either, both, or neither. Without `routeFor`, item names in prose are left unlinked; without `frontmatter`, `markdown` is the bare body.

### Render a single item

`Render.item` renders one `ApiItem` without walking the whole package — useful when a caller already has categorized items (via `ApiItems.categorize`) and wants to drive its own page-assembly loop.

```ts
import { Render } from "@tsdoctor/model";

const body = Render.item(apiItem, { packageName: "my-pkg" });
console.log(body.startsWith("#"));
// true — every rendered body opens with an H1 of the item's display name
```

### Filter which items get a page

By default `Render.docs` drops compiler-synthetic forgotten exports — the `*_base` declarations TypeScript hoists for Effect class mixins (`Schema.Class`, `Data.TaggedError`), which stay in the model under `includeForgottenExports: true` but should never be their own page. That default lives in the exported `Render.isEmittable` predicate; `SyntheticBases.detect` finds the same declarations for adapters that want to inline them on the owning class's page instead of dropping them silently.

```ts
import { Render } from "@tsdoctor/model";

const docs = Render.docs(pkg, {
  packageName: "my-pkg",
  filter: (item) => Render.isEmittable(item) && !item.displayName.startsWith("Internal"),
});
```

Supplying `filter` fully replaces the default, so compose it with `Render.isEmittable` to keep the forgotten-export drop.

## Features

- **`Model`** — Effect-typed `.api.json` loading. `Model.load(path)` returns the package's `ApiPackage` or fails with `ModelNotFoundError` / `ModelParseError`; `Model.firstPackage(apiModel)` extracts a package from a caller-constructed `ApiModel`, failing with `EmptyModelError` if it has none.
- **`Tsdoc`** — pure extraction off an `ApiItem`: `summary`, `params`, `returns`, `examples`, `deprecation`, `releaseTag`, `hasModifier`, `seeReferences`, plus `plainText`/`toMarkdown` for walking a raw TSDoc `DocNode` tree yourself.
- **`ApiItems`** — `categorize(items, categories)` groups top-level items by category key (returning `{ items, uncategorized }` so the caller decides how to handle the leftovers), `namespaceMembers` flattens namespace contents with qualified names, `inheritance` reads extends/implements, `sourceLink` builds a source-code URL; `memberAnchors(item)` and `memberRouteKeys(item)` are the `ApiClass` / `ApiInterface` views of the `Routes` functions below.
- **`EntryPoints`** — `resolve(apiPackage)` deduplicates items re-exported from more than one entry point (e.g. `.` and `./testing`) into a flat list, recording every entry point each item is available from.
- **`Routes`** — `RouteCandidate`, `detectCollisions`, and the typed `RouteCollisionError` for failing a build when two distinct items would resolve to the same output route; `sanitizeId` is the single anchor-id sanitizer for member routes, with `memberAnchor` as its named alias for one member.
- **`Routes` member anchors and keys** — `memberAnchors(members)` computes every member's anchor in one pass, keyed by `MemberRef.id`, prefixing the lower-priority member when two sanitize alike (`static create()` keeps `#create`, the instance one becomes `#instance-create`). `memberRouteKeys(className, members)` returns the cross-link keys those anchors answer to: a bare `Class.member` resolves to the static member when a class has both, with `Class.(member:static)`, `Class.(member:instance)` and `Class.prototype.member` emitted to disambiguate. Feed both from the same member list so a page's `id=` and a link's `#fragment` cannot drift.
- **`SyntheticBases`** — `detect(items)` finds the unexported `*_base` declarations an exported class's `extends` clause references, so an adapter can inline them instead of generating (or silently dropping) a page for them; `BASE_CLASS_ANCHOR` is the matching anchor id.
- **`Signature`** — `format(excerpt)` turns an API Extractor `Excerpt` into a clean, line-wrapped type signature string; `stripExportDeclare` strips `export`/`declare` modifiers from declaration text.
- **`CrossLinker`** — an immutable class that wraps known item names in prose with links, skipping code spans and existing links. Build one per build from a precomputed route map (`CrossLinker.fromRoutes`) or from item refs plus an injected URL scheme (`CrossLinker.fromRefs`); `link` returns markdown links, `linkHtml` returns `<a>` anchors.
- **`Render`** — the markdown output system. `Render.docs(pkg, opts)` renders a whole package; `Render.item(apiItem, opts)` renders one item; `Render.isEmittable` is the default emit rule. `Render.tree` (`@alpha`) exposes the pre-serialization `@effected/markdown` node tree for a future page-IR consumer.
- **`ApiExtractedPackage`** — reconstructs `.d.ts` text from a model and renders it to a `Vfs`, one declaration file per entry point behind a synthetic `package.json`, so a type-checker can resolve the documented package the way a consumer would. Built on `VirtualPackage` from `@tsdoctor/vfs`; `fromApiModel(path)` loads a model file, `fromPackage(apiPackage, name)` takes one already in memory.
- **`TypeReferenceExtractor`** — finds the types a package's declarations reference but do not own, and emits the `import type` statements those declarations need. `extractImports` covers a package, `extractImportsForEntryPoint` one entry point, and the static `formatImports` renders an `ImportStatement[]` to source lines. Built-in and self-referencing types are filtered out, and a namespaced reference imports its namespace root rather than the leaf member.
- **Frontmatter** — `parseFrontmatter(text)` splits a document into `{ data, content }`, `stringifyFrontmatter(data)` emits the YAML block, and `emitFrontmatterBlock(data, body)` assembles a whole document. Quoting is chosen so a YAML 1.1 consumer decodes the same values a YAML 1.2 one does — an unquoted ISO timestamp would otherwise arrive as a `Date` in one and a string in the other.

## License

[MIT](LICENSE)
