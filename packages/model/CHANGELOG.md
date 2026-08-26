# @tsdoctor/model

## 0.4.0

### Breaking Changes

- The `@alpha` `StructuredData` namespace export is removed. It was a stub whose `derive` threw `"not implemented yet"` on every call and had no consumers. Schema.org derivation now lives in the new `@tsdoctor/seo` package's `packageContext` / `derive` / `deriveScriptBody`. [#186][#186]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#186]: https://github.com/spencerbeggs/tsdoctor/pull/186

## 0.3.0

### Features

#### `Routes.memberAnchors` and `ApiItems.memberAnchors`

- Anchor ids for every member of a class or interface, computed in one place so a member's cross-link `#fragment` and its rendered `id=` cannot disagree.

- `Routes.memberAnchors(refs)` — pure, over `{ id, displayName, slot }` records

- `Routes.memberAnchor(displayName, prefix?)` — the single-member form

- `ApiItems.memberAnchors(item)` — derives the slots from an `ApiClass` / `ApiInterface` and delegates

- `Routes.MemberSlot` and `Routes.MemberRef` describe the input shape

- When several members sanitize to the same anchor, the highest-priority slot keeps the bare anchor and the rest are prefixed. Priority runs static method, static property, instance method, getter, instance property — static leads so a member's anchor agrees with the bare cross-link key that resolves to it, and the prefix marks the non-canonical side (`instance-create`).

#### `Routes.memberRouteKeys` and `ApiItems.memberRouteKeys`

- Cross-link keys for a class's members. A bare `Class.member` reference resolves to the **static** member when a class has both — `Registry.create` is the static access expression in TypeScript, while the instance one is `registry.create`.

- Where a static/instance collision makes that ambiguous, three further keys are emitted, using the TSDoc declaration-reference selectors API Extractor canonical references already carry:

| Key | Resolves to |
| :-- | :-- |
| `Registry.create` | the static member |
| `Registry.(create:static)` | the static member, explicitly |
| `Registry.(create:instance)` | the instance member |
| `Registry.prototype.create` | the instance member |

- `Class#member` is deliberately not emitted: `#` is the URL fragment delimiter, so such a key reads ambiguously beside a route, and in modern TypeScript it denotes a private field. Selector keys appear only where a collision exists, so a class with no colliding names keeps a single key per member.

### Bug Fixes

#### Colliding members no longer share an anchor

- A class with both a `static create()` and an instance `create()` previously produced the *same* anchor for both members, because the prefix was keyed by sanitized name rather than by member. Anchors are now keyed per member: the static member takes `#create` and the instance member `#instance-create`.

#### Cross-links to keys ending in a non-word character now match

- `CrossLinker` anchored every pattern with a trailing `\b`. That is an assertion about the adjacent character, not a delimiter: after a `)` it matches only when a word character follows, so a key in selector form was unmatchable in every realistic sentence position. Names ending in a word character — every plain identifier and every `Class.member` key — are unaffected.

#### `Routes.sanitizeId` is now genuinely the only implementation

- Its documentation already claimed to be canonical. It was not: the RSPress adapter carried a second sanitizer for page-side `id=` attributes that kept `_` and mapped `$` to `-`, while this one maps `_` to `-` and strips `$`. A member named `get_value` was linked as `#get-value` and rendered as `id="get_value"`, so the cross-link landed nowhere. Both sides call this function now.

- **Anchor URLs change for affected members.** Any member whose name contains `_` or `$`, and the lower-priority half of any static/instance name collision, gets a new fragment. Nothing that previously worked breaks — the id and the link already disagreed, so no functioning deep link used the pair — but external links written against the old fragments need updating.

- Regenerated pages differ in those `id=` attributes, so consuming sites will see the affected pages marked modified on their next build and their `article:modified_time` bump. [#179][#179]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#179]: https://github.com/spencerbeggs/tsdoctor/pull/179

## 0.2.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @microsoft/api-extractor-model | dependency | updated | ^7.33.10 | ^7.33.11 |

[#171][#171]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#171]: https://github.com/spencerbeggs/tsdoctor/pull/171

## 0.2.1

### Bug Fixes

- Prose parsing in `Render` now uses `@effected/markdown`'s phrasing-level `Markdown.parsePhrasingResult` instead of a full document parse and paragraph splice — identical output for the whitespace-normalized single-line prose TSDoc extraction produces, without the per-fragment `Root` construction. [#167][#167]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#167]: https://github.com/spencerbeggs/tsdoctor/pull/167

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
