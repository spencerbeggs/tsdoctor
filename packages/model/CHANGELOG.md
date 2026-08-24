# @tsdoctor/model

## 0.2.0

### Breaking Changes

- `@tsdoctor/model` is redesigned from a promise/static-class API into idiomatic Effect v4 namespace modules. The package is still pre-1.0 (0.x), so this ships as a minor per this repo's convention for breaking 0.x changes, but every import from the previous API surface needs updating.

#### Namespace modules replace the old classes and free functions

- The public surface (`import { ... } from "@tsdoctor/model"`) is now:

- `Model` — Effect-typed model loading. `Model.load(modelPath)` returns an `Effect` that fails with typed `ModelNotFoundError`, `ModelParseError`, or `EmptyModelError` instead of rejecting a bare promise.

- `Tsdoc` — pure TSDoc accessors (summary, params, release tag, deprecation, …), replacing ad hoc extraction helpers.

- `ApiItems` — `ApiItems.categorize(items, categories)` now returns `{ items, uncategorized }` instead of throwing or silently dropping unmatched items; callers decide what to do with `uncategorized`.

- `EntryPoints` — multi-entry-point resolution and re-export deduplication (`EntryPoints.resolve`).

- `Routes` — route candidate construction, collision detection (`Routes.detectCollisions`, `Routes.RouteCollisionError`) and the single canonical `Routes.sanitizeId`.

- `SyntheticBases` — detection of unexported base declarations referenced by an exported class's extends clause.

- `Signature` — signature formatting (`Signature.format`), replacing the removed `TypeSignatureFormatter` class.

- `Render` — markdown rendering, built on `@effected/markdown`.

- `CrossLinker` — now an immutable class (`CrossLinker.fromRoutes`, `CrossLinker.fromRefs`, `CrossLinker.empty`, `.link`, `.linkHtml`) replacing the previous mutable cross-linker.

- `StructuredData` — an `@alpha` stub for future schema.org JSON-LD derivation.

```typescript
import { Model, Tsdoc, ApiItems } from "@tsdoctor/model";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const apiPackage = yield* Model.load("./my-package.api.json");
	const { items, uncategorized } = ApiItems.categorize(apiPackage.entryPoints[0].members, categories);
	const summary = Tsdoc.summary(items[0]);
});
```

#### Migration

- Replace `loadApiModel(path)` (promise-returning) with `Model.load(path)` (`Effect`-returning) and handle the three typed failure cases.
- Replace `new TypeSignatureFormatter().format(excerpt)` with `Signature.format(excerpt)`.
- Replace `new MarkdownCrossLinker(routes)` with `CrossLinker.fromRoutes(routes)`; the mutable `.reinitialize()` no longer exists — construct a new `CrossLinker` per build instead.
- Update any code that imported the multi-entry/route-collision/synthetic-base helpers directly — they now live on `EntryPoints`, `Routes` and `SyntheticBases` respectively. [#165][#165]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @effected/markdown | peerDependency | added | — | ^0.6.0 |
| @effected/package-json | peerDependency | added | — | ^0.11.0 |
| effect | peerDependency | added | — | 4.0.0-rc.109 |

[#165][#165]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#165]: https://github.com/spencerbeggs/tsdoctor/pull/165

## 0.1.0

### Features

#### New package, seeded from `api-extractor-llms`

- `@tsdoctor/model` is a new package that renders Microsoft API Extractor models into LLM-lean markdown, with injectable frontmatter and cross-link routes. It replaces `api-extractor-llms@0.2.0`, which is now dissolved and will not receive further releases, and carries forward the same public API:

- `loadApiModel` — load an `.api.json` file into an `ApiModel`

- `renderItem` / `renderPackage` / `isEmittable` — render API items to markdown

- `CrossLinker` — resolve type references to markdown links

- `TypeSignatureFormatter` — format TypeScript signatures for display

- TSDoc extraction helpers — `getSummary`, `getReleaseTag`, `getParams`, `getReturns`, `getExamples`, `getDeprecation`, `hasModifierTag`, `extractPlainText`

```typescript
import { loadApiModel, renderPackage } from "@tsdoctor/model";
```

- Consumers of `api-extractor-llms` migrate by depending on `@tsdoctor/model` instead; the imported names are unchanged. [#163][#163]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#163]: https://github.com/spencerbeggs/tsdoctor/pull/163
