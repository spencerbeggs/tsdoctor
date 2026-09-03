---
status: current
module: rspress-plugin-api-extractor
category: cross-linking
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
  - rspress-plugin-api-extractor/multi-entry-resolution.md
  - rspress-plugin-api-extractor/ssg-compatible-components.md
  - rspress-plugin-api-extractor/import-generation-system.md
---

# Cross-linking architecture

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Data flow](#data-flow)
- [Prose cross-linking](#prose-cross-linking)
- [ShikiCrossLinker](#shikicrosslinker)
- [Route map contents](#route-map-contents)
- [Member anchors and cross-link keys](#member-anchors-and-cross-link-keys)
- [Companion names and synthetic bases](#companion-names-and-synthetic-bases)
- [Type matching](#type-matching)
- [VfsRegistry](#vfsregistry)
- [Known limitations](#known-limitations)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

Cross-linking turns type references into clickable links at two levels. In prose, the immutable `CrossLinker` from `@tsdoctor/model` replaces type names with `[Name](/route)` links before the prose is parsed into the page IR. In code blocks, `ShikiCrossLinker` post-processes Shiki's HAST output to wrap type identifiers in `<a>` tags, including inside Twoslash hover tooltips. Both are built once per API from the same route map, so a given name resolves to the same page in prose and in code.

## Current state

| Concern | Where it lives |
| --- | --- |
| The prose `CrossLinker` (`fromRoutes` / `fromRefs` / `empty` / `link` / `linkHtml`) | `packages/model/src/CrossLinker.ts` |
| `sanitizeId`, `memberAnchor(s)`, `memberRouteKeys`, collision detection | `packages/model/src/Routes.ts`, with `ApiItem` views in `ApiItems.ts` |
| Synthetic base detection and `BASE_CLASS_ANCHOR` | `packages/model/src/SyntheticBases.ts` |
| Route map construction and `crossLinkKindPriority` | `packages/pages/src/WorkItems.ts` |
| Prose linking into the IR | `packages/pages/src/Build.ts` |
| `ShikiCrossLinker` | `platforms/rspress/src/shiki-transformer.ts` |
| `VfsRegistry` | `platforms/rspress/src/vfs-registry.ts` |
| Per-API construction of both linkers | `platforms/rspress/src/build-program.ts` |
| Code-block consumers | `platforms/rspress/src/remark-api-codeblocks.ts`, `remark-with-api.ts` |
| Generics escaping with backtick safety | `platforms/rspress/src/emit/mdx.ts` |
| Anchor and page-id agreement pin | `platforms/rspress/__test__/markdown/anchor-invariant.test.ts` |

## Data flow

```text
prepareWorkItems (@tsdoctor/pages)
  -> routes: name -> route path (bare names owned by the highest-priority kind)
  -> kinds:  name -> item kind (priority arbitration only; never reaches a linker)
        |
        +-> CrossLinker.fromRoutes(routes)            -> GenerateSinglePageContext.linker
        |     buildPage links prose, then parses it to mdast
        |
        +-> ShikiCrossLinker.fromRoutes(routes, apiScope)
              VfsRegistry.register(apiScope, { crossLinker, ... })
              remark plugins: VfsRegistry.get(apiScope).crossLinker.transformHast(hast)
```

Both linkers are immutable and scoped the same way. The prose linker travels as a value through the pipeline context into `buildPage`; the Shiki linker sits behind that scope's `VfsRegistry` entry for the remark plugins. **A linker is a scope**: there is no mutable "current scope", no `reinitialize` and no scope parameter on `transformHast` — the caller picks the scope by picking the linker. Do not reintroduce a module-level prose linker: `generateApiDocs` runs per API concurrently, and a shared holder let one API's pages be linked against another's route map (`rspress-mdx-emitter.md` records the two fixture pages that mislinked). Anything the builders need reaches them as a value on `BuildPageInput`.

## Prose cross-linking

`Build.ts` applies `linker.link(text)` to member summaries and returns, parameter descriptions, the deprecation notice, the function returns section, enum member descriptions, see-also references and namespace member-index summaries, then parses the result as commonmark phrasing content. The summary paragraph is deliberately not linked (`doc-ir-and-pages.md`, carried quirks). The class owns longest-first matching, the word-boundary regex and the skipping of existing links and backtick code spans; `linkHtml` is the HTML variant.

## ShikiCrossLinker

`ShikiCrossLinker.fromRoutes(routes, apiScope)` holds the routes and a `classMembersMap` grouping member names by parent (`"Logger.addTransport"` → `"Logger"` → `["addTransport"]`, longest first). `transformHast(hast)` walks the tree in three phases per line:

1. **Class and namespace member linking** — a scope stack tracks nested class, interface and namespace bodies by matching braces, and span content inside a body is matched as `${currentScope}.${content}`.
2. **Twoslash tooltip method extraction** — `.twoslash-hover` spans have their tooltip code matched against declaration forms such as `function Formatters.formatEntry(` or `(property) Logger.addTransport:`, and the method name is linked to the qualified route.
3. **Type reference linking** — a regex over the top-level names (dotted member names excluded) splits text nodes at reference boundaries and inserts `<a class="api-type-link" data-api-processed>` elements, first inside hover spans and then in regular code text. Spans already processed by an earlier phase are skipped.

Cross-linking runs as post-processing rather than during Shiki rendering because Twoslash popup positioning depends on the original HAST structure; modifying spans during rendering shifted or broke the popup containers.

## Route map contents

Routes are `{baseRoute}/{categoryFolder}/{lowercased name}` for top-level items, `.../{class}#{anchor}` for class and interface members, and `.../{folder}/{namespace.member}` (lowercased qualified name) for namespace members, with a PascalCase member also getting an unqualified route when no top-level item claims the name. A namespace member's file path is derived by replacing only the final route segment with the qualified name; a first-occurrence replace of the simple name corrupts the category segment whenever a member's lowercased name equals its folder (a type alias `Type` in the `type` folder, the Effect Schema companion-namespace pattern).

## Member anchors and cross-link keys

Anchors come from `Routes.memberAnchors(members)`, reached through `ApiItems.memberAnchors(item)`, which computes the anchor for every member of a class in one pass keyed by the member's canonical reference. `Routes.sanitizeId` is the underlying spelling (lowercase, spaces and underscores to hyphens, other specials stripped) and `Routes.memberAnchor` the single-member alias. The map is computed once in `prepareWorkItems` and carried on the `WorkItem`, so the route map's `#fragment` and the page's `id=` come from one computation.

**Collisions.** When several members sanitize to the same anchor, the highest-priority slot keeps the bare anchor and the others are prefixed — static method, static property, instance method, getter, instance property, static first so the bare anchor agrees with the bare cross-link key. TypeScript forbids two members sharing a name within the same static-ness, so a collision is one static and one instance member and only `instance-` is ever emitted. The per-member keying is load-bearing: an implementation keyed by sanitized name had both halves of a collision render the same id.

**Keys.** `Routes.memberRouteKeys(className, members)` decides which member a qualified name means: `Registry.create` resolves to the static member when both exist (it is the static access expression in TypeScript), `Registry.(create:static)` / `Registry.(create:instance)` are the TSDoc declaration-reference selectors and `Registry.prototype.create` is the instance alias. Selector keys are emitted only when a collision exists, since every extra key is one more pattern the prose linker tests against every string. `Class#member` is deliberately not emitted: `#` is the URL fragment delimiter and denotes a private field in modern TypeScript.

## Companion names and synthetic bases

When a `const` and a type alias share a `displayName` (the Effect Schema companion pattern) they live in different category folders and never collide. A bare reference resolves through `crossLinkKindPriority`: value kinds (class, function, variable, enum) win over type-only kinds (interface, type alias), and namespaces rank last, so a bare `Pipeline` links to `/variable/pipeline`. The cross-link route always equals the generated file path.

An unexported base referenced by an exported class's extends clause routes to the inline "Base Class" section on the owner's page — `Person_base` → `/api/class/person#base-class`, the anchor being `SyntheticBases.BASE_CLASS_ANCHOR`. The route is registered only when the base name is not already owned by a real page and the owner has a route. Because both linkers consume the same map, the underlined `Foo_base` in a signature block jumps to the inline section.

## Type matching

Both linkers sort registered names by length descending so `HookEvent` matches before `Hook`, and match on `\b${name}\b(?![a-zA-Z])` so `MyClass` does not match inside `MyClassFactory`. The prose linker skips matches inside existing markdown links and inside backtick code spans (odd backtick count before the match); without that, linking `` `Pipeline<I, O>` `` would leave `<I, O>` outside a code span for the MDX parser to read as JSX. The Shiki linker filters dotted names out of the phase-3 pattern and relies on `data-api-processed` to avoid double-processing. The RSPress emitter's generics escaping applies the same code-span rule on the mdast tree (`rspress-mdx-emitter.md`).

## VfsRegistry

`VfsRegistry` stores one `VfsConfig` per API scope — highlighter, cross-linker, Twoslash and hide-cut transformers, package name, scope and theme — with `register`, `get` and `clear` (called at the start of each build). The remark plugins resolve the scope from the file being rendered and read everything they need from that entry.

## Known limitations

- **No external package links.** Only types from the documented package are linked.
- **Tooltip parsing is regex-based.** Phase 2 may not match every TypeScript declaration form.
- **`remark-with-api` scope inference has never fired in a fixture build.** Its `inferApiScope` matches a `docs/en/{api}/` path shape no fixture site uses, and which module should own path-to-scope inference is an open design question.
- **No second anchor spelling, ever.** A page-side sanitizer that kept `_` and mapped `$` differently once made every member with those characters a dead cross-link. If page ids ever need different treatment from route anchors, that is a design change, not a local helper.

## Rationale

- **Why one route map feeds both linkers:** prose and code must agree on where a name goes, and the cheapest way to guarantee it is to compute the map once.
- **Why linkers are immutable per scope:** scope isolation as a property of mutable state was a race under concurrent API builds; scope isolation as a property of the value cannot be.
- **Why anchors are computed once and carried:** the page id and the route fragment are the same fact, and two computations of one fact drift.
- **Why post-process HAST:** Twoslash's popup positioning is a function of the HAST Shiki produced.

## Related documentation

- **The pipeline stages that build and consume the linkers:** `page-generation-system.md`
- **The IR builders that link prose:** `doc-ir-and-pages.md`
- **Route collision detection and companion routing:** `multi-entry-resolution.md`
- **Runtime components rendering cross-linked code blocks:** `ssg-compatible-components.md`
- **Type reference extraction:** `import-generation-system.md`
