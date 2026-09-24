---
type: Decision
status: stable
title: Core packages, thin adapters
description: Frame-neutral logic lives in packages/; each platforms/* adapter is thin and owns only what a static-site framework forces it to own.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 1a325a365d8cef075d95115c8bfe0de96ca4d76c531a2337696b2e235b3bd765
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# Core packages, thin adapters

## Context

The `@tsdoctor` org needs more than one static-site adapter —
`rspress-plugin-api-extractor` first, `vitepress-plugin-api-extractor`
second — without either duplicating the other's logic. Something has to
decide, module by module, whether a piece of code belongs in a
framework-neutral `packages/*` workspace or stays inside the adapter that
first needed it.

## Decision

Coupling is counted from inside the code — references to `@rspress`,
`shiki`, `hast`, `react` and the like — not judged by file name. Framework
coupling in the RSPress adapter is confined to three areas, and everything
else is core:

1. **The runtime React components** — SSG-MD dual-mode rendering and
   Twoslash tooltips under `platforms/rspress/src/runtime/`. VitePress is
   Vue; none of this ports.
2. **The remark and HAST pipeline** — `remark-with-api.ts`,
   `remark-api-codeblocks.ts` and the Shiki cross-linker post-processing.
   VitePress uses markdown-it and ships first-class native Twoslash, so
   its adapter integrates with that pipeline instead of porting this one.
3. **Lifecycle wiring** — the RSPress hooks in `platforms/rspress/src/plugin.ts`
   and the llms.txt post-processing I/O.

An adapter receives from core: resolved API models (loaded, categorized,
multi-entry-resolved, synthetic bases applied); the cross-link route map;
the page IR — work items, the `ApiItem` → `Page` builders and the nav
tree; the VFS primitives and TypeScript environment populated with
resolved external types; snapshot decisions and per-page metadata; and
every `<head>` tag as a neutral `HeadTag[]`. An adapter owns: its
component layer; code-block rendering integration; framework lifecycle
wiring; framework-specific SEO and llms.txt injection points.

**A file whose boundary is already proven by an import crossing it does
not wait for a second consumer.** The "wait for two consumers before
extracting" rule exists to stop abstractions being designed
speculatively; it does not apply once coupling has already been measured
from inside the code.

Candidates already taken into core under this reasoning: the api-model
pair (`ApiExtractedPackage`, `TypeReferenceExtractor`[^1]) and
`Frontmatter.ts`[^2] into `@tsdoctor/model`; the compiler-options pair
into `@tsdoctor/vfs`, following `TsEnvironment`; the llms.txt transforms,
the scope helpers, `prepareWorkItems` and the page generators into
`@tsdoctor/pages`; the Twoslash result cache into `@tsdoctor/vfs` once
both adapters wired the same `TwoslashTypesCache` interface; the OG and
canonical helpers into `@tsdoctor/seo`; the `tsdoctor.json` manifest
schema out of `@tsdoctor/bundle` into `@tsdoctor/manifest`.

Two files were deliberately kept in the RSPress adapter rather than moved,
on the same coupling-from-inside reasoning:

- `platforms/rspress/src/category-resolver.ts`[^3] — it merges full
  category configs across a plugin/package/version precedence chain,
  which is sidebar presentation plus multiVersion product policy; the
  neutral half already exists as `ApiItems.CategorySpec` in the model.
- `platforms/rspress/src/path-derivation.ts`[^4] — the
  `docs/{locale}/{version}/…` output layout is indistinguishable from
  RSPress's own conventions from inside this repository — exactly the
  case the two-consumer rule protects.

The observability cluster (`platforms/rspress/src/observability/`) stays
adapter-side as infrastructure rather than logic; whether a second
adapter needs equivalent diagnostics is a later question, not a coupling
question.

The adapter that ships from this consolidation keeps the npm name
`rspress-plugin-api-extractor`[^5] — name equity — even though what is
inside it has shrunk to the RSPress-specific residue.

**The next tier of duplication, measured by building
`vitepress-plugin-api-extractor` and not yet taken:**
`platforms/vitepress/src/Generate.ts`[^6] re-spells the neutral half of
RSPress's `layers/config-resolution.ts`[^7] (import prepending, dependency
extraction, tsconfig resolution, manifest decode to `packageContext`);
`platforms/vitepress/src/Categories.ts`[^8] duplicates `DEFAULT_CATEGORIES`
and the override merge, and the two must stay in step or the adapters
generate different routes from one bundle; `platforms/vitepress/src/Registry.ts`[^9]
duplicates the registry-stack composition and the `"tsdoctor"` XDG
namespace literal; and RSPress's `hide-cut-transformer.ts`[^10]
hand-matches `// ---cut---` instead of using `@tsdoctor/pages`'s directive
helpers. None of these has a destination package yet.

An unscheduled idea sits beside this list: a `@tsdoctor/cli` scaffolding
binary on `effect/unstable/cli` — no phase, no gate, not committed to.

## Alternatives rejected

- **Wait for a third consumer before moving anything in the next-tier
  list.** Rejected as the default rule, but not yet overridden for these
  four files either — they are recorded as measured duplication, not
  moved, because no destination package has been decided. The "already
  proven by an import" exception applies to files whose boundary a single
  import already demonstrates, not to product-policy code like
  `category-resolver.ts`.
- **Move `category-resolver.ts` and `path-derivation.ts` into core
  regardless.** Rejected: both encode presentation and layout policy that
  is, from inside this repository, indistinguishable from RSPress's own
  conventions — the exact case the two-consumer rule is designed to
  catch.
- **Rename the published adapter package to something `@tsdoctor`-shaped.**
  Rejected: the RSPress adapter role changes what is inside the package,
  not what consumers already install it as.

## Consequences

- Adding logic to an adapter that a second adapter will also need is a
  standing invitation to re-derive this coupling analysis, not a decision
  to skip it because "there's only one consumer so far."
- The four next-tier duplications are a known, accepted cost until a
  destination package is chosen; changing `DEFAULT_CATEGORIES` in one
  adapter without the other silently diverges the routes the two adapters
  generate from the same bundle.
- A third adapter, or the 1.0 stabilization pass, is expected to resolve
  the next-tier list from measurement already on record rather than
  re-measuring coupling from scratch.

[^1]: [packages/model/src/ApiExtractedPackage.ts](../../packages/model/src/ApiExtractedPackage.ts)
[^2]: [packages/model/src/Frontmatter.ts](../../packages/model/src/Frontmatter.ts)
[^3]: [platforms/rspress/src/category-resolver.ts](../../platforms/rspress/src/category-resolver.ts)
[^4]: [platforms/rspress/src/path-derivation.ts](../../platforms/rspress/src/path-derivation.ts)
[^5]: [platforms/rspress/package.json](../../platforms/rspress/package.json)
[^6]: [platforms/vitepress/src/Generate.ts](../../platforms/vitepress/src/Generate.ts)
[^7]: [platforms/rspress/src/layers/config-resolution.ts](../../platforms/rspress/src/layers/config-resolution.ts)
[^8]: [platforms/vitepress/src/Categories.ts](../../platforms/vitepress/src/Categories.ts)
[^9]: [platforms/vitepress/src/Registry.ts](../../platforms/vitepress/src/Registry.ts)
[^10]: [platforms/rspress/src/hide-cut-transformer.ts](../../platforms/rspress/src/hide-cut-transformer.ts)
