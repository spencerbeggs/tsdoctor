---
status: draft
module: rspress-plugin-api-extractor
category: architecture
created: 2026-08-24
updated: 2026-09-02
last-synced: 2026-09-02
completeness: 75
related:
  - rspress-plugin-api-extractor/roadmap-1.0.md
  - rspress-plugin-api-extractor/monorepo-consolidation.md
  - rspress-plugin-api-extractor/bundle-spec.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/cross-linking-architecture.md
  - rspress-plugin-api-extractor/ssg-compatible-components.md
  - rspress-plugin-api-extractor/llms-integration.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
dependencies: []
---

# @tsdoctor Package Architecture

> **Target architecture, now largely realized.** This describes the package architecture for the `@tsdoctor` org. Phases 1, 2 and 4 have landed, plus the Tier 1 core moves: six core packages (`@tsdoctor/vfs`, `@tsdoctor/registry`, `@tsdoctor/model`, `@tsdoctor/bundle`, `@tsdoctor/snapshot`, `@tsdoctor/seo`) exist as workspaces under `packages/`, and the adapter lives at `platforms/rspress/`; only `@tsdoctor/pages` (phase 5) remains future work. See `build-architecture.md` for the adapter's current shape. Phasing is governed by `roadmap-1.0.md`; the phase 1 executed record is in `monorepo-consolidation.md`.

## Table of Contents

- [Overview](#overview)
- [Current State](#current-state)
- [The Layer Cake](#the-layer-cake)
  - [Future Packages (Idea-Stage Stubs)](#future-packages-idea-stage-stubs)
- [Foundation: @effected](#foundation-effected)
  - [Per-Package Dependency Map](#per-package-dependency-map)
  - [Kit Expansion via Dogfood](#kit-expansion-via-dogfood)
- [Where RSPress Coupling Actually Lives](#where-rspress-coupling-actually-lives)
- [The Adapter Contract](#the-adapter-contract)
- [Core-Move Candidates](#core-move-candidates)
- [Open Decisions (Both Now Resolved)](#open-decisions-both-now-resolved)
- [Rationale](#rationale)
- [Related Documentation](#related-documentation)

## Overview

The end state is a set of framework-neutral `@tsdoctor/*` core packages plus thin per-framework adapters. `rspress-plugin-api-extractor` keeps its npm name (name equity) but becomes the first adapter, depending on `@tsdoctor/*` for everything that is not RSPress-specific. The VitePress adapter (phase 5) is the second, and the proof that the seams are drawn correctly.

## Current State

As of 2026-09-02 phases 1, 2 and 4 have been executed (phase 1 released via PR #163; phase 2 landed on `feat/tsdoctor-phase-2`, all gates green — suite 1,314/1,315, typecheck 23/23 — releases pending via changesets; phase 4 landed on `feat/phase-4`), and the Tier 1 core moves landed on `feat/tsdoctor-vfs`. Six of the seven packages exist as in-repo workspaces:

- `packages/vfs` — `@tsdoctor/vfs` (Tier 1 core moves): the VFS primitives, extracted from the registry — the `Vfs` currency type with `mergeVfs`/`prefixVfs`/`isTypeDefinition`, `VirtualPackage`, `TsEnvironment`, and the compiler-options seam that followed `TsEnvironment` out of the adapter. Depends on `effect` alone plus three optional peers. See [The D1 outcome](#the-d1-outcome).
- `packages/registry` — `@tsdoctor/registry`, the former sibling-repo `type-registry-effect@2.3.5` (Effect v4). Consumed by the adapter via `workspace:*`. Phase 2 executed the identity renames: the four `Context.Service` tag ids are now `"@tsdoctor/registry/..."` and the plugin's XDG cache namespace is `"tsdoctor"` (the accepted one-time cache invalidation). It now sits on `@tsdoctor/vfs` and its remaining job — fetch, cache, resolve published types into a `Vfs` — matches its name.
- `packages/model` — `@tsdoctor/model`, **redesigned in phase 2** as idiomatic Effect v4 namespace modules: `Model` (Effect-typed loading, `ModelNotFoundError`/`ModelParseError`/`EmptyModelError`), `Tsdoc`, `ApiItems` (categorize returns `{ items, uncategorized }`), `EntryPoints`, `Routes` (incl. `RouteCollisionError` and the single `sanitizeId`), `SyntheticBases`, `Signature` (de-classed), the `CrossLinker` class (`fromRoutes`/`fromRefs`/`empty`/`link`/`linkHtml`), and `Render` (string API plus `@alpha` `Render.tree`, internally `@effected/markdown`). The `@alpha` `StructuredData` stub it once carried is **deleted** (phase 4): schema.org derivation lives in `@tsdoctor/seo`, not here. It absorbed the plugin's `multi-entry-resolver.ts`, `route-collisions.ts` and `synthetic-bases.ts`; all four phase-1 plugin shims are deleted (see "Core Package Consumption" in `build-architecture.md`).
- `packages/bundle` — `@tsdoctor/bundle` (phase 2): the bundle spec, six-tier resolver with provenance, discovery and the npm-tarball/GitHub-release fetchers. See `bundle-spec.md`.
- `packages/snapshot` — `@tsdoctor/snapshot` (phase 2): the snapshot system extracted from the plugin, rebuilt on `@effected/store`'s `Store.layerSqlite`. See `snapshot-tracking-system.md`.
- `packages/seo` — `@tsdoctor/seo` (phase 4): framework-neutral `<head>` metadata — the neutral `HeadTag` vocabulary, canonical URLs, Open Graph + Twitter cards, attribution, schema.org JSON-LD, and `headTags`, the single adapter seam. It absorbed the adapter's `og-resolver.ts` and `schemas/opengraph.ts` (both deleted). See `structured-data-and-og.md`.
- `platforms/rspress/` — the adapter workspace: RSPress hooks, React runtime, remark plugins, page generators (the page-generation IR extraction is phase 5), llms.txt wiring, and the thin adapter seams over the six core packages.

Only `@tsdoctor/pages` does not exist yet (deliberately deferred to phase 5).

## The Layer Cake

| Package | Contents | Source today |
| --- | --- | --- |
| `@tsdoctor/model` | api.json loading, TSDoc extraction, categorization, multi-entry resolution, synthetic bases, route/cross-link model | **exists, v4-redesigned** (`packages/model`); absorbed the plugin's `multi-entry-resolver.ts`, `route-collisions.ts`, `synthetic-bases.ts` in phase 2. Schema.org derivation was originally sited here as an `@alpha` `StructuredData` stub; that stub is **deleted** and the concern lives in `@tsdoctor/seo` |
| `@tsdoctor/vfs` | VFS primitives: the `Vfs` currency type, `VirtualPackage`, `TsEnvironment`, `isTypeDefinition` | **exists** (`packages/vfs`), extracted from the registry in the Tier 1 core moves — see [The D1 outcome](#the-d1-outcome) |
| `@tsdoctor/registry` | external type loading: fetch, cache and resolve package types into a `Vfs` | **exists** (`packages/registry`; tag ids `"@tsdoctor/registry/..."` since phase 2) |
| `@tsdoctor/bundle` | bundle spec + fetchers (local dir, npm tarball, GitHub release) — spec in `bundle-spec.md` | **exists** (`packages/bundle`, phase 2); formalized `fromDir` discovery |
| `@tsdoctor/pages` | framework-neutral doc IR rendered to markdown via mdast (**phase 5, deferred**) | page generators minus JSX emission |
| `@tsdoctor/seo` | framework-neutral `<head>` metadata: `HeadTag` vocabulary, canonical URLs, Open Graph + Twitter cards, attribution, schema.org JSON-LD, and the `headTags` seam | **exists** (`packages/seo`, phase 4); absorbed the adapter's `og-resolver.ts` and `schemas/opengraph.ts` |
| `@tsdoctor/snapshot` | SQLite incremental system + per-page metadata (OG/SEO) | **exists** (`packages/snapshot`, phase 2); `SnapshotService` extracted from the plugin onto `Store.layerSqlite` |
| `rspress-plugin-api-extractor` | thin adapter: RSPress hooks, React runtime, remark plugins, llms.txt wiring | `platforms/rspress/`, consuming all five core packages |

`@tsdoctor/pages` is deliberately last: per the settled decision in `roadmap-1.0.md`, the IR is extracted in phase 5 alongside the VitePress adapter so two live consumers shape it.

### The D1 outcome

**Resolved 2026-09-02: `@tsdoctor/vfs`, superseding this document's earlier answer.** The Core-Move Candidates section below sent `api-extracted-package.ts` to `@tsdoctor/registry`, reasoning that it *"already `extends VirtualPackage` FROM the registry, so it is the registry's own concept living outside it."* Three measurements taken while planning the move contradict the premise:

- **`VirtualPackage` had zero consumers inside the registry** — 143 lines, re-exported from `index.ts` and used by nothing else in the package. Its only dependency on the rest of the registry was the `Vfs` *type*.
- **`TsEnvironment` was the same shape** — 141 lines, no internal consumers, and the only module reaching for the `typescript` / `@typescript/vfs` / `@effected/tsconfig-json` optional peers.
- **The registry had no `@microsoft/api-extractor-model` dependency at all.**

So `VirtualPackage` was not the registry's own concept; it was a leaf the registry hosted, and the concept that used it lived two packages away. Sending the api-model files to the registry would have made the neutral type-loading layer depend on the api.json vocabulary; sending them to `@tsdoctor/model` with a model→registry edge would have made anyone installing the model for TSDoc extraction drag the registry's fetch/cache/XDG stack, to reuse one Schema class.

Extracting the substrate avoids both. `@tsdoctor/vfs` depends on `effect` alone (plus three optional peers), and the registry and the model sit on it independently — no edge between them in either direction. The registry sheds three optional peers in the process and its remaining job matches its name.

`TsEnvironment` moved too, which makes `@tsdoctor/vfs` the right home for the compiler-options seam (`parseTsConfig`, the whitelist type, and the tsconfig↔programmatic conversion) rather than the registry — see the Tier 1 plan's Chunk 3.

### Future Packages (Idea-Stage Stubs)

Recorded as ideas only — **deliberately unscheduled, no phase, no gate**:

- **`@tsdoctor/cli`** — a CLI package shipping a `tsdoctor` binary. Base use case: convenient scaffolding of repo and docs-site structures so people get up and running quickly (init a docs site, wire the plugin config, generate the bundle folder layout). Built on `effect/unstable/cli` (core's CLI framework — `@effect/cli` is dead on the v4 line), `@effected/cli` (the CLI boundary: `CliLogger` plain rendering, `CliRuntime` exit-code/failure handling), and `@effected/templates` (managed BEGIN/END sections in user-editable files). It slots naturally into the @effected foundation map below (the `cli`/`templates` rows).

## Foundation: @effected

**Standing rule (mandated):** `@effected/*` is the low-level foundation for every `@tsdoctor` subsystem. Check the kit before hand-rolling. When the kit lacks a capability, the gap is closed by EXPANDING `@effected` through dogfood loops (the `/silk:dogfood` protocol against the sibling `effected` checkout) — never by re-implementing the capability locally.

### Per-Package Dependency Map

Verified against the `@effected` package index (all kit packages published 0.x; the versions installed here as of 2026-08-25 include `store@0.5.0`, `markdown@0.7.0`, `tsconfig-json@0.6.1`, `memfs@0.5.0`, `jsonc@0.8.0`, `yaml@0.12.0`):

- **`@tsdoctor/vfs`** — `@effected/tsconfig-json` (optional) for the compiler-options seam: `CompilerOptions` is the type `TypeResolutionCompilerOptions` is picked from, `TsEnumCodec` owns both spellings, and `TsconfigLoaderSync` reads a tsconfig. `typescript` and `@typescript/vfs` are its other two optional peers, carried in with `TsEnvironment`. Nothing else — the package depends on `effect` alone.
- **`@tsdoctor/registry`** — `@effected/semver`, `@effected/store` (`Cache`) and `@effected/xdg`. It **shed** `@effected/tsconfig-json`, `@typescript/vfs` and `typescript` when `TsEnvironment` moved to `@tsdoctor/vfs`; the rest are its phase-1 peers, preserved exactly (see `monorepo-consolidation.md`).
- **`@tsdoctor/model`** — `@effected/markdown` for TSDoc prose → mdast and for building markdown programmatically (28 constructible node classes, `Markdown.stringify`, frontmatter codecs, section finders); `@effected/package-json` and `@effected/spdx` were mapped here on the assumption that phase 4's schema.org derivation would live in the model. **It does not** — attribution and JSON-LD moved to `@tsdoctor/seo`, and both kit packages are that package's peers instead. The model keeps `@effected/markdown`, and the Tier 1 core moves added `@effected/yaml` behind `Frontmatter.ts` plus a workspace dependency on `@tsdoctor/vfs` (for `VirtualPackage`, which `ApiExtractedPackage` extends) and a **test-only** one on `@tsdoctor/snapshot`.
- **`@tsdoctor/bundle`** — `@effected/package-json` + `@effected/tsconfig-json` (the bundle's two manifest files, `LenientManifest` for discovery-time field-granularity leniency); `@effected/github` (typed REST releases/assets for the GitHub-release fetcher); `@effected/npm` (`NpmRegistry` for the npm-tarball fetcher plus the dependency-specifier vocabulary); `@effected/semver` (version specs); `@effected/store` `Cache` + `@effected/xdg` (cached fetched artifacts, the same pattern the registry already uses); `@effected/glob` and/or `@effected/walker` for `fromDir`/`fromParentDir`-style discovery; `@effected/jsonc`'s `JsoncFingerprint` (RFC 8785/JCS canonicalization + SHA-256 through core's `Crypto` service) for `BundleHash.ts`'s coarse layer hashing and fine per-field fingerprints.
- **`@tsdoctor/snapshot`** — **RESOLVED (2026-08-24, evaluated against `@effected/store@0.4.0`; `0.5.0` is installed as of 2026-08-25 and the adoption is unchanged): adopt Store for both tables.** The evaluation's original framing ("does Store's model fit the relational `file_snapshots` table, or does the kit want a tabular capability grown") presupposed Store is KV-shaped — it is not. `Store` is a schema-versioned, migrated SQLite `SqlClient`: its shape is `{ client: SqlClient, migrate, rollback(toId), status }`, where `client` is the full `effect/unstable/sql` tagged-template client (arbitrary DDL/DML, `withTransaction`, PRAGMAs), and `Store.layerSqlite({ filename, migrations })` bundles the SAME `SqliteClient.layer` from `@effect/sql-sqlite-node` the previous hand-wired stack used (WAL on by default); the KV half is the separate `Cache` service. Consequence: `@tsdoctor/snapshot` is built on `Store.layerSqlite` — the existing `001_create_snapshots` SQL ports verbatim as `StoreMigration { id: 1 }`, all queries/batch-upserts/conditional `ON CONFLICT` run unchanged through `store.client`, and the package sheds its direct `@effect/sql-sqlite-node` + Migrator hand-wiring while gaining rollback/status/typed migration errors. The WAL-checkpoint finalizer originally ported by hand via `store.client` (an `Effect.addFinalizer` wrapping `PRAGMA wal_checkpoint(TRUNCATE)`) is now gone from the package entirely: candidates (c) and (d) below shipped in the released effected round-1 kit wave, and `SnapshotServiceLive` was updated to pass `checkpointOnClose: true` to `Store.layerSqlite`, which registers the identical finalizer inside `@effected/store` itself. The forward bundle-fingerprints table (`bundle-spec.md`'s change-detection section) lands as migration 2 in the same store — chosen over `Cache` because a build-end commit can then upsert file snapshots AND fingerprints in ONE transaction (`Cache`'s `set` cannot enlist in a caller's transaction), and because durable state whose loss corrupts incremental correctness does not belong in a thing named Cache with eviction switched off. One migration-ledger caveat: Store's ledger (`_store_migrations`) differs from the effect Migrator's ledger table, so a pre-existing committed `api-docs.db` gets migration 1 re-applied on first Store run — harmless because `001_create_snapshots` is `CREATE TABLE IF NOT EXISTS`; the phase-2 boundary (before any migration 002 exists) is the safe switch window.
- **`@tsdoctor/seo`** (phase 4) — `@effected/schema-org` (the schema.org node vocabulary plus the offline `Conformance` validator, first released at 0.1.0 by round 2 of the dogfood loop); `@effected/package-json`'s `PackageManifest` (typed `Person` / `Repository` / SPDX license — the shape `attributionFacts` derives from, and the source of `licenseExpressionOf`); `@effected/spdx` (`SpdxExpression.licensesOf` / `primaryLicense` and each catalog `License`'s own `referenceUrl`). Round 2 also shipped `@effected/spdx@0.5.0` and `@effected/package-json@0.13.0`, and bumped the `@effected/pnpm-plugin-effect` config dependency to `0.6.11` to carry the schema-org catalog entry.
- **`@tsdoctor/pages`** (phase 5) — `@effected/markdown` as the IR substrate. Division of labor by design: HTML generation belongs to the consuming framework (RSPress/VitePress) — `@effected/markdown`'s role is the TRANSITION step, emitting the correct mdast/MDX-shaped tree (and its serialization) for the framework to consume and render via the `Mdast` projection. MDX (JSX-element nodes) shipped in the kit's 0.7.0 release (construction + serialization only, no MDX parsing) as the round-1 dogfood expansion driven by the RSPress adapter's MDX serialization needs — see candidate (a) below and the proof-consumer test in `packages/model/__test__/mdx-vocabulary.test.ts`. Wiring that vocabulary into an actual page-generation IR remains phase-5 work. HTML support isn't needed, not forbidden: the kit's current no-HTML posture is owner policy that could be revisited, but the architecture deliberately keeps HTML framework-side.
- **`@tsdoctor/cli`** (stub, unscheduled) — `@effected/cli` and `@effected/templates` on top of `effect/unstable/cli`, per the stub above.
- **All packages, tests** — `@effected/memfs` as the standard in-memory `FileSystem` for tests instead of hand-stubbed `layerNoop`.

### Kit Expansion via Dogfood

Candidate expansions discovered so far:

- (a) grow `@effected/markdown` to emit/serialize MDX-shaped mdast (JSX-element nodes) that RSPress consumes — **construction and serialization landed in the released 0.7.0 kit wave** (`MdxJsxFlowElement`, `MdxJsxAttribute`, `MdxJsxAttributeValueExpression` carrying `JSON.stringify`'d props, escape-on-MDX-presence, byte-identical output for non-MDX trees), proof-tested in-repo by `packages/model/__test__/mdx-vocabulary.test.ts` ahead of the phase-5 `@tsdoctor/pages` generator work. Parsing MDX back out of source is deliberately not done yet — phase 5 still owns wiring this vocabulary into the actual page-generation IR.
- (b) `@effected/store` tabular/relational fit for `@tsdoctor/snapshot` — **RESOLVED (2026-08-24): adopt** — Store already fits; no tabular capability needed to be grown (see the `@tsdoctor/snapshot` row above). The evaluation surfaced three NEW candidates instead:
- (c) **DELIVERED and adopted.** `Store.layerSqlite` passes through the remaining `SqliteClient.layer` options (e.g. `disableWAL`).
- (d) **DELIVERED and adopted.** A `checkpointOnClose: true` option registers the `wal_checkpoint(TRUNCATE)` scope finalizer that every durable-SQLite consumer used to hand-write; `@tsdoctor/snapshot`'s `SnapshotServiceLive` now passes it and its own hand-written finalizer is deleted (see the `@tsdoctor/snapshot` row above and `snapshot-tracking-system.md`).
- (e) an adoption recipe/API for consumers migrating from the `effect/unstable/sql` Migrator ledger whose pre-Store migrations aren't idempotent — not yet delivered.
- (f) **DELIVERED and adopted** — a degrade-to-miss posture for `@effected/store`'s `Cache`, shipped upstream as `Cache.degrading` and adopted 2026-09-02 by both cache-backed layers. Adopting it also fixed a defect the hand-written version carried: `Layer.catchCause` absorbs EVERY cause, interruption included, so a fiber being interrupted during shutdown was handed a working degraded cache and carried on. It further collapsed `TwoslashCacheService`'s separate `DegradedLive` — degrading at the `Cache` makes the ordinary implementation over an always-missing cache the degraded behaviour, so there is no second implementation to drift. Original entry, raised 2026-08-25 by the pre-phase-4 adapter refactor: Moving cache acquisition out of service method bodies and into layer construction moved the failure mode from "this method fails and its local catch absorbs it" to "the `ManagedRuntime` build aborts the whole site build", silently violating `TwoslashCacheService`'s documented contract — *an unreachable or corrupt cache is a cache miss, and must not be able to break a build that would otherwise succeed*. Only the type system noticed, when the layer's error channel went from `never` to `CacheError | AppDirsError | XdgEnvError`. Both cache-backed layers in the adapter now hand-write a `Layer.catchCause` degrade, so it is a two-site pattern sitting at layer level where it is easy to omit. A `Cache.layerDegrading` (or a documented recipe) would make the posture declarative. **It must be opt-in, not the default** — `BundleFetch.ts`'s narrower `orElseSucceed` is deliberate and a kit-level default would erase a real distinction.
- (g) **programmatic-spelling input tolerance for `@effected/tsconfig-json`'s `TsEnumCodec`** (raised 2026-09-02 by the Tier 1 core-move planning). The kit types `CompilerOptions.Type`'s `target` / `module` / `moduleResolution` / `jsx` / `lib` as string-literal unions — the canonical tsconfig spellings — and `encodeCompilerOptions` converts those to the programmatic form. There is no supported way IN for a caller already holding the programmatic spelling (`ts.ScriptTarget.ES2025`), which a consumer writing plugin config in TypeScript reasonably does. The adapter papers over this with a hand-rolled `TypeResolutionCompilerOptions` accepting both spellings and a laundering cast, `TsEnumCodec.encodeCompilerOptions(options as never)` — the cast IS the gap. A `TsEnumCodec.normalizeCompilerOptions` (accept either spelling, return canonical `CompilerOptions.Type`, idempotent) is generic, sits beside the `lib`-spelling normalization the codec already performs, and is testable upstream against the enum tables the kit owns. Downstream payoff is disproportionate: the whitelist collapses from a hand-rolled interface to a `Schema.pick` over the kit type — policy expressed in kit vocabulary — and both the cast and the adapter's `toProgrammaticCompilerOptions` wrapper disappear. What must NOT move upstream is the whitelist itself: which options may influence how a documentation example type-checks is a documentation-tool safety decision, not a tsconfig-grammar fact.

The posture: gaps found while building `@tsdoctor` are signal that the kit wants the capability. They are raised through dogfood loops with `file:` overrides against the local `effected` checkout, per the `/silk:dogfood` protocol, and adopted on the next kit release wave.

## Where RSPress Coupling Actually Lives

The key architectural finding from the planning session: RSPress coupling is confined to three areas, and everything else is framework-neutral or nearly so.

1. **The runtime React components** — the SSG-MD dual-mode rendering and Twoslash tooltips (`component-development.md`, `ssg-compatible-components.md`). VitePress is Vue; none of this ports. Each adapter owns its component layer outright.
2. **The remark/HAST pipeline** — `remarkWithApi`, `remarkApiCodeblocks`, and the ShikiCrossLinker post-processing. VitePress uses markdown-it, not remark, and ships first-class Twoslash via `@shikijs/vitepress-twoslash`, so the VitePress adapter does not port this pipeline — it integrates with the native one.
3. **Lifecycle wiring** — the RSPress `config`/`afterBuild` hooks and the llms.txt post-processing I/O in `llms-program.ts` (`llms-integration.md`). Note the split measured in [Core-Move Candidates](#core-move-candidates): the pure text transforms in `llms-processing.ts` are not part of this and belong in core.

Everything outside those three areas — model loading and TSDoc extraction, route/cross-link computation, type registry and VFS construction, the snapshot system, page content generation minus JSX emission — belongs in core.

## The Adapter Contract

A sketch of the boundary, to be hardened by the VitePress alpha (phase 5):

**An adapter receives from core:**

- Resolved API models (loaded, categorized, multi-entry-resolved, synthetic bases applied)
- Cross-link route maps
- Generated markdown / doc IR (`@tsdoctor/pages`, once it exists)
- The VFS primitives and the TypeScript environment (`@tsdoctor/vfs`), populated with resolved external types (`@tsdoctor/registry`)
- Snapshot decisions (what changed, what to regenerate) and per-page metadata (`@tsdoctor/snapshot`)
- Every `<head>` tag for a page, as a neutral `HeadTag[]` from `@tsdoctor/seo`'s `headTags` — canonical link, Open Graph, Twitter card and the schema.org JSON-LD script. An adapter renders them; it does not decide which a page gets (`structured-data-and-og.md`)

**An adapter owns:**

- Its component layer (React for RSPress, Vue for VitePress)
- Code-block rendering integration (remark pipeline here; `@shikijs/vitepress-twoslash` there)
- Framework lifecycle wiring (hooks, dev server, build phases)
- Framework-specific SEO and llms.txt injection points

## Core-Move Candidates

Measured at the end of the pre-phase-4 adapter refactor (2026-08-25) from inside the code rather than from a survey: coupling was counted (references to `@rspress`, `shiki`, `hast`, `react`), not judged by file name. Tier 1 has since been executed; this section records the conclusions so the analysis is not re-derived. Full working is in `.claude/plans/2026-08-25-rspress-adapter-refactor.md` under "Core-move candidates".

**Tier 1 execution status (2026-09-02): COMPLETE.** Every move below landed except `category-resolver.ts`, which was deliberately dropped. Where each file went — and where it did NOT go, since this section's own proposal was wrong twice:

| File | Proposed here | Actually landed |
| --- | --- | --- |
| `api-extracted-package.ts` | `@tsdoctor/registry` | `@tsdoctor/model` as `ApiExtractedPackage.ts` |
| `type-reference-extractor.ts` | `@tsdoctor/registry` | `@tsdoctor/model` as `TypeReferenceExtractor.ts` |
| `tsconfig-parser.ts` | `@tsdoctor/registry` | `@tsdoctor/vfs` as `TsconfigParser.ts` |
| `typescript-config.ts` | `@tsdoctor/registry` | `@tsdoctor/vfs` as `TypeScriptConfig.ts` |
| `frontmatter.ts` | `@tsdoctor/model` | `@tsdoctor/model` as `Frontmatter.ts` |
| `category-resolver.ts` | `@tsdoctor/model` | **stays in the adapter** |

The registry received none of them. The api-model pair went to the model, and the compiler-options pair followed `TsEnvironment` into the new `@tsdoctor/vfs` — see [The D1 outcome](#the-d1-outcome) for why the substrate was extracted rather than the api-model files hosted.

**`category-resolver.ts` stays in the adapter.** It merges full category configs (`displayName`, `folderName`, `collapsible`) across a plugin/package/version precedence chain, which is sidebar presentation plus multiVersion product policy, not model vocabulary; the neutral half already exists as `ApiItems.CategorySpec`. Its `schemas/config.js` edge (below) is therefore moot rather than resolved.

**Both "edges to resolve" below are closed, one of them by deletion.** The `typescript-config.ts` cascade question — whether its version and per-package levels are adapter product policy — dissolved when those levels turned out to be unwired: nothing ever passed them, so a multiVersion site silently type-checked every version against the defaults. They are deleted, along with `VersionConfig`'s advertised `tsconfig` / `compilerOptions` fields, and what moved is a two-level global→API cascade with no policy question left in it.

`@tsdoctor/model` takes a **test-only** dependency on `@tsdoctor/snapshot` in the process: the frontmatter tests pin literal digests, and a digest is only meaningful next to the hasher it guards. One fixture assumption in the plan was wrong in a useful direction — `@tsdoctor/model` already carried byte-identical copies of the `kitchensink` and `example-module` fixtures from the phase-1 seeding, so the moved tests needed no duplication; only the single-consumer `abstract-class` and `alias-collision` fixtures actually moved.

Plan: `.claude/plans/2026-09-02-tier-1-core-moves.md`.

The original analysis follows, kept because its reasoning — not its destinations — is what a future tier should reuse.

**Tier 1 — files in the wrong package today, zero framework references** (~1,880 lines): `api-extracted-package.ts` and `type-reference-extractor.ts` plus `typescript-config.ts` + `tsconfig-parser.ts` to `@tsdoctor/registry`, and `frontmatter.ts` + `category-resolver.ts` to `@tsdoctor/model`. `api-extracted-package.ts` is the strongest of them — it already `extends VirtualPackage` FROM the registry, so it is the registry's own concept living outside it. **The "wait for two consumers" rule does not apply to this tier**: that rule exists to stop abstractions being designed speculatively, and these are files whose boundary is already proven by an import crossing it. The tsconfig pair also got cheaper than when the move was first scoped — the parser rewrite took it to 136 lines and removed its `typescript` dependency outright.

**Two edges to resolve before moving** (both since closed — see the execution status above):

- `typescript-config.ts` carries the four-level cascade (global → API → version → package), and its "version" level is a multiVersion concept that may be adapter **product policy** rather than registry-neutral behaviour. The parser half carries no such question.
- `category-resolver.ts` imports `schemas/config.js` for `CategoryConfig` / `SourceConfig`. Moving it to the model either drags those schema types along or needs them re-homed first.

**One gap in the roadmap as written.** `llms-processing.ts` (414 lines, zero framework references) is pure string transforms over a **cross-framework** standard, and a second adapter would want them byte-identical. Filing it under "llms.txt wiring stays in the adapter" is true of `llms-program.ts` (I/O, RSPress `outDir`) but not of this half — a straightforward miss rather than a judgement call. Two further Tier 2 candidates are open questions rather than misses: the observability cluster (~1,500 lines, framework-neutral, but infrastructure rather than logic — and a second adapter without diagnostics is a worse product) and `og-resolver.ts`, whose pure URL/MIME/alt derivation belongs beside the JSON-LD derivation. **`og-resolver.ts` is now resolved and closed**: phase 4 moved every one of those helpers into `@tsdoctor/seo` (`Canonical.ts` / `OpenGraph.ts`) and deleted the adapter module, along with `schemas/opengraph.ts`. The destination was `@tsdoctor/seo`, not the model.

**Deliberately not a candidate: `path-derivation.ts`.** It reads neutral, but it encodes multiVersion/locale layout conventions that are indistinguishable from RSPress's own from inside this repo — the case the two-consumer rule is actually for. **Watch item: `twoslash-cache.ts`**, which reads as adapter on four `@shikijs/twoslash` type references while the caching itself is neutral; VitePress uses `@shikijs/vitepress-twoslash` over the same engine, so revisit when the alpha exists.

## Open Decisions (Both Now Resolved)

Both decisions recorded here as open were **RESOLVED in the 2026-08-24 phase-2 planning session**, each landing on its stated lean. The entries are kept (retitled, rationale intact) rather than deleted so the decision history stays legible.

1. **Bundle manifest shape — RESOLVED: sidecar `tsdoctor.json`** (decided 2026-08-24, ahead of schedule — during phase-2 planning rather than mid-phase as originally slated). The recorded lean held: a sidecar keeps the spec's versioning independent of `package.json` and tolerates non-npm inputs (e.g. GitHub release assets). The full spec — layered resolution ladder, tier model, manifest v1 shape, provenance, fetchers — is recorded in `bundle-spec.md`, which now exists.
2. **`@tsdoctor/model` API shape — RESOLVED: REDESIGN as idiomatic Effect v4 modules/services** (decided 2026-08-24, per the recorded lean: the package is 0.x, so the breaking window is still open, and the four shims prove the call sites are few). Phase 1 had punted — the seed was verbatim (`@tsdoctor/model` keeps the `api-extractor-llms` public API) and the four plugin shims were kept with only their import specifiers repointed, so the no-behavior-change gate stayed intact. Consequences, now **EXECUTED in phase 2**:
   - The four plugin shims (`loader.ts`, `model-loader.ts`, `formatter.ts`, `markdown/cross-linker.ts`) collapsed into direct usage of the redesigned namespace modules — **done** (see "Core Package Consumption" in `build-architecture.md`).
   - The registry's legacy `"type-registry-effect/..."` `Context.Service` tag id strings AND the plugin's XDG cache namespace were renamed to tsdoctor-native identities (`"@tsdoctor/registry/..."`, `AppDirs.layer({ namespace: "tsdoctor" })`) — **done**, with the deliberate one-time on-disk cache invalidation (cold refetch) accepted.

## Rationale

- **Why keep the `rspress-plugin-api-extractor` name:** name equity — the package is published, searchable, and linked; the adapter role changes what is inside, not what consumers install.
- **Why the coupling analysis drives the split:** the three coupled areas (components, markdown pipeline, lifecycle) are exactly what differs between static-site frameworks; drawing the core boundary anywhere else would either leak framework types into core or force adapters to reimplement neutral logic.
- **Why `@tsdoctor/snapshot` is its own package rather than part of an adapter:** the snapshot DB becomes the durable per-page metadata store (OG images, SEO results in phase 4), which every adapter needs and no adapter should own.
- **Why `@tsdoctor/seo` is a package rather than a module of the model:** the model's job is the API model; SEO is a different domain that will keep growing (images, sitemaps, robots), and phase 5's VitePress adapter must import the derivation rather than reimplement it. A separate `@tsdoctor/open-graph` was considered and rejected — OG metadata and JSON-LD answer the same question from the same inputs and are composed at one call site, so two packages would mean two dependency edges and two release cadences for one concern.
- **Why `@effected/*` is mandated rather than suggested:** the consolidation exists to shorten the loop between the kit and its consumers; hand-rolling a capability the kit should own would recreate the drift the move eliminates, and the dogfood protocol makes expanding the kit cheaper than maintaining a local fork of the idea.
- **Why the open decisions stayed open through phase 1 (both now resolved):** the manifest shape was expected to need the phase 2 fetcher work to test the sidecar against real non-npm inputs (in the event, the 2026-08-24 planning session resolved it ahead of that), and the model API redesign was scoped by the deferred shim collapse — phase 1 kept the shims verbatim precisely so the redesign decision could be made cleanly, as it now has been.

## Related Documentation

- **Umbrella roadmap and phase gates:** `roadmap-1.0.md`
- **Bundle spec (sidecar manifest, tiers, provenance, fetchers):** `bundle-spec.md`
- **Phase 1 executed record:** `monorepo-consolidation.md`
- **Current architecture and the four delegation shims:** `build-architecture.md`
- **The `@tsdoctor/vfs` / `@tsdoctor/registry` split and the Twoslash internals:** `type-loading-vfs.md`
- **Snapshot system moving to `@tsdoctor/snapshot`:** `snapshot-tracking-system.md`
- **Page generators that seed `@tsdoctor/pages`:** `page-generation-system.md`
- **The phase-4 `@tsdoctor/seo` package and the `headTags` seam:** `structured-data-and-og.md`
- **Route/cross-link model moving to `@tsdoctor/model`:** `cross-linking-architecture.md`
- **RSPress-owned component layer:** `ssg-compatible-components.md`
- **llms.txt wiring staying in the adapter:** `llms-integration.md`
