---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-08-24
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/roadmap-1.0.md
  - rspress-plugin-api-extractor/monorepo-consolidation.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
  - rspress-plugin-api-extractor/vitepress-adapter.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/bundle-spec.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
---

# @tsdoctor package architecture

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [The layer cake](#the-layer-cake)
- [Foundation: @effected](#foundation-effected)
- [Where framework coupling lives](#where-framework-coupling-lives)
- [The adapter contract](#the-adapter-contract)
- [Core-move candidates](#core-move-candidates)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

The `@tsdoctor` org is a set of framework-neutral core packages plus thin per-framework adapters. `rspress-plugin-api-extractor` keeps its npm name and is the first adapter; `vitepress-plugin-api-extractor` is the second and the proof that the seams are drawn correctly. Every adapter depends on `@tsdoctor/*` for everything that is not framework-specific.

## Current state

| Workspace | Package | Contents |
| --- | --- | --- |
| `packages/vfs` | `@tsdoctor/vfs` | The `Vfs` currency type and helpers, `VirtualPackage`, `TsEnvironment`, the compiler-options seam, the Twoslash result cache. Depends on `effect` alone plus optional peers |
| `packages/registry` | `@tsdoctor/registry` | Fetch, cache and resolve published package types into a `Vfs`; tag ids `"@tsdoctor/registry/..."` |
| `packages/model` | `@tsdoctor/model` | Effect v4 namespace modules — `Model`, `Tsdoc`, `ApiItems`, `EntryPoints`, `Routes`, `SyntheticBases`, `Signature`, the deprecated `Render` — plus the `CrossLinker` class, `ApiExtractedPackage`, `TypeReferenceExtractor` and the `Frontmatter` contract |
| `packages/manifest` | `@tsdoctor/manifest` | The `tsdoctor.json` spec-1 sidecar manifest schema: `BundleManifest`, `MANIFEST_SPEC`, `encodeBundleManifest` / `decodeBundleManifest`, the `ManifestSource` authoring-file shape. Depends on `effect` alone |
| `packages/bundle` | `@tsdoctor/bundle` | The bundle spec: discovery, the sidecar manifest (re-exported from `@tsdoctor/manifest`), the provenance resolver, fetchers, `publishBundleAssets` |
| `packages/snapshot` | `@tsdoctor/snapshot` | The incremental-build snapshot store on `@effected/store` |
| `packages/seo` | `@tsdoctor/seo` | Every `<head>` concern behind the `headTags` seam |
| `packages/pages` | `@tsdoctor/pages` | The page IR: blocks, `prepareWorkItems`, the builders, the nav tree, example preparation, the plain-markdown emitter, the llms.txt transforms |
| `platforms/rspress` | `rspress-plugin-api-extractor` | Hooks, React runtime, remark plugins, the MDX and `_meta.json` emitters, llms.txt wiring |
| `platforms/vitepress` | `vitepress-plugin-api-extractor` | The awaited config helper, the markdown / frontmatter / sidebar emitters, native Twoslash wiring |

Each package's own `CLAUDE.md` records its invariants. Every publishable workspace is `private: true` in source with `publishConfig` doing the publishing, on a fresh 0.x line versioned through changesets.

## The layer cake

The model is the vocabulary (api.json, TSDoc, routes, anchors). The VFS is the substrate the registry and the model share so neither depends on the other: `VirtualPackage` and `TsEnvironment` had no consumers inside the registry while the model needed them, and hosting them in either package would have forced an unwanted edge — the registry depending on the api.json vocabulary, or the model dragging the registry's fetch/cache/XDG stack to reuse one Schema class. `@tsdoctor/manifest` is the schema every writer and reader of `tsdoctor.json` shares — `@savvy-web/bundler`'s meta pass writes through it, `@tsdoctor/bundle` re-exports it for every reader in this repo — sitting below the bundle for the same reason the VFS sits below the registry: the writer needs the schema without the bundle's fetch/cache/discovery peers. The bundle is the input contract. The snapshot store is the durable per-page metadata every adapter will need and none should own. SEO and pages are the two seams an adapter renders over. `@tsdoctor/pages` was deliberately last, extracted with two live consumers rather than designed up front.

## Foundation: @effected

`@effected/*` is the mandated low-level foundation for every `@tsdoctor` subsystem: check the kit before hand-rolling, and when the kit lacks a capability, close the gap by expanding `@effected` through the dogfood loop (`/silk:dogfood` against the sibling `effected` checkout, `file:` overrides for the tinkered packages and their peers, a push hook blocking while linked, adoption on the next kit release wave) — never by reimplementing locally. Gaps found while building `@tsdoctor` are signal that the kit wants the capability.

What each package takes from the kit, as declared in its `package.json` (`catalog:effected`):

- **vfs** — `@effected/tsconfig-json` (optional) for the compiler-options seam.
- **registry** — `semver`, `store` (`Cache`), `xdg`.
- **model** — `markdown` for TSDoc prose to mdast, `yaml` behind `Frontmatter.ts`.
- **manifest** — `effect` alone; no `@effected/*` dependency.
- **bundle** — `package-json` and `tsconfig-json` (the bundle's manifest files), `github`, `npm`, `semver`, `store` plus `xdg` for cached fetches, `glob` / `walker` for discovery, `jsonc`'s `JsoncFingerprint` for hashing.
- **snapshot** — `store` (`Store.layerSqlite` with `checkpointOnClose`), `jsonc` for the frontmatter hash.
- **seo** — `schema-org` (vocabulary and the offline conformance validator), `package-json`'s `PackageManifest`, `spdx`.
- **pages** — `markdown` as the IR substrate, including the MDX vocabulary the RSPress emitter serializes through. HTML generation belongs to the consuming framework; the kit's role is the transition step.
- **Tests everywhere** — `memfs` as the in-memory `FileSystem` instead of hand-stubbed layers.

Capabilities the dogfood loop has delivered to the kit and this tree adopted: MDX construction and serialization in `@effected/markdown`; `Store.layerSqlite` option pass-through and `checkpointOnClose`; `Cache.degrading` (which also fixed the interruption-absorbing hand-written degrade it replaced); `@effected/schema-org`'s first release; and minimal inline escaping in `@effected/markdown`, which let both adapters delete their byte-parity shims. Two asks were declined or remain open: per-node control of the presence-keyed MDX `{` escape is a kit invariant (the raw hatch is an inline `Html` node), and a programmatic-spelling input for `TsEnumCodec` is superseded by the `Schema.pick` seam in `@tsdoctor/vfs`. Not yet delivered: an adoption recipe for consumers migrating from the `effect/unstable/sql` Migrator ledger whose pre-Store migrations are not idempotent.

## Where framework coupling lives

RSPress coupling is confined to three areas, and everything else is framework-neutral:

1. **The runtime React components** — SSG-MD dual-mode rendering and Twoslash tooltips. VitePress is Vue; none of this ports, and each adapter owns its component layer outright.
2. **The remark and HAST pipeline** — `remarkWithApi`, `remarkApiCodeblocks` and the `ShikiCrossLinker` post-processing. VitePress uses markdown-it and ships first-class Twoslash, so its adapter integrates with the native pipeline rather than porting this one.
3. **Lifecycle wiring** — the RSPress hooks and the llms.txt post-processing I/O.

Everything outside those — model loading and TSDoc extraction, route and cross-link computation, type registry and VFS construction, the snapshot system, page content — is core.

## The adapter contract

An adapter receives from core: resolved API models (loaded, categorized, multi-entry-resolved, synthetic bases applied); the cross-link route map; the page IR — work items, the `ApiItem` → `Page` builders and the nav tree; the VFS primitives and TypeScript environment populated with resolved external types; snapshot decisions and per-page metadata; and every `<head>` tag as a neutral `HeadTag[]`.

An adapter owns: its component layer; code-block rendering integration; framework lifecycle wiring (hooks, dev server, build phases); framework-specific SEO and llms.txt injection points.

## Core-move candidates

Coupling was counted from inside the code (references to `@rspress`, `shiki`, `hast`, `react`), not judged by file name, and the "wait for two consumers" rule does not apply to a file whose boundary is already proven by an import crossing it — that rule exists to stop abstractions being designed speculatively.

**Taken.** The api-model pair (`ApiExtractedPackage`, `TypeReferenceExtractor`) and `Frontmatter.ts` to the model; the compiler-options pair to `@tsdoctor/vfs`, following `TsEnvironment`; the llms.txt transforms and the scope helpers, `prepareWorkItems` and the page generators to `@tsdoctor/pages`; the Twoslash result cache to `@tsdoctor/vfs` once both adapters wired the same `TwoslashTypesCache` interface and were measured warming one store; the OG and canonical helpers to `@tsdoctor/seo`; the `tsdoctor.json` manifest schema out of `@tsdoctor/bundle` into `@tsdoctor/manifest` once `@savvy-web/bundler` needed to depend on the writer boundary (`encodeBundleManifest`) without the bundle package's fetch/cache/discovery peers — the same "substrate a second consumer needs without the rest of the stack" reasoning that put the VFS below the registry.

**Deliberately staying in the adapter.** `category-resolver.ts` — it merges full category configs across a plugin/package/version precedence chain, which is sidebar presentation plus multiVersion product policy, and the neutral half already exists as `ApiItems.CategorySpec`. `path-derivation.ts` — the `docs/{locale}/{version}/…` layout is indistinguishable from RSPress's own conventions from inside this repo, the case the two-consumer rule is for. The observability cluster — infrastructure rather than logic; a second adapter without diagnostics is a worse product, but that is a 1.0 question.

**The next tier, measured by building the VitePress adapter and not yet taken:** `platforms/vitepress/src/Generate.ts` re-spells the neutral half of RSPress's `layers/config-resolution.ts` (import prepending, dependency extraction, tsconfig resolution, manifest decode to `packageContext`); `Categories.ts` duplicates `DEFAULT_CATEGORIES` and the override merge, and the two must stay in step or the adapters generate different routes from one bundle; `Registry.ts` duplicates the registry-stack composition and the `"tsdoctor"` namespace literal, so the drift hazard `effect-service-layer.md` records spans two packages; and RSPress's `hide-cut-transformer.ts` hand-matches `// ---cut---` instead of using `@tsdoctor/pages`'s directive helpers. Destinations are open; a third consumer or the 1.0 stabilization takes them from this list rather than re-measuring.

**Unscheduled:** `@tsdoctor/cli`, a scaffolding `tsdoctor` binary on `effect/unstable/cli`, `@effected/cli` and `@effected/templates`. An idea only — no phase, no gate.

## Rationale

- **Why keep the `rspress-plugin-api-extractor` name:** name equity; the adapter role changes what is inside, not what consumers install.
- **Why the coupling analysis drives the split:** the three coupled areas are exactly what differs between static-site frameworks; drawing the boundary anywhere else leaks framework types into core or forces adapters to reimplement neutral logic.
- **Why `@tsdoctor/seo` is a package rather than a model module:** SEO is a different domain that keeps growing, and the second adapter must import the derivation. A separate `@tsdoctor/open-graph` was rejected — OG and JSON-LD answer one question from one set of inputs at one call site.
- **Why `@effected/*` is mandated:** the consolidation exists to shorten the loop between the kit and its consumers; a hand-rolled capability the kit should own recreates the drift the move eliminates.
- **Why `Store` for the snapshot store:** it is a schema-versioned, migrated SQLite client, not a KV store — the existing SQL ported verbatim as a migration, and a build-end commit can enlist any future fingerprint table in the same transaction, which a `Cache` cannot.

## Related documentation

- **Umbrella roadmap and phase gates:** `roadmap-1.0.md`
- **Phase 1 record:** `monorepo-consolidation.md`
- **The RSPress adapter's shape:** `build-architecture.md`
- **The page IR:** `doc-ir-and-pages.md`
- **The second adapter:** `vitepress-adapter.md`
- **The vfs / registry split:** `type-loading-vfs.md`
- **The snapshot store:** `snapshot-tracking-system.md`
- **The manifest / bundle split, the writer side and `publishBundleAssets`:** `bundle-spec.md`
- **The `siteName`/`og:title` seam the manifest feeds:** `structured-data-and-og.md`
