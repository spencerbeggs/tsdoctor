---
status: current
module: rspress-plugin-api-extractor
category: cross-linking
created: 2026-01-17
updated: 2026-08-25
last-synced: 2026-08-25
completeness: 90
related:
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/ssg-compatible-components.md
  - rspress-plugin-api-extractor/import-generation-system.md
  - rspress-plugin-api-extractor/multi-entry-resolution.md
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

1. **Markdown text** -- the immutable `CrossLinker` from
   `@tsdoctor/model`, installed per build through the
   `markdown/prose-linker.ts` holder, replaces type names in prose
   descriptions with `[TypeName](/route)` links during page generation.
2. **Code blocks** -- `ShikiCrossLinker` post-processes Shiki HAST
   output to wrap type identifiers in `<a>` tags, including inside
   Twoslash hover tooltips.

Both are installed once per API scope during the build and shared across
all page generators and remark plugins — the prose side via a
module-level holder (page generators run synchronously outside any
service context), the code side via the `VfsRegistry`.

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
  ├─> Build kinds Map: typeName → apiItemKind
  └─> Return crossLinkData: { routes, kinds }
         │
         ├─> setProseLinker(crossLinkData.routes)
         │     Installs CrossLinker.fromRoutes(routes) in the
         │     prose-linker holder; both cross-linkers share the
         │     single route map
         │
         ├─> shikiCrossLinker.reinitialize(routes, kinds, apiScope)
         │     Stores routes/kinds per scope, builds classMembersMap
         │
         └─> VfsRegistry.register(apiScope, { crossLinker: shikiCrossLinker, ... })
               Makes cross-linker available to remark plugins

Page generation (page-generators/*.ts)
  └─> linkProse(descriptionText)
        Markdown text → markdown text with [TypeName](/route) links

Code block rendering (remark-api-codeblocks.ts)
  └─> shikiCrossLinker.transformHast(hast, apiScope)
        HAST → HAST with <a> anchors on type references
```

Both cross-linkers consume the same `crossLinkData.routes` map built once in `prepareWorkItems`, so a given name resolves to the same page in prose and in code blocks.

### Instances

```typescript
// src/markdown/prose-linker.ts — module-level holder
let current: CrossLinker = CrossLinker.empty;

// src/shiki-transformer.ts — instantiated per plugin call
const shikiCrossLinker = new ShikiCrossLinker();
```

The prose side is a module-level holder over the immutable model
`CrossLinker` (swapped per build). The `ShikiCrossLinker` is created per
plugin instantiation and passed into the `VfsRegistry` for scope-keyed
retrieval by remark plugins.

---

## Prose Cross-Linking

**Locations:** `packages/model/src/CrossLinker.ts` (the linker) and
`platforms/rspress/src/markdown/prose-linker.ts` (the adapter holder).

Transforms type references in plain markdown text into clickable links.
Used by page generators to cross-link descriptions, parameter docs, and
remarks. The phase-2 model redesign deleted the former
`MarkdownCrossLinker` shell (`markdown/cross-linker.ts`); the plugin now
consumes the `@tsdoctor/model` `CrossLinker` class directly through a
15-line holder — adapter wiring, not logic.

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

### The prose-linker holder

```typescript
// src/markdown/prose-linker.ts
export function setProseLinker(routes: ReadonlyMap<string, string>): void;
export function clearProseLinker(): void;  // reset to CrossLinker.empty
export function linkProse(text: string): string;
```

`build-program.ts` calls `setProseLinker(crossLinkData.routes)` per API
build; page generators call `linkProse(text)`. Page generators run
synchronously outside any service context, hence the module-level
holder — the same shape as the sync-island event emitters
(`performance-observability.md`).

### Route map contents

The routes map maps display names to route paths:

- **Top-level items:** `"MyClass"` → `"/api/classes/myclass"`
- **Class/interface members:** `"MyClass.method"` → `"/api/classes/myclass#method"`

Member routes use `Routes.sanitizeId()` (`@tsdoctor/model`) for the
anchor fragment. Only classes and interfaces register member routes.

---

## ShikiCrossLinker

**Location:** `src/shiki-transformer.ts`

Post-processes Shiki-generated HAST (Hypertext Abstract Syntax Tree) to
add clickable type reference links in syntax-highlighted code blocks,
including inside Twoslash hover tooltips.

### State

Three scope-indexed Maps for multi-API isolation:

```typescript
private apiItemRoutesByScope: Map<string, Map<string, string>>;
private apiItemKindsByScope: Map<string, Map<string, string>>;
private classMembersMapByScope: Map<string, Map<string, string[]>>;
```

`classMembersMap` groups member names by their parent class/namespace.
For example, if routes contain `"Logger.addTransport"`, the map stores
`"Logger"` → `["addTransport"]`, sorted by length descending.

### Interface

```typescript
class ShikiCrossLinker {
  reinitialize(
    routes: Map<string, string>,
    kinds: Map<string, string>,
    apiScope: string,
  ): void;

  setApiScope(apiScope: string): void;

  transformHast(hast: Root, apiScope?: string): Root;
}
```

### Three-Phase HAST Transformation

`transformHast()` delegates to `transformRootWithScope()`, which walks
the HAST tree in three phases per line:

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

The `createTransformer()` method (which would run during Shiki
rendering) is deprecated and returns a no-op. Cross-linking was moved
to post-processing via `transformHast()` because:

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
/api/classes/myclass#static-create
/api/interfaces/iconfig#timeout
```

Anchor IDs are generated by `Routes.sanitizeId(displayName, prefix?)`
from `@tsdoctor/model`: lowercase, spaces/underscores → hyphens, strip
special chars, optional prefix for disambiguation (e.g., `"static"`).

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

// Class/interface member
const memberRoute = `${itemRoute}#${Routes.sanitizeId(memberName)}`;

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

**Prose linking** (the model `CrossLinker` behind `linkProse`):

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

Both the cross-linking path behind `linkProse()` and the `escapeMdxGenerics()` helper detect backtick code spans and skip processing inside them. The backtick-safety logic for cross-linking lives in the `@tsdoctor/model` `CrossLinker`; the algorithm below describes its behavior.

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
setProseLinker(crossLinkData.routes);
shikiCrossLinker.reinitialize(
  crossLinkData.routes,
  crossLinkData.kinds,
  apiScope,
);

// Register in VfsRegistry for remark plugin access
VfsRegistry.register(apiScope, {
  crossLinker: shikiCrossLinker,
  highlighter,
  packageName,
  apiScope,
  // ... other VFS config
});
```

### 2. Page Generation

**Location:** `src/markdown/page-generators/*.ts`

All page generators import `linkProse` from the prose-linker holder and
apply cross-linking to description text:

```typescript
import { linkProse } from "../prose-linker.js";

// In generator methods:
const summary = linkProse(rawSummary);
const description = linkProse(rawDescription);
```

Cross-linking is applied to:

- Class/interface summaries and remarks
- Constructor and method parameter descriptions
- Property descriptions
- Return type descriptions
- `@see` and `@link` tag content

### 3. Code Block Rendering

**Generated API docs** (`remark-api-codeblocks.ts`):

The plugin visits `ApiSignature`, `ApiMember` and `ApiExample` JSX nodes
emitted by the page generators, renders their `source` prop with Shiki,
then post-processes the HAST with the ShikiCrossLinker:

```typescript
const vfsConfig = VfsRegistry.get(apiScopeValue);
let hast = await generateShikiHast(source, vfsConfig.highlighter, ...);
if (hast && vfsConfig.crossLinker) {
  hast = vfsConfig.crossLinker.transformHast(hast, apiScopeValue);
}
```

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
  vfs: Map<string, VirtualFileSystem>;
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

**Key methods:**

- `register(apiScope, config)` -- Store config by scope
- `get(apiScope)` -- Retrieve by scope (used by remark plugins)
- `getByFilePath(filePath)` -- Extract scope from file path and
  retrieve (used for user-authored code blocks)

---

## Testing

| Subject | Test file |
| --- | --- |
| `CrossLinker` (`link`, `linkHtml`, matching/backtick behavior) | `packages/model/__test__/cross-linker.test.ts`, `cross-linker-behavior.test.ts` |
| ShikiCrossLinker (three-phase HAST transform, scope isolation) | `platforms/rspress/__test__/shiki-transformer.test.ts` |
| VfsRegistry (scope registration, `getByFilePath`) | `platforms/rspress/__test__/vfs-registry.test.ts` |

---

## File Locations

| File | Purpose |
| --- | --- |
| `packages/model/src/CrossLinker.ts` | The immutable `CrossLinker` class (`fromRoutes`/`fromRefs`/`empty`/`link`/`linkHtml`) |
| `packages/model/src/Routes.ts` | `RouteCandidate`, `detectCollisions`, `RouteCollisionError`, `sanitizeId` |
| `packages/model/src/SyntheticBases.ts` | `SyntheticBases.detect` + `BASE_CLASS_ANCHOR` |
| `src/markdown/prose-linker.ts` | Module-level prose-linker holder (`setProseLinker`/`linkProse`) |
| `src/shiki-transformer.ts` | ShikiCrossLinker class + HAST transformation |
| `src/vfs-registry.ts` | VfsRegistry connecting cross-linker to remark |
| `src/build-program.ts` | Cross-linker initialization |
| `src/build-stages.ts` | Route/kinds map construction in prepareWorkItems |
| `src/markdown/helpers.ts` | `escapeMdxGenerics()` with backtick safety |
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
2. **Sanitization duplication — RETIRED** -- the hazard of `sanitizeId()`
   logic duplicated between `build-stages.ts` and the cross-linker is
   gone: `Routes.sanitizeId` (`@tsdoctor/model`) is now the single
   route-side sanitizer used for member anchor routes. (The separate
   `sanitizeId` in `markdown/helpers.ts` remains for page-side HTML ids
   — a different concern with a slightly different algorithm, unchanged
   from before.)
3. **HTML cross-links in tooltips** -- Phase 2 Twoslash tooltip parsing
   uses a regex that may not match all TypeScript declaration forms

---

## Related Documentation

- **Page Generation System:**
  `page-generation-system.md` -- Stream pipeline using cross-link data
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
