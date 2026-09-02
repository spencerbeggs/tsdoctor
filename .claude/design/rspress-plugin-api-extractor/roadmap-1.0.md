---
status: draft
module: rspress-plugin-api-extractor
category: meta
created: 2026-08-24
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 80
related:
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/monorepo-consolidation.md
  - rspress-plugin-api-extractor/bundle-spec.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/llms-integration.md
  - rspress-plugin-api-extractor/render-phase-instrumentation.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
dependencies: []
---

# Road to 1.0.0

> **Forward-looking document.** This doc records PLANNED work, not the current implementation. Nothing described here exists yet unless explicitly marked done — **phases 1 through 4 are complete** (phase 1 merged via PR #163 and shipped to npm on 2026-08-24; phase 2 code complete 2026-08-24; phase 3 complete 2026-08-25, landed on `feat/phase-3`; phase 4 complete 2026-08-26, landed on `feat/phase-4` — see `monorepo-consolidation.md`, `render-phase-instrumentation.md` and `structured-data-and-og.md`). For the current architecture, see `build-architecture.md`. Decisions listed under each phase were settled in the 2026-08-24 planning session (phase 3's instrument-first sequencing included) and should be treated as settled unless a section explicitly labels them open.

## Table of Contents

- [Overview](#overview)
- [Current State](#current-state)
- [The 1.0 Definition](#the-10-definition)
- [Phases](#phases)
  - [Phase 1 — Consolidation](#phase-1--consolidation)
  - [Phase 2 — Carve the Core](#phase-2--carve-the-core)
  - [Phase 3 — Instrumentation, then Scoping and Performance](#phase-3--instrumentation-then-scoping-and-performance)
  - [Interlude — Pre-Phase-4 Adapter Refactor](#interlude--pre-phase-4-adapter-refactor)
  - [Phase 4 — SEO Layer](#phase-4--seo-layer)
  - [Phase 5 — VitePress Adapter and Doc IR](#phase-5--vitepress-adapter-and-doc-ir)
  - [Phase 6 — 1.0](#phase-6--10)
- [Deferred Design Docs](#deferred-design-docs)
- [Rationale](#rationale)
- [Related Documentation](#related-documentation)

## Overview

This is the umbrella roadmap for taking `rspress-plugin-api-extractor` to 1.0.0 while consolidating its two external support libraries into this monorepo under the new `@tsdoctor` npm org (registered by the owner; the namespace was clear — no `@tsdoctor/*` packages published, bare `tsdoctor` unclaimed — and the in-repo consolidation of both libraries has now been executed as phase 1). The long-term goal is to generalize from an RSPress-specific plugin into a shared toolkit for static TypeScript documentation sites — VitePress 2.x for certain, possibly Docusaurus 3.x later — with LLM-first documentation (llms.txt, clean programmatic docs for agents) and proper SEO for human and agent crawlers as core missions. The fundamental contract: "give us an api.json and we transform it into static docs."

The target package architecture (what each `@tsdoctor/*` package contains and where its code comes from) is detailed in `tsdoctor-package-architecture.md`. The phase 1 migration mechanics are detailed in `monorepo-consolidation.md`.

## Current State

As of 2026-09-02, **phases 1 through 4 are complete**, plus the Tier 1 core moves:

- The `@tsdoctor` npm org is registered and the first releases under it have shipped from this repo to npm and GitHub Releases: `@tsdoctor/registry@0.1.0`, `@tsdoctor/model@0.1.0` and `rspress-plugin-api-extractor@0.8.9`, tagged in the `<package>@<version>` format.
- The old npm packages `type-registry-effect` and `api-extractor-llms` are deprecated with pointers to their successors, and their GitHub repos are archived.
- `@tsdoctor/registry` exists at `packages/registry` (the former sibling-repo `type-registry-effect@2.3.5`, moved in verbatim and renamed; fresh 0.x version line, released at 0.1.0), consumed by the plugin via `workspace:*` in six files (see `monorepo-consolidation.md`).
- `@tsdoctor/model` exists at `packages/model` (seeded verbatim from the sibling-repo `api-extractor-llms@0.2.0`, same public API; fresh 0.x line, released at 0.1.0); the plugin's four thin shims were initially kept with only their import specifiers repointed — the model-API-shape decision was then resolved (redesign) and the shim collapse **executed in phase 2** (see "Core Package Consumption" in `build-architecture.md`).
- The workspace-layout open question was resolved: the plugin workspace moved from `package/` to `platforms/rspress/` (core libraries under `packages/`, framework adapters under `platforms/`).
- The phase 1 gate held: full monorepo build green (26 Turbo tasks), typecheck green, 1,236 tests / 0 failures (the plugin's ~1,033 plus the two libraries' suites).
- **Phase 2 is code complete** (landed on `feat/tsdoctor-phase-2`, 2026-08-24, releases pending): `@tsdoctor/bundle` and `@tsdoctor/snapshot` exist, the model was redesigned to Effect v4 modules with the shims collapsed, the identity renames executed, and `gray-matter` replaced — see the phase 2 section below.
- **Phase 3 is complete** (landed on `feat/phase-3`, 2026-08-25): render-phase code-block time is now attributed per scope and per code block via dimensional Effect metrics, and the resulting data decided fix priority — a persisted Twoslash result cache (fix (a)) shipped as the performance work, and per-scope TypeScript environments (fix (b)) shipped as the `with-api` scoping correctness fix the data gave no performance case for. Full record in `render-phase-instrumentation.md`.
- **The pre-phase-4 adapter refactor is landed** (`feat/phase-4`, 2026-08-25) — an unnumbered interlude between phases 3 and 4, described below.
- **Phase 4 is complete** (same branch, 2026-08-26): a core package `@tsdoctor/seo` owns every `<head>` concern behind one `headTags` seam, JSON-LD ships over `@effected/schema-org`, and a long-standing change-detection defect (head tags invisible to the frontmatter hash) is closed. Full record in `structured-data-and-og.md`.
- **The Tier 1 core moves are complete** (landed on `feat/tsdoctor-vfs`, 2026-09-02) — the first tranche of the measured core-move candidate list in `tsdoctor-package-architecture.md`, taken between phases 4 and 5 rather than deferred into phase 5 with the rest. A **sixth core package, `@tsdoctor/vfs`**, was extracted from the registry (the `Vfs` currency type, `VirtualPackage`, `TsEnvironment`, the compiler-options seam); `ApiExtractedPackage` and `TypeReferenceExtractor` moved into `@tsdoctor/model` and `Frontmatter.ts` with them. `category-resolver.ts` was deliberately left in the adapter as product policy. Full record, including where the earlier proposal was wrong, is in the Core-Move Candidates section of `tsdoctor-package-architecture.md`.
- The plugin itself is pre-1.0 and RSPress-specific; the bundle spec is now formalized in `bundle-spec.md` (the informal three-file folder convention is superseded).

## The 1.0 Definition

**Settled decision:** core `@tsdoctor/*` packages do not reach 1.0 until a working VitePress adapter alpha proves the seams. A second live consumer is the only honest test that the core/adapter boundary is drawn correctly. `rspress-plugin-api-extractor@1.0.0` ships on the 1.0 core. Docusaurus support is explicitly post-1.0.

## Phases

Each phase has a gate that must hold before the next phase starts. Phases are ordered by dependency, not by calendar.

### Phase 1 — Consolidation

**COMPLETE** (executed on branch `feat/tsdoctor-phase-1`, merged via PR #163 and released 2026-08-24). Moved development into this monorepo with **no behavior change**. Full executed record in `monorepo-consolidation.md`.

- Org registration: **done**. Release: **done** — the first release from this repo shipped `rspress-plugin-api-extractor@0.8.9`, `@tsdoctor/registry@0.1.0` and `@tsdoctor/model@0.1.0` together to npm and GitHub Releases.
- `type-registry-effect`'s workspace moved in as `packages/registry`, renamed `@tsdoctor/registry` (a fresh 0.x line — first release 0.1.0 — succeeding `type-registry-effect@2.3.5`): **done**.
- `api-extractor-llms`'s contents seeded `packages/model` (`@tsdoctor/model`, fresh 0.x line — first release 0.1.0): **done** — with one plan deviation: the four plugin shims (`loader.ts`, `model-loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`) were NOT collapsed into direct usage; only their import specifiers changed. The collapse is deferred to the open model-API-shape decision.
- Workspace layout resolved: the plugin workspace moved from `package/` to `platforms/rspress/`; globs are now `modules/*`, `packages/*`, `platforms/*`, `sites/*`.
- Deprecate both old npm packages with pointers to the new names: **done** — `type-registry-effect` and `api-extractor-llms` are deprecated on npm and their GitHub repos archived.
- **@effected surface:** the registry's existing `@effected/semver` / `store` / `tsconfig-json` / `xdg` peers moved with it unchanged (`@effected/*` is the mandated foundation throughout — see "Foundation: @effected" in `tsdoctor-package-architecture.md`).
- **Gate: HELD** — full monorepo build green (26 Turbo tasks), typecheck green, 1,236 tests / 0 failures (the plugin's ~1,033 plus the two libraries' suites now running as workspace projects).

### Phase 2 — Carve the Core

**CODE COMPLETE** (landed on branch `feat/tsdoctor-phase-2`, 2026-08-24; releases pending via changesets). Extracted the remaining framework-neutral concerns into their own packages, making the plugin a consumer of four core packages (`@tsdoctor/model`, `@tsdoctor/registry`, `@tsdoctor/bundle`, `@tsdoctor/snapshot`).

- `@tsdoctor/bundle`: **done** — exists at `packages/bundle` with the versioned sidecar manifest (`tsdoctor.json`; the manifest-shape decision resolved 2026-08-24), the six-tier resolver with provenance, layer-0-only discovery, and the local-dir / npm-tarball / GitHub-release fetchers. The previously informal three-file folder convention and the `*.npm.meta.tgz` release variant are now formalized; full spec in `bundle-spec.md`. The plugin's `fromDir`/`fromParentDir` helpers delegate to `discoverBundle` (adapter keeps its stricter package.json requirement and baseRoute/config assembly).
- `@tsdoctor/model` API redesign: **done** — redesigned as idiomatic Effect v4 namespace modules (`Model`/`Tsdoc`/`ApiItems`/`EntryPoints`/`Routes`/`SyntheticBases`/`Signature`/`Render`/`CrossLinker`/`StructuredData`-stub; see `tsdoctor-package-architecture.md`). All four plugin shims collapsed into direct usage, and the identity renames executed: registry tag ids are `"@tsdoctor/registry/..."` and the plugin XDG cache namespace is `"tsdoctor"` (the accepted one-time on-disk cache invalidation — cold refetch).
- `@tsdoctor/snapshot`: **done** — the SQLite snapshot system extracted to `packages/snapshot` and rebuilt on `@effected/store`'s `Store.layerSqlite`, positioned as the durable per-page metadata store ahead of phase 4 writing OG/SEO results into it (`snapshot-tracking-system.md`).
- Migrate `multi-entry-resolver.ts`, `route-collisions.ts`, and `synthetic-bases.ts` from the plugin into `@tsdoctor/model`: **done** — now the `EntryPoints`, `Routes` and `SyntheticBases` modules.
- Replace the plugin's `gray-matter` dependency with kit-native frontmatter handling: **done** — `platforms/rspress/src/frontmatter.ts` implements a gray-matter-parity split/join over `@effected/yaml` (YAML 1.2 parse, double-quoted scalar emission for js-yaml 1.1 consumers, hash-stable, characterization-tested); `gray-matter` is gone from the plugin manifest.
- **@effected surface:** `github` / `glob` / `npm` / `package-json` / `tsconfig-json` / `walker` / `store` / `yaml` — per the dependency map in `tsdoctor-package-architecture.md`. The `store` evaluation resolved (2026-08-24): **adopt**, executed in `@tsdoctor/snapshot` (see the port details and migration-ledger caveat in `tsdoctor-package-architecture.md`).
- **Gate: code criteria MET** — the plugin builds and tests green against the four extracted packages (suite 1,314 passing of 1,315; typecheck 23/23). The decision precondition was met ahead of schedule (manifest shape resolved during phase-2 planning; `bundle-spec.md` written). Remaining to close the phase: the changesets release.

### Phase 3 — Instrumentation, then Scoping and Performance

**COMPLETE** (landed on branch `feat/phase-3`, 2026-08-25). **Settled decision: instrument first, decide after** — held, and paid for itself: the first two measurement attempts were both wrong (a batch-window `await`-crossing bug, and a mislabeled Twoslash/Shiki split) in ways that would have sent the optimization effort at the wrong target. Full record, measured data and both delivered fixes are in `render-phase-instrumentation.md`.

Evidence that motivated the phase, recorded in `build-progress-and-issues.md`: on the effected/website consumer site (22 APIs), the plugin's own doc generation completed in ~2s while RSPress's render pass took 3m20s with 184/184 code blocks slow (>500ms) — Twoslash type-checking during the render phase is the dominant cost.

Corrected, per-scope/per-block attribution found **Twoslash accounts for ~97% of render-phase code-block time, concentrated in ~11% of blocks** (`sites/multi`: 129 blocks, 7.9s summed, 96.8% in Twoslash). The two candidate fixes resolved on that evidence:

- (a) **Delivered as the performance work.** A persisted Twoslash result cache (`src/twoslash-cache.ts`, XDG sqlite-backed via `@effected/store` `Cache`), keyed on code plus a hash of the type environment and compiler options. Measured on `sites/multi`: render phase 8.1s → 0.2s on a warm cache, 14/14 hits, output byte-identical.
- (b) **Delivered, but on correctness grounds, not performance ones.** Per-scope TypeScript environments — one transformer per distinct resolved compiler config instead of a singleton (the `TwoslashManager` singleton that held them became the `TwoslashEnvironments` service in the pre-phase-4 refactor below). The data gave it no performance case — 97% of the time is inside `twoslasher()`, and splitting one shared environment would reduce `tsEnvCache` sharing. It shipped anyway as the `with-api` scoping **correctness** fix, retiring the documented "first API's tsconfig wins" limitation (`type-loading-vfs.md`); the FILE set (the combined VFS) stays shared, so this is per-scope CONFIG, not per-scope files, and does not sharpen cache invalidation.

**Gate: HELD** — per-scope, per-code-block attribution is live, produced data, and fix priority was decided from that data and recorded in `render-phase-instrumentation.md`.

### Interlude — Pre-Phase-4 Adapter Refactor

**COMPLETE** (landed on `feat/phase-4`, 2026-08-25). Not a numbered phase: no new capability, and the only intended behaviour changes are two labelled bug fixes. Phases 1–3 carved framework-neutral logic out into four core packages without anyone re-drawing the adapter around what was left, and phases 4 and 5 were about to add features on top of that residue.

**The line in the sand was `ResolvedBuildContext`.** Phase 4 introduces two build-scoped concerns — OG image generation and JSON-LD derivation — and on the old shape there was exactly one home for each: another field on the 16-field god-object and another argument on `ConfigServiceLive(options, shikiCrossLinker, buildId, thresholds)`. Once phase 4 did that, the object would have had 18 fields and the factory 6 arguments, and every later step would cost more. It is now **deleted**: `resolve` returns `ReadonlyArray<ResolvedApiConfig>` and the layer is a zero-argument static, `ConfigService.layer`. See `build-architecture.md` for where all 16 fields went.

What landed:

- **New services** — `HighlighterService` (scoped at `ManagedRuntime` lifetime; the highlighter was never disposed, leaking one WASM instance per dev HMR rebuild), `OgService` (replacing the `OpenGraphResolver` class and its `undefined`-on-every-failure return with a typed `OgImageError`; `og-resolver.ts` is now pure and filesystem-free), `TwoslashEnvironments` (replacing the `getInstance()` singleton), `PluginConfig`. `PathDerivationService` was **deleted** — `Layer.succeed` over two pure functions, unreachable error type, already bypassed at seven call sites.
- **A `Context.Reference` tier** (`src/BuildEnv.ts`) for `BuildId`, `Thresholds`, `PageConcurrency` and `SuppressExampleErrors`.
- **Two runtimes, deliberately.** Hoisting the cache-backed layers out of service method bodies (they were rebuilding the XDG/sqlite stack twice per build) made the main layer asynchronous to build, which broke `runSync` from the sync islands. The emitters now run on a separate `Layer.succeed`-only runtime, with `metricStore.layer` shared by reference.
- **Seven duplicated sync-emitter seams collapsed into one** `observability/sync-emitter.ts`; `EventContext.buildId` became optional and is filled centrally by `emit`, retiring 24 sites that passed `""`.
- **Cross-linking** — `ShikiCrossLinker` is immutable and per-scope, `transformHast` lost its scope parameter, and a 230-line duplicate `transformRoot` went with it.
- **Two live defects fixed.** Two `sanitizeId` implementations had diverged, so every class or interface member whose name contained `_` or `$` had a cross-link that landed nowhere — `cross-linking-architecture.md` had recorded that hazard as retired when only the route side had been unified. And compiler options reached Twoslash in the tsconfig `lib` spelling rather than the file-name form, so three of four resolution paths loaded zero lib files and rendered confidently degraded hovers with zero warnings; normalization now happens at one seam via `@effected/tsconfig-json`'s `TsEnumCodec`.
- **Kit swaps** — `mdast-util-from-markdown` → `@effected/markdown` (`Markdown.parseResult` + `Mdast.toMdast`, commonmark dialect); `escapeYamlString` deleted in favour of `emitFrontmatterBlock`; `@effected/memfs` adopted in one registry test.

Two fixture gaps were found during the refactor, both discovered only because a mutation turned out to be unobservable. **The first is now closed:** no fixture site declared a site URL, so every `og:` tag the plugin can emit was dead code in all five site builds. `sites/basic` now sets `siteOrigin` and `ogImage`, so the OG path is exercised end to end — and with it, for the first time, the snapshot system's timestamp-preservation contract (a rebuild is byte-identical; a from-scratch build legitimately mints new timestamps). The second is still open: **`inferApiScope` matches a `docs/en/{api}/` shape no fixture uses**, so cross-linking inside `remark-with-api` has never fired in a fixture build.

#### Chunk 5 (layer tiering, error channel, config-resolution split)

Chunk 5 is the follow-on quality work with no phase-4 coupling. Tasks 5.0, 5.1, 5.2 and 5.4 are **complete**; 5.3 is **partial by decision**. The core-package moves still wait for phase 4 to finish.

- **5.0 — service/layer co-location: done.** Every service now owns its layer as a static, matching the house pattern the core packages already follow, and the five `layers/*ServiceLive.ts` modules are deleted (`@tsdoctor/snapshot`'s `SnapshotServiceLive.ts` with them). One mechanism note came out of it worth keeping: a static initializer runs while the module body is still evaluating, so a static naming a `const` declared further down throws at IMPORT time while typechecking clean — and surfaces only as vitest reporting "0 tests passed" with exit 0. `Layer.suspend` / `Effect.suspend` are the deferring forms. The same co-location carries the `makeTest` / `layerTest` doubles, which replaced the hand-written `Layer.succeed` stubs — with `ConfigService.resolve` and `OgService.resolveImage` deliberately left undefaulted, because their natural defaults are indistinguishable from a real answer.
- **5.1 — layer tiering: done.** `layers/AppLayer.ts`'s `makeAppLayers(input)` returns both runtime stacks from one call, which turns the two-runtime invariant (shared metric store, shared `BuildEnv` references) from a comment into something the type of the call enforces. `AppLayers.app`'s error channel is deliberately not `never` — `SnapshotService.layer` stays fatal while the two cache layers degrade.
- **5.2 — the error channel: done.** `ConfigServiceShape.resolve` was declared over-wide in three ways at once (two unreachable error types plus an unneeded `Scope.Scope` requirement) and the implementation carried an `as Effect<…>` cast to bridge the gap. Channel narrowed to `ConfigValidationError`, cast deleted. Three configuration failures that used to escape as untyped defects — killing the build with no `issues.json` entry — now fail typed, and two metrics that were escaping the build's own registry were fixed with them.
- **5.3 — the config-resolution split: partial.** `config-resolution.ts` (859 → ~676 lines) plus `api-results.ts`, `type-environment.ts` and `external-types.ts`. The planned `resolveModels` extraction was **deliberately not done**: that section touches 13 closure variables and mutates two of them that are read afterwards, so the cut would have produced a worse interface than the code it replaced.
- **5.4 — `TsconfigLoaderSync`: done.** `tsconfig-parser.ts` reads through `@effected/tsconfig-json` (234 → 136 lines; the file has since moved to `@tsdoctor/vfs` as `TsconfigParser.ts`, and the dual-spelling interface described below was replaced by a `Schema.pick` over the kit's own `CompilerOptions` — see `type-loading-vfs.md`) and no longer imports the TypeScript compiler at all; the kit owns `extends` resolution, JSONC parsing and relative paths. Two things came out of it. The loader reports the **tsconfig spelling** rather than the programmatic form, which is why Task 1.2's normalization seam was a hard precondition — `TypeResolutionCompilerOptions` now documents both spellings for `target`/`module`/`moduleResolution`/`jsx` as it already did for `lib`, and `toProgrammaticCompilerOptions` stays the one conversion site. And `parseTsConfigWithMetadata`/`extendedPaths` were deleted: zero consumers, and the chain they reported was wrong for package-specifier extends anyway. Verified by measuring hover parity on `sites/multi` with a cold Twoslash cache on both sides — 226 hovers before, 226 after — because neither the suite nor an MDX golden diff can see hovers, which render after `config()` returns. See `type-loading-vfs.md`.

Also landed alongside Chunk 5: the `makeTest` / `layerTest` service doubles (5.0 above), and `layers/ObservabilityLive.ts` renamed to `layers/observability.ts` now that the `*Live` suffix no longer describes anything in the tree.

### Phase 4 — SEO Layer

**COMPLETE** (landed on `feat/phase-4`, 2026-08-26, following the pre-phase-4 adapter refactor on the same branch). Implemented against `.claude/plans/2026-08-25-seo-layer-plan.md`; the full record — package topology, the seam, the JSON-LD mapping, the change-detection defect — is in `structured-data-and-og.md`.

- **A fifth core package, `@tsdoctor/seo`** (`packages/seo`): framework-neutral `<head>` metadata. `HeadTag` (the neutral tag vocabulary), `Canonical`, `OpenGraph` (+ Twitter cards), `Attribution`, `StructuredData`, and `Seo.headTags` — the single adapter seam. The adapter's `og-resolver.ts` and `schemas/opengraph.ts` are deleted into it.
- **JSON-LD structured data: done**, but **NOT** "computed in `@tsdoctor/model`" as this roadmap originally sited it. The model's `@alpha`, zero-consumer, throwing `StructuredData` stub is **deleted**; derivation lives in `@tsdoctor/seo` over the newly released `@effected/schema-org@0.1.0`. `packageContext` is derived once per API; `derive`/`deriveScriptBody` assemble the per-page `@graph` (`SoftwareSourceCode` + `TechArticle` + `APIReference`, linked by `isPartOf`/`mainEntity`). Reasons for the move are recorded in `structured-data-and-og.md` and `tsdoctor-package-architecture.md`.
- **Author and license attribution: done** — `attributionFacts(manifest)` over an `@effected/package-json` `PackageManifest`, carried on `ResolvedApiConfig.manifest`.
- **Canonical `<link>` tags: done** — new; this plugin had never emitted them.
- **The OG image *generation* pipeline (satori + resvg) is DEFERRED out of phase 4, deliberately.** It needs a native binary and its own persistence story, and it rides on the head-tag seam this phase built anyway, so building the seam first makes the image branch a leaf change rather than a second architecture. Configured images are still resolved by the adapter's `OgService`; persisting *generated* results in the snapshot DB is future work.
- **A real defect closed:** head tags were invisible to incremental-build change detection. `hashFrontmatter` now hashes `head` with timestamps stripped recursively, and head-tag construction moved from the write stage into the generate stage so the hash covers it. Measured on `sites/basic`: a fixture version bump rewrote 0 of 46 pages before, 37 of 46 after; a no-change rebuild stays byte-identical. See `structured-data-and-og.md` and `snapshot-tracking-system.md`.
- **@effected surface:** `spdx` / `package-json` supply the attribution inputs as planned, plus the new `@effected/schema-org` (produced by round 2 of the dogfood loop). `@effected/pnpm-plugin-effect` bumped to `0.6.11` to carry its catalog entry.
- **Gate: HELD, offline.** `Conformance.check` from `@effected/schema-org/validate` runs over five manifest fixtures asserted to `[]`, plus a strict `unknownTerms: "fail"` run — in CI, rather than against a live Google endpoint. Validation is fixture-level; there is no per-page conformance check in a production build. The manual Google Rich Results confirmation remains a human step.

### Phase 5 — VitePress Adapter and Doc IR

**Settled decision: the doc IR is extracted here, not designed up front.** `@tsdoctor/pages` — the framework-neutral page-generation IR (typed doc blocks + mdast prose) — is carved out only in this phase, alongside the VitePress adapter, so the abstraction is shaped by two live consumers rather than speculation.

- `@tsdoctor/pages` dogfoods `@effected/markdown`, which likely grows MDX serialization capability from this work.
- **The remaining core moves land here**, per the measured candidate list in `tsdoctor-package-architecture.md`. Tier 1 was taken early, ahead of this phase (see [Current State](#current-state)); what is left is the Tier 2 set, whose destinations genuinely want a second consumer to decide. One correction to this roadmap's own wording: `llms-processing.ts` is pure text transforms over a cross-framework standard and belongs in core — only `llms-program.ts` (I/O, RSPress `outDir`) is what "llms.txt wiring stays in the adapter" describes.
- **@effected surface:** `markdown` as the IR substrate. The MDX dogfood loop already delivered construction and serialization of the MDX node vocabulary in the released 0.7.0 kit wave, ahead of this phase, proof-tested by `packages/model/__test__/mdx-vocabulary.test.ts`; MDX parsing is still absent, and wiring the vocabulary into an actual page-generation IR remains this phase's work (see "Kit Expansion via Dogfood" in `tsdoctor-package-architecture.md`).
- The VitePress adapter leans on native `@shikijs/vitepress-twoslash` where sensible instead of porting the RSPress remark pipeline.
- **Gate:** a working VitePress adapter **alpha** renders a real API doc site from the same bundles the RSPress plugin consumes. This gate is the 1.0 gate for the core.

### Phase 6 — 1.0

- Stabilize APIs, write user docs, finalize deprecations.
- `@tsdoctor/*` core packages go 1.0; `rspress-plugin-api-extractor@1.0.0` ships on them.
- Docusaurus is post-1.0.
- TS7/api-extractor is explicitly **off the critical path**: the bundle spec is the firewall — `api.json` is the input contract regardless of which TypeScript produces it. The pnpm-plugin patch idea for api-extractor is a side spike only, never a phase dependency.

## Deferred Design Docs

Each of these docs is authored in the phase that produces the evidence or the second consumer that shapes it; docs not yet marked written do not exist yet:

| Doc | Written in | Covers |
| --- | --- | --- |
| `bundle-spec.md` | Phase 2 — **written** (2026-08-24, during phase-2 planning) | The versioned bundle manifest and fetcher contracts |
| `render-phase-instrumentation.md` | Phase 3 — **written** (2026-08-25) | Per-scope/per-block attribution design, the measured data and both delivered fixes |
| `structured-data-and-og.md` | Phase 4 — **written** (2026-08-26) | The `@tsdoctor/seo` package, the `headTags` seam, the JSON-LD mapping and the change-detection defect. The OG image *generation* pipeline is deferred and is named as out of scope there. |
| `doc-ir-and-pages.md` | Phase 5 | The `@tsdoctor/pages` IR, shaped by the RSPress + VitePress consumers |

Also idea-stage and deliberately unscheduled (no phase, no gate): `@tsdoctor/cli`, a scaffolding `tsdoctor` binary — see "Future Packages (Idea-Stage Stubs)" in `tsdoctor-package-architecture.md`.

## Rationale

- **Why consolidate:** release cascade pain. A change to `@effected/*` previously required releasing `type-registry-effect`, then bumping and releasing here — two release hops for one change. Moving development into this monorepo eliminates them. The package split's original benefit (isolated test surfaces, forced-clean APIs) is preserved by workspace boundaries instead of repo boundaries.
- **Why the VitePress-alpha 1.0 gate:** a 1.0 promise on seams only one consumer has exercised is a guess. The alpha is the cheapest honest proof that the adapter contract holds.
- **Why the doc IR waits for phase 5:** an abstraction extracted from two live consumers is shaped by real needs; one designed up front for a hypothetical second consumer is shaped by speculation and calcifies wrong.
- **Why instrument before optimizing:** the aggregate evidence said Twoslash-in-render dominates, but the two candidate fixes had very different costs and no data existed to rank them — and the sequencing paid for itself, since the first two measurement attempts were both wrong in ways that would have misdirected the fix.
- **Why TS7 is off the critical path:** the bundle spec decouples doc generation from the toolchain that produced the `api.json`, so api-extractor's TS7 story cannot block 1.0.

## Related Documentation

- **Target package architecture:** `tsdoctor-package-architecture.md`
- **Bundle spec (phase 2, written):** `bundle-spec.md`
- **Phase 1 executed record:** `monorepo-consolidation.md`
- **Current plugin architecture & shared-library delegation:** `build-architecture.md`
- **Phase 4 record — the SEO layer, the `headTags` seam and the change-detection defect:** `structured-data-and-og.md`
- **Render-phase performance evidence that motivated phase 3:** `build-progress-and-issues.md`
- **Phase 3 record — per-scope/per-block attribution, measured data, both delivered fixes:** `render-phase-instrumentation.md`
- **EventBus/dimensional metrics system phase 3 extended:** `performance-observability.md`
- **Combined-VFS limitation retired by phase 3 fix (b):** `type-loading-vfs.md`
- **LLM-first documentation mission:** `llms-integration.md`
- **Snapshot system repositioned in phase 2:** `snapshot-tracking-system.md`
