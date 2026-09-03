---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/effect-service-layer.md
  - rspress-plugin-api-extractor/plugin-lifecycle.md
  - rspress-plugin-api-extractor/configuration-system.md
  - rspress-plugin-api-extractor/build-tooling.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
---

# Build architecture

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [The four halves](#the-four-halves)
- [Core package consumption](#core-package-consumption)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

`rspress-plugin-api-extractor` (`platforms/rspress/`) is a thin RSPress adapter over the seven `@tsdoctor/*` core packages. It has two emitted halves — a Node.js plugin that generates pages during RSPress's `config()` hook and a browser-side React runtime that renders them — and an Effect service layer that orchestrates generation. `plugin.ts` wires RSPress lifecycle hooks to Effect services and delegates every step of doc generation to `build-program.ts` and `build-stages.ts`.

This document is the map. The subsystems it used to describe in one place now each have their own doc, linked under [The four halves](#the-four-halves).

## Current state

| Concern | Where it lives |
| --- | --- |
| RSPress adapter and runtime management | `src/plugin.ts` |
| Doc generation orchestration | `src/build-program.ts`, `src/build-stages.ts` |
| Services, layers and per-build references | `src/services/`, `src/layers/`, `src/BuildEnv.ts` |
| Configuration schemas and resolution | `src/schemas/`, `src/layers/config-resolution.ts`, `src/config-helpers.ts`, `src/config-utils.ts` |
| Emitters over the page IR | `src/emit/mdx.ts`, `src/emit/meta.ts` |
| Remark plugins for code blocks | `src/remark-with-api.ts`, `src/remark-api-codeblocks.ts` |
| React runtime | `src/runtime/` |
| Observability | `src/observability/`, `src/layers/observability.ts` |
| Build script and dev server runner | `savvy.build.ts`, `src/serve.ts` |

`src/index.ts` is the package's only barrel. There are no barrel modules inside `src/`: every internal import names a concrete module, so a reachability check sees real consumers rather than a re-export that counts as one.

## The four halves

- **[Effect service layer](effect-service-layer.md)** — the `Context.Service` pattern, the tiered layer stack in `layers/AppLayer.ts`, the two `ManagedRuntime`s, the per-build `Context.Reference`s and the Effect v4 dependency closure.
- **[Plugin lifecycle](plugin-lifecycle.md)** — hook execution order, the doc generation program run from `config()`, the build program's stages, runtime disposal and the `.api-docs/` artifact directories.
- **[Configuration system](configuration-system.md)** — the option schemas, the inert configuration path, the `fromDir` config helpers and `ConfigService.resolve`.
- **[Build tooling](build-tooling.md)** — the per-file plugin build and bundleless runtime, the output roots and workspace link, the published tsconfig and the `serve` runner.

## Core package consumption

The adapter depends on all seven core workspaces via `workspace:*`. What it takes from each:

| Package | What the adapter consumes |
| --- | --- |
| `@tsdoctor/model` | `Model.load` (typed load failures emit `ModelLoadFailed`), the `Tsdoc` / `ApiItems` / `EntryPoints` / `Routes` / `SyntheticBases` / `Signature` namespaces, the `CrossLinker`, `ApiExtractedPackage`, `TypeReferenceExtractor` and the `Frontmatter` contract (`parseFrontmatter` / `emitFrontmatterBlock`) |
| `@tsdoctor/vfs` | The `Vfs` currency type, `VirtualPackage`, `TsEnvironment`, the compiler-options seam and the Twoslash result cache (`type-loading-vfs.md`, `render-phase-instrumentation.md`) |
| `@tsdoctor/registry` | External type loading into a `Vfs`, behind `services/TypeRegistryService.ts` |
| `@tsdoctor/bundle` | `discoverBundle` for the config helpers, plus the npm-tarball and GitHub-release fetchers (`bundle-spec.md`) |
| `@tsdoctor/snapshot` | `SnapshotService` and the content hashers (`snapshot-tracking-system.md`) |
| `@tsdoctor/seo` | `deriveSiteUrl`, `attributionFacts`, `packageContext`, `deriveScriptBody` and `headTags` — every `<head>` decision (`structured-data-and-og.md`) |
| `@tsdoctor/pages` | `prepareWorkItems`, `buildPage` / `buildIndexPage`, `buildNav`, example preparation, the scope helpers and the llms.txt text transforms (`doc-ir-and-pages.md`) |

`Routes.sanitizeId` is the single anchor algorithm: `Routes.memberAnchors` / `memberRouteKeys` (and the `ApiItems` views of them) own member anchors and cross-link keys. The adapter never spells a second one (`cross-linking-architecture.md`).

`ApiExtractedPackage` keeps its own private `extractPlainText`, which is a different algorithm from the model's prose extraction: it preserves `{@link X.Y}` syntax and reconstructs fenced code blocks for `.d.ts` output, whereas prose extraction flattens links to display text and drops fences. The two are not interchangeable.

What the adapter keeps for itself is the RSPress-shaped work: emission (`src/emit/`), the remark and HAST pipeline, the React runtime, lifecycle wiring, the observability cluster and product policy such as `category-resolver.ts` and `path-derivation.ts` (the `docs/{locale}/{version}/…` layout).

## Rationale

- **Why the adapter is thin:** every framework-neutral concern that lived here has been carved into a core package so a second adapter (`platforms/vitepress/`) imports it rather than reimplementing it. The coupling analysis behind that split is in `tsdoctor-package-architecture.md`.
- **Why generation happens in `config()` rather than `beforeBuild`:** RSPress scans routes before `beforeBuild`, so pages written there would not be routed on a cold start. `plugin-lifecycle.md` records the hook order.
- **Why no internal barrels:** a barrel counts as a consumer of everything it re-exports and hides unused exports from every reachability check; removing the two the adapter had immediately surfaced an orphan the first dead-code scan had scored as live.

## Related documentation

- **Effect service layer:** `effect-service-layer.md`
- **Plugin lifecycle:** `plugin-lifecycle.md`
- **Configuration system:** `configuration-system.md`
- **Build tooling:** `build-tooling.md`
- **Page generation system:** `page-generation-system.md`
- **Doc IR and `@tsdoctor/pages`:** `doc-ir-and-pages.md`
- **Package architecture:** `tsdoctor-package-architecture.md`
