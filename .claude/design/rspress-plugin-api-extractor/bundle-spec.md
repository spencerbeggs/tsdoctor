---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-08-24
updated: 2026-08-24
last-synced: 2026-08-24
completeness: 85
related:
  - rspress-plugin-api-extractor/roadmap-1.0.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/monorepo-consolidation.md
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/snapshot-tracking-system.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
dependencies: []
---

# Bundle Spec (`@tsdoctor/bundle`)

> This is the deferred phase-2 design doc named in `roadmap-1.0.md`'s "Deferred Design Docs" table. It records the SETTLED design for the versioned bundle manifest and fetcher contracts, decided in the 2026-08-24 phase-2 planning session — including the resolution of the formerly open "bundle manifest shape" decision (sidecar `tsdoctor.json`; see `tsdoctor-package-architecture.md`). `@tsdoctor/bundle` now exists at `packages/bundle` implementing this spec; the refinements the implementation settled (a `"tsconfig"` provenance source, the `name`-resolution project-tier exception, pair-hashed field fingerprints, layer-0-only discovery) are recorded inline as adopted decisions. The bundler-emission and phase-4+ consumer sides remain forward-looking.

## Table of Contents

- [Overview](#overview)
- [Current State](#current-state)
- [The Layered Resolution Ladder](#the-layered-resolution-ladder)
- [Sidecar Manifest Decision (Resolved)](#sidecar-manifest-decision-resolved)
- [Tier Model and Override Ranking](#tier-model-and-override-ranking)
- [Emit-Time Flattening](#emit-time-flattening)
- [Manifest v1 Shape](#manifest-v1-shape)
- [Open Graph Derivation](#open-graph-derivation)
- [Provenance and Change Detection](#provenance-and-change-detection)
- [Fetchers](#fetchers)
- [Phase 2 Scope](#phase-2-scope)
- [Rationale](#rationale)
- [Related Documentation](#related-documentation)

## Overview

`@tsdoctor/bundle` (new package, `packages/bundle`, phase 2) formalizes the **bundle**: the folder or tarball of files describing one documented package — the plugin's fundamental input contract ("give us an api.json and we transform it into static docs", `roadmap-1.0.md`). The package owns the bundle schema, the layered resolution ladder, the versioned sidecar manifest (`tsdoctor.json`), a provenance-carrying resolver, and three fetchers (local dir, npm tarball, GitHub release).

## Current State

`@tsdoctor/bundle` is implemented at `packages/bundle` (all gates green): the schema, the layered ladder, `tsdoctor.json` parsing, the provenance-carrying resolver, and the fetchers. The prior informal "spec" it formalizes was a three-file folder emitted by `@savvy-web/bundler` via `meta.localPaths` — see the live example at `sites/basic/lib/models/kitchensink/` (`kitchensink.api.json`, `package.json`, `tsconfig.json`) — discovered by the plugin's `fromDir`/`fromParentDir` helpers (`platforms/rspress/src/config-helpers.ts`). A release variant already exists in the wild as GitHub release assets (e.g. `*.npm.meta.tgz` on the vitest-agent repo releases) with source maps added. The bundler does not emit `tsdoctor.json` yet, so its absence is the normal case and everything degrades exactly as before.

## The Layered Resolution Ladder

A bundle is ONE required file plus optional overlays. Each layer **enriches, never gates** — a bundle containing only layer 0 still renders:

| Layer | File | Required | Supplies |
| --- | --- | --- | --- |
| 0 | `<name>.api.json` | yes | package name, entry points, the API itself |
| 1 | `package.json` | no | version (the bundler emits the optimistic NEXT version locally), description, author/contributors, repository (source line links), license, dependencies + peerDependencies (what `@tsdoctor/registry` loads for the rendering scope) |
| 2 | `tsconfig.json` | no | compiler options for the Twoslash/rendering environment |
| 3 | `tsdoctor.json` | no | versioned sidecar manifest: display identity, Open Graph, SBOM pointer, registries |

Layers 0–2 exist today; layer 3 is new with this spec.

## Sidecar Manifest Decision (Resolved)

**RESOLVED (2026-08-24, ahead of schedule — during phase-2 planning rather than mid-phase):** the manifest is a **sidecar `tsdoctor.json`**, NOT a field in the bundle's `package.json`. This closes the "bundle manifest shape" open decision in `tsdoctor-package-architecture.md`, in line with the recorded lean.

Rationale for the sidecar:

- OG/SBOM/registries/display-identity metadata has no legitimate home in `package.json`.
- Spec versioning must evolve independently of npm manifests.
- Non-npm inputs (e.g. GitHub release assets) may lack a meaningful `package.json`.

The sidecar is emitted by the bundler into the bundle folder. It carries an integer `spec` version field — the only required field; all others are optional. Additive fields are minor spec revisions. Documented reader behavior for unknown enum values is **graceful degradation, not rejection**.

## Tier Model and Override Ranking

Manifest data resolves across tiers; **highest wins**:

1. `manifest.platform` — a data-override object passed through plugin options (`ApiExtractorPlugin(options)`). Lets a user with ONLY an api.json declare identity/OG/registries declaratively at plugin-config level; the resolver does the merging for them.
2. `manifest.leaf` — authored in `tsdoctor.json` at the package level.
3. `manifest.project` — the monorepo project tier (e.g. project "Effected" over leaf `@effected/store`), carried in the emitted `tsdoctor.json` as a nested `project` block.
4. `packageJson` — derived.
5. `apiModel` — derived.
6. `inferred` — documented inference rules (e.g. OG alt text).

`tsconfig` sits alongside `packageJson`/`apiModel` in the derived band: fields carried through from layer 2 (compiler options for the rendering environment) resolve with provenance source `"tsconfig"`.

**Deliberate exception to the uniform ranking — `name`.** The unconditional ladder would have a monorepo's project name outranking every leaf package's own name, titling every package identically and contradicting the OG derivation table (`og:title` ← leaf name/tagline ← package name). As implemented: `name` resolves platform → leaf → packageJson → apiModel (project EXCLUDED); `tagline` resolves platform → leaf → project; and project identity is additionally exposed whole as `resolved.project`, feeding `og:site_name` per the derivation table.

## Emit-Time Flattening

Flattening is a **filesystem** concern, not a tier concern. The bundler resolves the authoring-time filesystem hierarchy (root project manifest → leaf) at build/emit time so the emitted `tsdoctor.json` is fully self-contained — a bundle fetched from a GitHub release or npm tarball has no parent directory to walk. But the tiers stay structurally distinguishable in the emitted file (leaf fields top-level, project identity nested under `project`) because provenance is load-bearing (see [Provenance and Change Detection](#provenance-and-change-detection)). What flattening eliminates is the filesystem dependency, never the tier information. There is no `extends` in emitted manifests; inheritance is a bundler-side authoring concern.

## Manifest v1 Shape

```jsonc
{
  "spec": 1,
  "name": "Effected",                 // human display name (npm name is dry; this is SEO-friendly)
  "tagline": "Boring Effect Plumbing Done Right",
  "description": "…",                 // overrides package.json description when present
  "project": { "name": "…", "tagline": "…" },   // inherited project tier, flattened in
  "openGraph": {
    "images": [
      {
        // exactly one of path (bundle-relative asset, plugin publishes + resolves URL)
        // or url (absolute external, used verbatim; secure_url auto-emitted when https):
        "path": "assets/og.png",
        "type": "image/png",          // MIME; inferred from extension when omitted
        "width": 1200, "height": 630, // 1200×630 (1.91:1) is the cross-platform safe default
        "alt": "…"                    // optional; inference chain below
      }
      // multiple images allowed (OG array semantics: first declared wins,
      // extras are alternates e.g. portrait 1000×1500)
    ],
    "themeColor": "#7c3aed"           // optional; Discord embed accent
  },
  "sbom": { "path": "sbom.spdx.json", "format": "spdx-json" },  // the bundler tgz computes an SBOM at
                                                                // publish; downloadable static asset
  "registries": [
    { "type": "npm", "name": "npm", "url": "https://www.npmjs.com/package/@effected/store" },
    { "type": "jsr", "name": "jsr", "url": "…" },
    { "type": "npm", "name": "Savvy Web Registry", "url": "…" }
  ]
}
```

**Registries semantics:** `type` is the PROTOCOL FAMILY — `"npm"` means an npm-compatible registry, so install commands and the tarball fetcher work against any of them (start with `"npm" | "jsr"` literals). `name` is the human instance label. Unknown future types degrade to link-only rendering.

## Open Graph Derivation

Only asset-ish pieces live in the manifest; most OG tags are page-level and derive at render time. The derivation table (verified against ogp.me and opengraph.dev, 2026-08-24):

| Tag | Derivation |
| --- | --- |
| `og:title` | page title ← leaf name/tagline ← package name |
| `og:description` | manifest description ← package.json description; per-page item summary when present |
| `og:url` | plugin computes canonical URL from route (needs site baseUrl — plugin config, not bundle) |
| `og:type` | plugin emits website/article per page kind |
| `og:site_name` | site-level identity (plugin config) or `project.name`; site wins when aggregating |
| `og:locale` / `og:locale:alternate` | plugin's existing i18n config |
| `og:determiner` | skipped, no use for API docs |
| `article:published_time` / `article:modified_time` | already emitted today from the snapshot system (`snapshot-tracking-system.md`) |
| `og:image` + structured props (`url`, `secure_url`, `type`, `width`, `height`, `alt`) | **THE MANIFEST** |
| `twitter:card` | derivable — `summary_large_image` when a 1200×630 image exists |
| `theme-color` | carried in manifest (`openGraph.themeColor`) |

**Alt inference chain** when `alt` is omitted: tagline → description → `"<name> API documentation"` — never empty, since name always resolves. "Require explicit alt" is a consumer-side strictness knob (a plugin/validation option raising `ConfigValidationWarning`), NOT a schema requirement. Reserved-but-unimplemented: per-image `locale` for i18n OG variants.

## Provenance and Change Detection

The resolver produces a `ResolvedBundle` where every field carries value + provenance:

```typescript
type ProvenanceSource =
  | "manifest.platform"
  | "manifest.leaf"
  | "manifest.project"
  | "packageJson"
  | "tsconfig"   // layer-2-derived fields (compiler options)
  | "apiModel"
  | "inferred";

interface Provenanced<A> {
  readonly value: A;
  readonly source: ProvenanceSource;
}
```

Two consequences:

1. **Override detection is mechanical.** A field is user-overridden iff its source outranks the derivation that would otherwise supply it. An `inferred` field tracks upstream changes (a tagline change propagates into the inferred alt text); an authored field is pinned.
2. **Two-level diff against the store** (`@tsdoctor/snapshot`):
   - **Coarse:** per-layer file hashes (canonical-normalize + SHA-256 via `@tsdoctor/bundle`'s `BundleHash.ts`, built on `@effected/jsonc`'s `JsoncFingerprint` — RFC 8785/JCS canonicalization through core's `Crypto` service, the same normalize-then-hash discipline as `content-hash.ts` — see `snapshot-tracking-system.md`). All layer hashes match → skip resolution entirely.
   - **Fine:** per-field diff of the `ResolvedBundle` when a layer hash differs, with each field mapped to an **invalidation scope**: version → version-embedding surfaces only; tagline → page titles + OG; deps/peerDeps → registry reload + Twoslash env rebuild; tsconfig → all code blocks; registries → download/availability UI only. Field fingerprints hash the `{value, source}` **pair**, not the value alone — an override flip that leaves the value unchanged is still a visible diff to change detection.

This lifts the existing snapshot philosophy one level: today the store hashes OUTPUTS (generated MDX) to skip writes; this hashes INPUTS at field granularity to skip generation.

**Boundary:** `@tsdoctor/bundle` owns parsing, resolution, provenance, and canonical hashing; `@tsdoctor/snapshot` persists the layer hashes and resolved-field fingerprints next to the page snapshots. The snapshot store is **Store-backed** (`@effected/store`'s `Store.layerSqlite` — evaluation resolved 2026-08-24: adopt; see `tsdoctor-package-architecture.md`), and the bundle-fingerprints table lands as migration 2 in that store, so a build-end commit upserts file snapshots AND fingerprints in one transaction.

## Fetchers

Three fetchers, built on the `@effected` kit (the mandated foundation — see "Foundation: @effected" in `tsdoctor-package-architecture.md`):

| Fetcher | Source | Kit foundation |
| --- | --- | --- |
| Local dir | bundle folder(s) on disk | `@effected/glob` / `@effected/walker` discovery, generalizing `fromDir`/`fromParentDir` |
| npm tarball | any `type: "npm"` registry | `@effected/npm` (`NpmRegistry`) |
| GitHub release | release assets (the `*.npm.meta.tgz` variant already shipping, e.g. vitest-agent releases) | `@effected/github` typed releases/assets |

The npm and GitHub fetchers live in `packages/bundle/src/BundleFetch.ts` (`fetchNpmBundle` / `fetchGitHubReleaseBundle`), failing with a typed `BundleFetchError` carrying reason literals (`invalidRef`, `download`, `cache`, …). Caching goes through `@effected/store` `Cache` + `@effected/xdg` under the shared `"tsdoctor"` namespace — the same pattern (and now the same namespace) as `@tsdoctor/registry` (`type-loading-vfs.md`): a file plane under `<cache>/bundles/npm|github/...` and a metadata plane of Cache records keyed `bundle:v1:...`, with self-healing cache-hit checks (a hit requires the metadata record AND every file it lists to exist).

**Implementation findings (verified against real assets):**

- **Release assets unpack to a `meta/` root, not npm's `package/`.** The real `*.npm.meta.tgz` release variant (vitest-agent's published assets) has its files under `meta/`; the fetcher probes for the directory containing a `*.api.json` in order: `package/` → the archive root → each subdirectory.
- **The strict `PackageManifest` decode passed clean on a real release asset** — the leniency concern (that real-world manifests might need a forgiving decode) is downgraded.
- **GitHub release assets carry no integrity metadata**, so extraction is integrity-unverified for the GitHub fetcher (the npm path is integrity-verified via `@effected/npm`'s tarball handling). Public-repo assets only for now.

**Discovery requires only layer 0.** The legacy `fromDir` required a `package.json`; per the ladder's enrich-never-gate rule, the implemented discovery accepts a folder containing just the `<name>.api.json` (the bundle name falls back to the model's own name field). The other legacy semantics are preserved: multi-model disambiguation, unscoped-name preference, caller overrides win, strict parent scan, and the empty-parent error. Parent-directory scanning (`discoverBundles`) takes no shared per-bundle name/version overrides — adapter-level defaulting stays in the adapter.

Reading the discovery-time name/version pair from `package.json` (`readDiscoveryPackageJson` in `BundleDiscovery.ts`) originally used a bespoke two-field `Schema.Struct` sniffer; that sniffer is now `@effected/package-json`'s `LenientManifest.parse` — malformed JSON text or a non-object document still fails typed as `invalidPackageJson` (matching the old sniffer), but a malformed individual field now degrades to absence rather than failing the whole read, applying the ladder's enrich-never-gate rule at field granularity (the bundle's own name, from the api.json model, still covers a nameless discovery).

## Phase 2 Scope

Phase 2 implements (now landed in `packages/bundle`): the schema, the ladder for layers 0–2, `tsdoctor.json` parsing with the identity fields, the resolver + provenance, and the three fetchers. The bundler does not emit `tsdoctor.json` yet, so absence is the normal case and everything degrades exactly as before.

OG emission/asset publishing/dimension probing, SBOM surfacing, and registry badges are **phase 4+ consumers** of the spec; the spec reserves their shape now so `@savvy-web/bundler` can start emitting whenever it grows the option.

## Rationale

- **Why a sidecar, not a `package.json` field:** the metadata has no legitimate npm-manifest home, the spec version must move independently of npm's, and non-npm inputs may have no meaningful `package.json` at all.
- **Why enrich-never-gate layering:** the fundamental contract is "give us an api.json" — requiring anything beyond layer 0 would break the cheapest onboarding path and every existing bundle.
- **Why flatten at emit but keep tier structure:** self-containment is required for fetched bundles (no parent directory to walk), but collapsing tiers would destroy the provenance that makes override detection and fine-grained invalidation mechanical.
- **Why provenance is load-bearing:** without per-field sources, "did the user override this or did we derive it?" requires heuristics; with them, override detection and inferred-field propagation are rank comparisons.
- **Why input-hashing complements output-hashing:** output hashes (today's snapshot system) can only skip the write; input hashes at field granularity can skip the generation itself, scoped to exactly the surfaces a changed field invalidates.
- **Why graceful degradation for unknown enum values:** the spec must let old readers consume new bundles — a registry `type` a reader does not know still renders as a link, and an unknown field is ignored, so additive evolution stays minor.

## Related Documentation

- **Umbrella roadmap; this doc's slot in the Deferred Design Docs table:** `roadmap-1.0.md`
- **Target package architecture; the resolved manifest-shape decision and the @effected dependency map:** `tsdoctor-package-architecture.md`
- **Phase 1 executed record:** `monorepo-consolidation.md`
- **Today's `fromDir`/`fromParentDir` discovery this spec formalizes:** `build-architecture.md`
- **The snapshot store that persists layer hashes and field fingerprints:** `snapshot-tracking-system.md`
- **The registry that loads the deps/peerDeps layer for the rendering scope:** `type-loading-vfs.md`
