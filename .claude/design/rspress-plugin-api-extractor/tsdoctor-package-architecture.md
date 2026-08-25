---
status: draft
module: rspress-plugin-api-extractor
category: architecture
created: 2026-08-24
updated: 2026-08-24
last-synced: 2026-08-24
completeness: 70
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
dependencies: []
---

# @tsdoctor Package Architecture

> **Target architecture, now largely realized.** This describes the package architecture for the `@tsdoctor` org. Phases 1 AND 2 have landed: all four core packages (`@tsdoctor/registry`, `@tsdoctor/model`, `@tsdoctor/bundle`, `@tsdoctor/snapshot`) exist as workspaces under `packages/`, and the adapter lives at `platforms/rspress/`; only `@tsdoctor/pages` (phase 5) remains future work. See `build-architecture.md` for the adapter's current shape. Phasing is governed by `roadmap-1.0.md`; the phase 1 executed record is in `monorepo-consolidation.md`.

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
- [Open Decisions (Both Now Resolved)](#open-decisions-both-now-resolved)
- [Rationale](#rationale)
- [Related Documentation](#related-documentation)

## Overview

The end state is a set of framework-neutral `@tsdoctor/*` core packages plus thin per-framework adapters. `rspress-plugin-api-extractor` keeps its npm name (name equity) but becomes the first adapter, depending on `@tsdoctor/*` for everything that is not RSPress-specific. The VitePress adapter (phase 5) is the second, and the proof that the seams are drawn correctly.

## Current State

As of 2026-08-24 phases 1 AND 2 have been executed (phase 1 released via PR #163; phase 2 landed on `feat/tsdoctor-phase-2`, all gates green — suite 1,314/1,315, typecheck 23/23 — releases pending via changesets). Four of the five packages exist as in-repo workspaces:

- `packages/registry` — `@tsdoctor/registry`, the former sibling-repo `type-registry-effect@2.3.5` (Effect v4). Consumed by the adapter via `workspace:*`. Phase 2 executed the identity renames: the four `Context.Service` tag ids are now `"@tsdoctor/registry/..."` and the plugin's XDG cache namespace is `"tsdoctor"` (the accepted one-time cache invalidation).
- `packages/model` — `@tsdoctor/model`, **redesigned in phase 2** as idiomatic Effect v4 namespace modules: `Model` (Effect-typed loading, `ModelNotFoundError`/`ModelParseError`/`EmptyModelError`), `Tsdoc`, `ApiItems` (categorize returns `{ items, uncategorized }`), `EntryPoints`, `Routes` (incl. `RouteCollisionError` and the single `sanitizeId`), `SyntheticBases`, `Signature` (de-classed), the `CrossLinker` class (`fromRoutes`/`fromRefs`/`empty`/`link`/`linkHtml`), `Render` (string API plus `@alpha` `Render.tree`, internally `@effected/markdown`), and the `@alpha` `StructuredData` stub. It absorbed the plugin's `multi-entry-resolver.ts`, `route-collisions.ts` and `synthetic-bases.ts`; all four phase-1 plugin shims are deleted (see "Core Package Consumption" in `build-architecture.md`).
- `packages/bundle` — `@tsdoctor/bundle` (phase 2): the bundle spec, six-tier resolver with provenance, discovery and the npm-tarball/GitHub-release fetchers. See `bundle-spec.md`.
- `packages/snapshot` — `@tsdoctor/snapshot` (phase 2): the snapshot system extracted from the plugin, rebuilt on `@effected/store`'s `Store.layerSqlite`. See `snapshot-tracking-system.md`.
- `platforms/rspress/` — the adapter workspace: RSPress hooks, React runtime, remark plugins, page generators (the page-generation IR extraction is phase 5), llms.txt wiring, and the thin adapter seams over the four core packages.

Only `@tsdoctor/pages` does not exist yet (deliberately deferred to phase 5).

## The Layer Cake

| Package | Contents | Source today |
| --- | --- | --- |
| `@tsdoctor/model` | api.json loading, TSDoc extraction, categorization, multi-entry resolution, synthetic bases, route/cross-link model, schema.org derivation (phase 4, `StructuredData` stubbed `@alpha`) | **exists, v4-redesigned** (`packages/model`); absorbed the plugin's `multi-entry-resolver.ts`, `route-collisions.ts`, `synthetic-bases.ts` in phase 2 |
| `@tsdoctor/registry` | external type loading, VFS, Twoslash environments | **exists** (`packages/registry`; tag ids `"@tsdoctor/registry/..."` since phase 2) |
| `@tsdoctor/bundle` | bundle spec + fetchers (local dir, npm tarball, GitHub release) — spec in `bundle-spec.md` | **exists** (`packages/bundle`, phase 2); formalized `fromDir` discovery |
| `@tsdoctor/pages` | framework-neutral doc IR rendered to markdown via mdast (**phase 5, deferred**) | page generators minus JSX emission |
| `@tsdoctor/snapshot` | SQLite incremental system + per-page metadata (OG/SEO) | **exists** (`packages/snapshot`, phase 2); `SnapshotService` extracted from the plugin onto `Store.layerSqlite` |
| `rspress-plugin-api-extractor` | thin adapter: RSPress hooks, React runtime, remark plugins, llms.txt wiring | `platforms/rspress/`, consuming all four core packages |

`@tsdoctor/pages` is deliberately last: per the settled decision in `roadmap-1.0.md`, the IR is extracted in phase 5 alongside the VitePress adapter so two live consumers shape it.

### Future Packages (Idea-Stage Stubs)

Recorded as ideas only — **deliberately unscheduled, no phase, no gate**:

- **`@tsdoctor/cli`** — a CLI package shipping a `tsdoctor` binary. Base use case: convenient scaffolding of repo and docs-site structures so people get up and running quickly (init a docs site, wire the plugin config, generate the bundle folder layout). Built on `effect/unstable/cli` (core's CLI framework — `@effect/cli` is dead on the v4 line), `@effected/cli` (the CLI boundary: `CliLogger` plain rendering, `CliRuntime` exit-code/failure handling), and `@effected/templates` (managed BEGIN/END sections in user-editable files). It slots naturally into the @effected foundation map below (the `cli`/`templates` rows).

## Foundation: @effected

**Standing rule (mandated):** `@effected/*` is the low-level foundation for every `@tsdoctor` subsystem. Check the kit before hand-rolling. When the kit lacks a capability, the gap is closed by EXPANDING `@effected` through dogfood loops (the `/silk:dogfood` protocol against the sibling `effected` checkout) — never by re-implementing the capability locally.

### Per-Package Dependency Map

Verified against the `@effected` package index (kit version 0.12.0-era; all kit packages published 0.x):

- **`@tsdoctor/registry`** — already consumes `@effected/semver`, `@effected/store` (`Cache`), `@effected/tsconfig-json`, and `@effected/xdg`; these are its existing peers and the phase 1 move preserved them exactly (see `monorepo-consolidation.md`).
- **`@tsdoctor/model`** — `@effected/markdown` for TSDoc prose → mdast and for building markdown programmatically (28 constructible node classes, `Markdown.stringify`, frontmatter codecs, section finders); `@effected/package-json` (typed Package model including repository/maintainers — feeds the phase 4 schema.org derivation); `@effected/spdx` (license expressions for attribution and JSON-LD; note `package-json` already delegates license validity to `spdx` — never re-validate downstream).
- **`@tsdoctor/bundle`** — `@effected/package-json` + `@effected/tsconfig-json` (the bundle's two manifest files, `LenientManifest` for discovery-time field-granularity leniency); `@effected/github` (typed REST releases/assets for the GitHub-release fetcher); `@effected/npm` (`NpmRegistry` for the npm-tarball fetcher plus the dependency-specifier vocabulary); `@effected/semver` (version specs); `@effected/store` `Cache` + `@effected/xdg` (cached fetched artifacts, the same pattern the registry already uses); `@effected/glob` and/or `@effected/walker` for `fromDir`/`fromParentDir`-style discovery; `@effected/jsonc`'s `JsoncFingerprint` (RFC 8785/JCS canonicalization + SHA-256 through core's `Crypto` service) for `BundleHash.ts`'s coarse layer hashing and fine per-field fingerprints.
- **`@tsdoctor/snapshot`** — **RESOLVED (2026-08-24, evaluated against installed `@effected/store@0.4.0` source): adopt Store for both tables.** The evaluation's original framing ("does Store's model fit the relational `file_snapshots` table, or does the kit want a tabular capability grown") presupposed Store is KV-shaped — it is not. `Store` is a schema-versioned, migrated SQLite `SqlClient`: its shape is `{ client: SqlClient, migrate, rollback(toId), status }`, where `client` is the full `effect/unstable/sql` tagged-template client (arbitrary DDL/DML, `withTransaction`, PRAGMAs), and `Store.layerSqlite({ filename, migrations })` bundles the SAME `SqliteClient.layer` from `@effect/sql-sqlite-node` the previous hand-wired stack used (WAL on by default); the KV half is the separate `Cache` service. Consequence: `@tsdoctor/snapshot` is built on `Store.layerSqlite` — the existing `001_create_snapshots` SQL ports verbatim as `StoreMigration { id: 1 }`, all queries/batch-upserts/conditional `ON CONFLICT` run unchanged through `store.client`, and the package sheds its direct `@effect/sql-sqlite-node` + Migrator hand-wiring while gaining rollback/status/typed migration errors. The WAL-checkpoint finalizer originally ported by hand via `store.client` (an `Effect.addFinalizer` wrapping `PRAGMA wal_checkpoint(TRUNCATE)`) is now gone from the package entirely: candidates (c) and (d) below shipped in the released effected round-1 kit wave, and `SnapshotServiceLive` was updated to pass `checkpointOnClose: true` to `Store.layerSqlite`, which registers the identical finalizer inside `@effected/store` itself. The forward bundle-fingerprints table (`bundle-spec.md`'s change-detection section) lands as migration 2 in the same store — chosen over `Cache` because a build-end commit can then upsert file snapshots AND fingerprints in ONE transaction (`Cache`'s `set` cannot enlist in a caller's transaction), and because durable state whose loss corrupts incremental correctness does not belong in a thing named Cache with eviction switched off. One migration-ledger caveat: Store's ledger (`_store_migrations`) differs from the effect Migrator's ledger table, so a pre-existing committed `api-docs.db` gets migration 1 re-applied on first Store run — harmless because `001_create_snapshots` is `CREATE TABLE IF NOT EXISTS`; the phase-2 boundary (before any migration 002 exists) is the safe switch window.
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

The posture: gaps found while building `@tsdoctor` are signal that the kit wants the capability. They are raised through dogfood loops with `file:` overrides against the local `effected` checkout, per the `/silk:dogfood` protocol, and adopted on the next kit release wave.

## Where RSPress Coupling Actually Lives

The key architectural finding from the planning session: RSPress coupling is confined to three areas, and everything else is framework-neutral or nearly so.

1. **The runtime React components** — the SSG-MD dual-mode rendering and Twoslash tooltips (`component-development.md`, `ssg-compatible-components.md`). VitePress is Vue; none of this ports. Each adapter owns its component layer outright.
2. **The remark/HAST pipeline** — `remarkWithApi`, `remarkApiCodeblocks`, and the ShikiCrossLinker post-processing. VitePress uses markdown-it, not remark, and ships first-class Twoslash via `@shikijs/vitepress-twoslash`, so the VitePress adapter does not port this pipeline — it integrates with the native one.
3. **Lifecycle wiring** — the RSPress `config`/`afterBuild` hooks and llms.txt post-processing (`llms-integration.md`).

Everything outside those three areas — model loading and TSDoc extraction, route/cross-link computation, type registry and VFS construction, the snapshot system, page content generation minus JSX emission — belongs in core.

## The Adapter Contract

A sketch of the boundary, to be hardened by the VitePress alpha (phase 5):

**An adapter receives from core:**

- Resolved API models (loaded, categorized, multi-entry-resolved, synthetic bases applied)
- Cross-link route maps
- Generated markdown / doc IR (`@tsdoctor/pages`, once it exists)
- VFS and Twoslash environments (`@tsdoctor/registry`)
- Snapshot decisions (what changed, what to regenerate) and per-page metadata (`@tsdoctor/snapshot`)
- Derived structured data (schema.org JSON-LD, phase 4, computed in `@tsdoctor/model`)

**An adapter owns:**

- Its component layer (React for RSPress, Vue for VitePress)
- Code-block rendering integration (remark pipeline here; `@shikijs/vitepress-twoslash` there)
- Framework lifecycle wiring (hooks, dev server, build phases)
- Framework-specific SEO and llms.txt injection points

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
- **Why `@effected/*` is mandated rather than suggested:** the consolidation exists to shorten the loop between the kit and its consumers; hand-rolling a capability the kit should own would recreate the drift the move eliminates, and the dogfood protocol makes expanding the kit cheaper than maintaining a local fork of the idea.
- **Why the open decisions stayed open through phase 1 (both now resolved):** the manifest shape was expected to need the phase 2 fetcher work to test the sidecar against real non-npm inputs (in the event, the 2026-08-24 planning session resolved it ahead of that), and the model API redesign was scoped by the deferred shim collapse — phase 1 kept the shims verbatim precisely so the redesign decision could be made cleanly, as it now has been.

## Related Documentation

- **Umbrella roadmap and phase gates:** `roadmap-1.0.md`
- **Bundle spec (sidecar manifest, tiers, provenance, fetchers):** `bundle-spec.md`
- **Phase 1 executed record:** `monorepo-consolidation.md`
- **Current architecture and the four delegation shims:** `build-architecture.md`
- **Registry/VFS/Twoslash internals moving to `@tsdoctor/registry`:** `type-loading-vfs.md`
- **Snapshot system moving to `@tsdoctor/snapshot`:** `snapshot-tracking-system.md`
- **Page generators that seed `@tsdoctor/pages`:** `page-generation-system.md`
- **Route/cross-link model moving to `@tsdoctor/model`:** `cross-linking-architecture.md`
- **RSPress-owned component layer:** `ssg-compatible-components.md`
- **llms.txt wiring staying in the adapter:** `llms-integration.md`
