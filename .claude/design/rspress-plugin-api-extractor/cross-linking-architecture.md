---
status: current
module: rspress-plugin-api-extractor
category: cross-linking
created: 2026-01-17
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 90
related:
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/ssg-compatible-components.md
  - rspress-plugin-api-extractor/import-generation-system.md
  - rspress-plugin-api-extractor/multi-entry-resolution.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
dependencies: []
---

# Cross-Linking Architecture

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prose Cross-Linking](#prose-cross-linking)
- [ShikiCrossLinker](#shikicrosslinker)
- [URL Generation](#url-generation)
- [Type Matching Algorithm](#type-matching-algorithm)
- [Backtick Code Span Safety](#backtick-code-span-safety)
- [Integration Points](#integration-points)
- [VfsRegistry](#vfsregistry)
- [Testing](#testing)
- [File Locations](#file-locations)

---

## Overview

The cross-linking system turns type references into clickable links
throughout generated API documentation. It operates at two levels:

1. **Markdown text** -- the immutable `CrossLinker` from `@tsdoctor/model`, built once per API in `build-program.ts` and carried in the pipeline context into the `@tsdoctor/pages` builder, replaces type names in prose descriptions with `[TypeName](/route)` links before the prose is parsed into the IR.
2. **Code blocks** -- `ShikiCrossLinker` post-processes Shiki HAST
   output to wrap type identifiers in `<a>` tags, including inside
   Twoslash hover tooltips.

Both are built once per API scope during the build from the same route map — the prose side travels as a value through `GenerateSinglePageContext` into `buildPage`, the code side is registered behind that scope's `VfsRegistry` entry for the remark plugins.

### Key Design Decisions

- **Scope-based isolation** -- Routes are stored per API scope in Maps,
  enabling multi-API builds without cross-contamination.
- **Longest-first matching** -- Names are sorted descending by length
  so "HookEvent" matches before "Hook".
- **Post-processing over inline transformation** -- The ShikiCrossLinker
  transforms HAST after Shiki/Twoslash rendering (not during), to avoid
  interfering with Twoslash popup positioning.
- **Backtick-aware filtering** -- Both cross-linkers and the MDX
  generics escaper detect backtick code spans and skip processing
  inside them.

---

## Architecture

### Data Flow

```text
prepareWorkItems (build-stages.ts)
  ├─> EntryPoints.resolve() for multi-entry deduplication
  ├─> Build routes Map: typeName → routePath (bare names owned by
  │     highest-priority kind via crossLinkKindPriority)
  ├─> Build kinds Map: typeName → apiItemKind (priority arbitration only)
  └─> Return crossLinkData: { routes, kinds }
         │
         ├─> CrossLinker.fromRoutes(crossLinkData.routes)
         │     One immutable prose linker per API, passed as
         │     `linker` in the pipeline context; both cross-linkers
         │     share the single route map
         │
         ├─> ShikiCrossLinker.fromRoutes(routes, apiScope)
         │     A NEW immutable linker per API; builds classMembersMap
         │
         └─> VfsRegistry.register(apiScope, { crossLinker, ... })
               Makes cross-linker available to remark plugins

Page generation (build-stages.ts → @tsdoctor/pages Build.ts)
  └─> buildPage({ …, linker }) → linker.link(text), then parse to mdast
        Prose enters the IR already linked; the emitter serializes it

Code block rendering (remark-api-codeblocks.ts)
  └─> VfsRegistry.get(apiScope).crossLinker.transformHast(hast)
        HAST → HAST with <a> anchors on type references
```

Both cross-linkers consume the same `crossLinkData.routes` map built once in `prepareWorkItems`, so a given name resolves to the same page in prose and in code blocks.

### Instances

```typescript
// src/build-program.ts — one immutable linker of each kind per API, per build
const linker = CrossLinker.fromRoutes(crossLinkData.routes);          // → pipeline context
const shikiCrossLinker = ShikiCrossLinker.fromRoutes(routes, apiScope); // → VfsRegistry
```

Both sides are immutable, built the same way and scoped the same way. The prose `CrossLinker` is constructed once per API in `generateApiDocs` and handed to the pipeline as `GenerateSinglePageContext.linker`, from which `generateSinglePage` passes it into `buildPage`. The `ShikiCrossLinker` is constructed beside it and stored behind that scope's `VfsRegistry` entry, from which the remark plugins retrieve it.

**The prose side carried the same race the Shiki side did, until phase 5's RSPress switch.** From the pre-phase-4 refactor to 2026-09-02 it was a module-level holder (`markdown/prose-linker.ts`: `setProseLinker` / `linkProse` / `clearProseLinker`), swapped per API — necessary while the page generators ran synchronously outside any fiber, and racy because `generateApiDocs` runs per API at concurrency 2: whichever API installed the holder last owned it for every page generated afterwards. On `sites/versioned` the v1 pages linked into v2's default-version routes (`/api/class/logger` instead of `/v1/api/class/logger`); on `sites/multi` the effect-kit pages were linked against kitchensink's map, so `Encoded` was never linked. The IR builder runs inside the fiber, so the linker travels as a value and the holder is deleted; the two mislinked pages were the one labelled deviation in the golden gate (`doc-ir-and-pages.md`).

This in turn replaced, on the Shiki side, a single long-lived instance created at plugin-factory time,
threaded through the former `ConfigServiceLive` factory's constructor and the build context, and
mutated per API by `reinitialize()`. Scope isolation used to be a property of
internal `…ByScope` maps plus a mutable `currentApiScope` any caller could
reassign between a lookup and a render — with two APIs in one build, whichever
resolved last owned it, so a code block could be linked against another
package's routes. **A linker now IS a scope**, and cannot be pointed at
another package's routes at all.

---

## Prose Cross-Linking

**Locations:** `packages/model/src/CrossLinker.ts` (the linker) and `packages/pages/src/Build.ts` (the consumer).

Transforms type references in plain markdown text into clickable links. The `@tsdoctor/pages` builders cross-link descriptions, parameter docs, returns, deprecation notices and see-also references before parsing them to mdast, so a prose block enters the IR already linked. The phase-2 model redesign deleted the former `MarkdownCrossLinker` shell (`markdown/cross-linker.ts`); the adapter's later `prose-linker.ts` holder is deleted too (see [Instances](#instances)) — the linker is now constructed in `build-program.ts` and consumed in the pages package, with no adapter wiring between them.

### CrossLinker (the model class)

```typescript
class CrossLinker {
  static fromRoutes(routes: ReadonlyMap<string, string>): CrossLinker;
  static fromRefs(refs: ReadonlyArray<ApiItemRef>, routeFor: RouteFormatter): CrossLinker;
  static readonly empty: CrossLinker;  // identity: link(text) === text
  link(text: string): string;          // markdown [Name](/route) links
  linkHtml(text: string): string;      // <a href="…">Name</a> links
}
```

Immutable: built once per build from the precomputed name → route map
(`fromRoutes`, the pipeline path — member anchors and
namespace-qualified names already baked into the routes) or from item
refs plus an injected URL scheme (`fromRefs`). The class owns the
longest-first matching, word-boundary regex and backtick/existing-link
skipping, and (unlike the phase-1 library) has a first-class HTML
variant, `linkHtml`.

### The per-API linker in the pipeline context

`build-program.ts` builds `CrossLinker.fromRoutes(crossLinkData.routes)` once per API and passes it as `linker` in the pipeline input; `build-stages.ts` carries it on `GenerateSinglePageContext` and hands it to `buildPage` as `BuildPageInput.linker`. Inside `Build.ts` a private `linked(linker, text)` applies `linker.link` and parses the result as commonmark phrasing content. There is no module-level state on this path — the builder is an Effect run inside the pipeline fiber, which is what made the holder unnecessary.

One carried quirk, recorded in `doc-ir-and-pages.md`: the summary paragraph is NOT cross-linked, because no generator linked it and the golden gate cannot see a fix. Normalizing that is a product change for a labelled commit.

### Route map contents

The routes map maps display names to route paths:

- **Top-level items:** `"MyClass"` → `"/api/classes/myclass"`
- **Class/interface members:** `"MyClass.method"` → `"/api/classes/myclass#method"`

Member routes come from `ApiItems.memberRouteKeys()` and
`ApiItems.memberAnchors()` (`@tsdoctor/model`), so the `#fragment` a key
resolves to is the same one the page emits. Only classes and interfaces
register member routes. See [Member Anchors](#member-anchors) for the key
vocabulary and the static/instance rule.

---

## ShikiCrossLinker

**Location:** `src/shiki-transformer.ts`

Post-processes Shiki-generated HAST (Hypertext Abstract Syntax Tree) to
add clickable type reference links in syntax-highlighted code blocks,
including inside Twoslash hover tooltips.

### State

Two read-only maps, both for the one scope this instance links:

```typescript
private readonly apiItemRoutes: ReadonlyMap<string, string>;
private readonly classMembersMap: ReadonlyMap<string, ReadonlyArray<string>>;
public readonly apiScope: string;
```

An `apiItemKinds` map used to sit beside them. Its only consumer was `getSemanticClass`, a deprecated method that returned `null`, so seven call sites computed a class name that could only ever be null; the map, the method and the third `fromRoutes` parameter are all deleted. The `kinds` map that `prepareWorkItems` still builds is used where it is genuinely needed — arbitrating which kind owns a bare name via `crossLinkKindPriority`, before the routes map is finalized — and never reaches a linker.

`classMembersMap` groups member names by their parent class/namespace.
For example, if routes contain `"Logger.addTransport"`, the map stores
`"Logger"` → `["addTransport"]`, sorted by length descending.

### Interface

```typescript
class ShikiCrossLinker {
  static fromRoutes(
    routes: ReadonlyMap<string, string>,
    apiScope: string,
  ): ShikiCrossLinker;

  static readonly empty: ShikiCrossLinker;  // links nothing

  transformHast(hast: Root): Root;
}
```

There is no `reinitialize`, no `setApiScope` and **no scope parameter on
`transformHast`** — the caller picks the scope by picking the linker, which is
what `VfsRegistry.get(apiScope)` already does. Removing the parameter also
removed a 230-line duplicate `transformRoot` that existed only to serve the
scope-less overload.

### Three-Phase HAST Transformation

`transformHast()` walks the HAST tree in three phases per line:

#### Phase 1: Class/Namespace Member Linking

Maintains a `scopeStack` to track nested class, interface, and namespace
declarations. When inside a class body:

```text
class Logger {        ← push "Logger" onto scopeStack
  addTransport(): void;  ← check "Logger.addTransport" in routes
}                     ← pop scopeStack
```

Detects class/namespace boundaries by matching opening braces against
closing braces. When `currentScope` is set, attempts to match span
content as `${currentScope}.${content}` against the routes map.

#### Phase 2: Twoslash Tooltip Method Extraction

Finds `.twoslash-hover` spans and extracts method signatures from their
tooltip code blocks using regex:

```text
/^(?:\([^)]+\)\s+)?
  (?:(?:function|interface|class|enum|type|namespace|const|let|var)\s+)?
  ([A-Z]\w+)\.(\w+)[(:]/
```

This matches patterns like:

- `function Formatters.formatEntry(`
- `interface Formatters.Options`
- `(property) Logger.addTransport:`

When a match is found, the method name span is linked to the qualified
route `${className}.${methodName}`.

#### Phase 3a/3b: Type Reference Linking

Builds a regex pattern from all top-level type names (excluding dotted
member names) and processes:

- **3a:** Type references inside `.twoslash-hover` spans (tooltip type
  info).
- **3b:** Type references in regular code text.

The `linkTypeReferencesInLine()` helper walks element children, splits
text nodes at type reference boundaries, and inserts `<a>` elements
with class `api-type-link` and `data-api-processed` attribute.

Skips spans already processed by Phase 1 or 2 (detected via
`data-api-processed` attribute).

### Why Post-Processing?

A `createTransformer()` method that would have run DURING Shiki rendering existed, deprecated and returning a no-op; it is deleted. Cross-linking happens in post-processing via `transformHast()` because:

- Twoslash popup positioning depends on the original HAST structure.
- Modifying spans during rendering caused popup containers to shift or
  break.
- Post-processing the final HAST avoids these timing issues entirely.

---

## URL Generation

### Route Path Structure

Routes are constructed in `prepareWorkItems` (`build-stages.ts`):

```text
{baseRoute}/{categoryFolderName}/{itemDisplayName}

Examples:
  /api/classes/myclass
  /api/functions/createpipeline
  /api/interfaces/iconfig
  /api/enums/loglevel
  /api/types/options
  /api/variables/version
```

### Member Anchors

Class and interface members use fragment anchors:

```text
/api/classes/myclass#addtransport
/api/classes/myclass#instance-create
/api/interfaces/iconfig#timeout
```

Anchors come from `Routes.memberAnchors(members)` (`@tsdoctor/model`), reached
through `ApiItems.memberAnchors(item)`, which computes the anchor for **every**
member of a class in one pass and returns it keyed by the member's canonical
reference. `Routes.sanitizeId(displayName, prefix?)` is the underlying
spelling — lowercase, spaces/underscores → hyphens, other specials stripped —
and `Routes.memberAnchor(displayName, prefix?)` is the named alias for a
single member.

**Collisions.** When several members sanitize to the same anchor, the
highest-priority slot keeps the bare anchor and every other member is prefixed.
Priority runs static method, static property, instance method, getter, instance
property — static first, so the anchor agrees with the bare cross-link key,
which resolves to the static member. In practice TypeScript forbids two members
sharing a name within the same static-ness, so a collision is exactly one
static and one instance member and only `instance-` is ever emitted:
`static create()` keeps `#create` and the instance `create()` becomes
`#instance-create`.

The per-**member** keying is load-bearing. The previous adapter-side
implementation keyed its prefix map by sanitized **name**, so both halves of a
collision looked up the same entry and both rendered `id="static-create"` — two
elements sharing one HTML id, and the instance member displaced from the anchor
its own cross-link pointed at.

### Member Cross-Link Keys

`Routes.memberRouteKeys(className, members)`, reached through
`ApiItems.memberRouteKeys(item)`, decides which member a qualified name means:

| Key | Resolves to |
| --- | --- |
| `Registry.create` | the **static** member when the class has both; otherwise the only one |
| `Registry.(create:static)` | the static member, explicitly |
| `Registry.(create:instance)` | the instance member |
| `Registry.prototype.create` | an alias for the instance member |

`Registry.create` is the static access expression in TypeScript — the instance
one is `registry.create` — so a prose author writing the qualified form means
the static member. The disambiguating spellings are TSDoc declaration-reference
selectors, the vocabulary API Extractor canonical references already carry, and
`Registry.prototype.create` is real JavaScript rather than invented syntax.

`Class#member` is deliberately **not** emitted: `#` is the URL fragment
delimiter, so such a key reads ambiguously beside a route, and in modern
TypeScript `#` denotes a private field.

Selector keys are emitted **only** when a collision exists. On the
overwhelmingly common class with no collision the bare key is complete, and
every extra key is one more pattern the prose cross-linker compiles and tests
against every string it links.

### Companion Name Cross-Link Priority

When a `const Variable` and a `TypeAlias` share the same `displayName`
(the Effect Schema companion pattern), they live in **different** category
folders (`/variable/` vs. `/type/`) and are never a route collision. Two
distinct pages are generated.

A bare cross-link reference to the shared name (e.g., `Pipeline`)
resolves deterministically to one page via `crossLinkKindPriority`. Value
kinds win over type-only kinds:

1. Class, Function, Variable, Enum (value declarations -- highest priority)
2. Interface, TypeAlias (type-only declarations)
3. Namespace (lowest priority)

So a bare `Pipeline` link resolves to `/variable/pipeline` (the schema
`const`) rather than `/type/pipeline` (the TypeAlias). The cross-link
route always equals the generated file path (no suffix), so the two are
correlated by construction.

For items in different folders there is no ambiguity at the route level;
see `multi-entry-resolution.md` for the collision-detection rules that
govern items that *would* share a route.

### Synthetic base declarations

Unexported base declarations referenced by an exported class's extends clause (the `Foo_base` pattern from Effect `Schema.Class` / mixin factories — see `page-generation-system.md`) get no page of their own. Their name routes to the inline "Base Class" section on the owner class page:

```text
Person_base → /api/class/person#base-class
```

The anchor is `SyntheticBases.BASE_CLASS_ANCHOR` (`@tsdoctor/model`), matching the slug of the `## Base Class` heading the class page generator emits. The route is registered only when the base name is not already owned by a real page and the owner class has a route. Because both cross-linkers consume the same routes map, the underlined `Foo_base` in signature code blocks jumps to the inline section.

### Namespace Members

Namespace members use qualified names with the namespace prefix:

```text
/api/functions/formatters.formatentry
/api/interfaces/formatters.formatoptions
```

PascalCase members also get an unqualified route if no collision exists with a top-level item of the same name.

The generated file path matches this route by construction: `generateSinglePage` (`build-stages.ts`) rewrites a namespace member's route by replacing ONLY the final segment with the lowercased qualified name. A first-occurrence replace of the simple name would corrupt the category segment whenever a member's lowercased name equals its folder — e.g. a type alias `Type` in the `type` folder (the Effect Schema companion-namespace pattern, `CompilerOptions.Type`) previously landed at `<ns>.type/type` with colliding `_meta.json` entries. See `page-generation-system.md` (Stage 1) and the `qualified-alias` fixture regression test.

### Route Construction Code

```typescript
// Top-level item
const route = `${baseRoute}/${folderName}/${displayName.toLowerCase()}`;

// Class/interface members — anchors and keys from one model computation
const anchors = ApiItems.memberAnchors(item);
for (const [routeKey, memberId] of ApiItems.memberRouteKeys(item)) {
  routes.set(routeKey, `${itemRoute}#${anchors.get(memberId)}`);
}

// Namespace member (qualified)
const qualifiedRoute = `${baseRoute}/${folderName}/${qualifiedName.toLowerCase()}`;
```

---

## Type Matching Algorithm

### Longest-First Ordering

Both cross-linkers sort registered names by length descending before
matching. This prevents partial matches:

```text
Names: ["HookEvent", "Hook", "Event"]
Sorted: ["HookEvent", "Hook", "Event"]

Text: "Handles a HookEvent"
Match: "HookEvent" (not "Hook" + leftover "Event")
```

### Word Boundary Regex

```typescript
const regex = new RegExp(`\\b${name}\\b(?![a-zA-Z])`, "g");
```

- `\b` ensures the match starts and ends at a word boundary.
- `(?![a-zA-Z])` negative lookahead prevents matching "MyClass" inside
  "MyClassFactory".

### Conflict Avoidance

**Prose linking** (the model `CrossLinker`, via `Build.ts`'s `linked`):

- Skips matches inside existing markdown links (checks for `](` or `[`
  prefix before the match offset).
- Skips matches inside backtick code spans (odd backtick count).

**ShikiCrossLinker:**

- `data-api-processed` attribute prevents double-processing across
  phases.
- Dotted member names (e.g., `"Logger.addTransport"`) are filtered out
  of the Phase 3 regex pattern to avoid matching partial text. Only
  top-level names participate in generic type reference linking.
- Phase 1 handles dotted names via scope-stack context.
- Phase 2 handles dotted names via Twoslash tooltip parsing.

### Scope Isolation

The ShikiCrossLinker stores routes per API scope. When processing a
code block, the scope is determined by the file path or explicit
parameter. Routes from other scopes are not visible, preventing
false matches in multi-API builds.

---

## Backtick Code Span Safety

Both `CrossLinker.link` and the RSPress emitter's `escapeMdxGenerics` (`src/emit/mdx.ts`) detect backtick code spans and skip processing inside them. The backtick-safety logic for cross-linking lives in the `@tsdoctor/model` `CrossLinker`; the algorithm below describes its behavior. Note that since phase 5 the emitter applies generics escaping on the mdast tree (a `Text` run becomes `InlineCode`) rather than on a string — the code-span rule holds by construction there, since an existing code span is already an `InlineCode` node.

### Problem

Without backtick awareness, cross-linking could produce invalid MDX:

```text
Input:  `Pipeline<I, O>` processes data
Step 1: `[Pipeline](/api/classes/pipeline)<I, O>` processes data
Step 2: `[Pipeline](/api/classes/pipeline)`<I, O>`` processes data
         ^ MDX parser sees <I, O> as JSX tags → parse error
```

### Solution

The library cross-linker counts backtick characters before the match
offset. If the count is odd, the match is inside a code span:

```typescript
const backtickCount = (beforeMatch.match(/`/g) || []).length;
if (backtickCount % 2 === 1) {
  return match;  // Skip, inside code span
}
```

**`escapeMdxGenerics()`** splits text on code spans, applies escaping
only to plain-text segments:

```typescript
const parts = text.split(/(`[^`]+`)/g);
return parts.map((part) => {
  if (part.startsWith("`") && part.endsWith("`")) {
    return part;  // Code span, leave alone
  }
  return part.replace(/<([A-Z]...)>/g, "`<$1>`");
}).join("");
```

---

## Integration Points

### 1. Build Program Initialization

**Location:** `src/build-program.ts`

Cross-linkers are initialized in `generateApiDocs` using data from
`prepareWorkItems`:

```typescript
// prepareWorkItems builds routes and kinds maps
const { workItems, crossLinkData } = prepareWorkItems({ ... });

// Both cross-linkers share the same pre-built route map
const linker = CrossLinker.fromRoutes(crossLinkData.routes);   // → pipeline context
const shikiCrossLinker = ShikiCrossLinker.fromRoutes(
  crossLinkData.routes,
  apiScope,
);

// Register in VfsRegistry for remark plugin access. The highlighter comes
// from the runtime-lifetime HighlighterService, so it is never absent — the
// `if (highlighter)` guard this replaced could silently skip registration
// for a whole scope.
VfsRegistry.register(apiScope, {
  crossLinker: shikiCrossLinker,
  highlighter,
  packageName,
  apiScope,
  // ... other VFS config
});
```

### 2. Page building

**Location:** `packages/pages/src/Build.ts`, called from `generateSinglePage` (`src/build-stages.ts`)

The builders receive the linker as `BuildPageInput.linker` and link prose while converting it to mdast:

```typescript
// packages/pages/src/Build.ts
function linked(linker: CrossLinker, text: string): ReadonlyArray<PhrasingContent> {
  return phrasing(linker.link(text));
}
```

Cross-linking is applied to member summaries and returns, parameter descriptions, the deprecation notice, the function returns section, enum member descriptions, see-also references and namespace member-index summaries — and NOT to the summary paragraph (a carried generator quirk, see above).

### 3. Code Block Rendering

**Generated API docs** (`remark-api-codeblocks.ts`):

The plugin visits `ApiSignature`, `ApiMember` and `ApiExample` JSX nodes
emitted by the page generators, renders their `source` prop with Shiki,
then post-processes the HAST with the ShikiCrossLinker:

```typescript
const vfsConfig = VfsRegistry.get(apiScopeValue);
let hast = await generateShikiHast(source, vfsConfig.highlighter, ...);
if (hast && vfsConfig.crossLinker) {
  hast = vfsConfig.crossLinker.transformHast(hast);
}
```

The scope is chosen by the registry lookup, not by an argument — the retrieved
linker already links only that scope.

The resulting HAST is base64-encoded and injected back onto the JSX node
as a `hast` prop for browser rendering.

**User-authored code blocks** (`remark-with-api.ts`):

```` ```typescript with-api ```` code blocks are processed by the
`remarkWithApi` remark plugin using the same VfsRegistry lookup and
`transformHast()` post-processing.

---

## VfsRegistry

**Location:** `src/vfs-registry.ts`

The `VfsRegistry` connects the ShikiCrossLinker to remark plugins by
storing per-scope `VfsConfig` objects:

```typescript
interface VfsConfig {
  highlighter: Highlighter;
  crossLinker?: ShikiCrossLinker;
  twoslashTransformer?: ShikiTransformer;
  hideCutTransformer?: ShikiTransformer;
  hideCutLinesTransformer?: ShikiTransformer;
  packageName: string;
  apiScope: string;
  theme?: ShikiThemeConfig;
}
```

The `vfs` field is **gone**. It had one production write (`new Map()`) and zero
reads, and its declared type had rotted into a map of maps — a `Vfs`
is itself a `Map<string, string>`.

**Key methods:**

- `register(apiScope, config)` -- Store config by scope
- `get(apiScope)` -- Retrieve by scope (used by remark plugins)
- `clear()` -- Drop every entry, called at the start of each build

`getByFilePath` is **deleted**. It had zero production callers because
`remark-with-api.ts`'s `inferApiScope` is a byte-identical reimplementation of
its path→scope regex; the original was orphaned rather than falling out of use.
Which module should own path→scope inference is a deliberate design question
still open — note that `inferApiScope` matches `docs/en/{api}/`, a shape **no
fixture site uses**, so cross-linking inside `remark-with-api` has never fired
in a fixture build.

---

## Testing

| Subject | Test file |
| --- | --- |
| `CrossLinker` (`link`, `linkHtml`, matching/backtick behavior) | `packages/model/__test__/cross-linker.test.ts`, `cross-linker-behavior.test.ts` |
| Builders linking prose into the IR | `packages/pages/__test__/build.test.ts` |
| ShikiCrossLinker (three-phase HAST transform, scope isolation) | `platforms/rspress/__test__/shiki-transformer.test.ts` |
| VfsRegistry (scope registration, `clear`) | `platforms/rspress/__test__/vfs-registry.test.ts` |
| Member anchor / page-id agreement (runs `prepareWorkItems` → `buildPage` → `emitMdxBody` and reads the ids from the emitted MDX) | `platforms/rspress/__test__/markdown/anchor-invariant.test.ts` |
| `Routes.memberAnchors` / `memberRouteKeys` | `packages/model/__test__/routes.test.ts` |

---

## File Locations

| File | Purpose |
| --- | --- |
| `packages/model/src/CrossLinker.ts` | The immutable `CrossLinker` class (`fromRoutes`/`fromRefs`/`empty`/`link`/`linkHtml`) |
| `packages/model/src/Routes.ts` | `RouteCandidate`, `detectCollisions`, `RouteCollisionError`, `sanitizeId`, `memberAnchor`, `memberAnchors`, `memberRouteKeys`, `MemberRef`/`MemberSlot` |
| `packages/model/src/ApiItems.ts` | `memberAnchors(item)` / `memberRouteKeys(item)` — the `ApiItem` view of the above |
| `packages/model/src/SyntheticBases.ts` | `SyntheticBases.detect` + `BASE_CLASS_ANCHOR` |
| `src/shiki-transformer.ts` | ShikiCrossLinker class + HAST transformation |
| `src/vfs-registry.ts` | VfsRegistry connecting cross-linker to remark |
| `packages/pages/src/Build.ts` | The `ApiItem` → `Page` builders that consume the prose `CrossLinker` |
| `src/build-program.ts` | Per-API `CrossLinker.fromRoutes` and `ShikiCrossLinker.fromRoutes` construction |
| `src/build-stages.ts` | Route/kinds map construction in prepareWorkItems |
| `src/emit/mdx.ts` | `escapeMdxGenerics()` with backtick safety, and its mdast-tree form the emitter applies |
| `src/remark-api-codeblocks.ts` | Generated code block cross-linking |
| `src/remark-with-api.ts` | User-authored code block cross-linking |

---

## Future Enhancements

### Potential Improvements

1. **External package linking** -- Link to npm/TypeDoc documentation
   for types from external packages
2. **Conditional exports linking** -- Handle TypeScript conditional
   exports in cross-link resolution
3. **Broken link detection** -- Warn when a cross-linked route does
   not correspond to a generated page
4. **Regex caching** -- Pre-compile and cache the per-name regexes
   for large APIs

### Known Limitations

1. **No external package links** -- Only types from the documented
   package are linked; external types (e.g., `ZodType`) are not
   cross-linked
2. **Sanitization duplication — GENUINELY RETIRED (2026-08-25).** An earlier
   revision of this document claimed this hazard was retired when only the
   route side had been unified; the adapter still carried a second, subtly
   different `sanitizeId` in `markdown/helpers.ts` for page-side HTML `id=`
   attributes. It kept `_` (which is in `\w`) and mapped `$` to `-`, while the
   route side mapped `_` to `-` and deleted `$`. **Every class or interface
   member whose name contained `_` or `$` therefore had a cross-link that
   landed nowhere** — `get_value` was linked as `#get-value` and rendered as
   `id="get_value"`. The page-side helper is now deleted and both sides call
   `Routes`; the invariant is pinned by `__test__/markdown/anchor-invariant.test.ts`.
   Do not add a second spelling: if page ids ever genuinely need different
   treatment from route anchors, that is a design change, not a local helper.
3. **HTML cross-links in tooltips** -- Phase 2 Twoslash tooltip parsing
   uses a regex that may not match all TypeScript declaration forms
4. **Prose-linker race — FIXED (2026-09-02, phase 5).** The module-level `prose-linker.ts` holder was installed per API while `generateApiDocs` ran concurrently, so a page could be linked against another API's route map (see [Instances](#instances) for the two fixture pages it mislinked). The linker now travels per API in the pipeline context. Do not reintroduce a module-level prose linker: anything the builders need reaches them as a value on `BuildPageInput`.

---

## Related Documentation

- **Page Generation System:**
  `page-generation-system.md` -- Stream pipeline using cross-link data
- **Doc IR and `@tsdoctor/pages`:**
  `doc-ir-and-pages.md` -- the builders that consume the prose linker, and the golden gate that surfaced the race
- **SSG Compatible Components:**
  `ssg-compatible-components.md` -- Runtime components rendering
  cross-linked code blocks
- **Import Generation System:**
  `import-generation-system.md` -- Type reference extraction
- **Multi-Entry Resolution:**
  `multi-entry-resolution.md` -- Route collision detection and companion-pattern routing
- **Build Architecture:**
  `build-architecture.md` -- Service layer and plugin structure

### External Resources

- Shiki documentation: <https://shiki.style/>
- HAST specification: <https://github.com/syntax-tree/hast>
- RSPress plugin development: <https://rspress.dev/plugin/>
