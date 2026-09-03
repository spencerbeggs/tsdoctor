---
status: current
module: rspress-plugin-api-extractor
category: meta
created: 2026-08-24
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/monorepo-consolidation.md
  - rspress-plugin-api-extractor/bundle-spec.md
  - rspress-plugin-api-extractor/render-phase-instrumentation.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
---

# Road to 1.0

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [The 1.0 definition](#the-10-definition)
- [Executed phases](#executed-phases)
- [Remaining work](#remaining-work)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

This is the umbrella roadmap for taking `rspress-plugin-api-extractor` to 1.0.0 while generalizing from an RSPress-specific plugin into a shared toolkit for static TypeScript documentation sites under the `@tsdoctor` npm org — VitePress for certain, possibly Docusaurus later — with LLM-first documentation and proper SEO as core missions. The fundamental contract: give us an api.json and we transform it into static docs. The package architecture is `tsdoctor-package-architecture.md`; this document records what each phase delivered and what remains.

## Current state

Phases 1 through 5 are executed. Seven core packages exist under `packages/` (`vfs`, `registry`, `model`, `bundle`, `snapshot`, `seo`, `pages`), two adapters under `platforms/` (`rspress`, `vitepress`), and the RSPress adapter runs on the shared page IR. Releases ship from this repo through changesets, tagged `<package>@<version>`; the pre-consolidation npm packages `type-registry-effect` and `api-extractor-llms` are deprecated with their repos archived. The plugin is pre-1.0 and every core package is on a 0.x line.

## The 1.0 definition

Core `@tsdoctor/*` packages do not reach 1.0 until a working VitePress adapter alpha proves the seams — a second live consumer is the only honest test that the core/adapter boundary is drawn correctly. That alpha exists (`vitepress-adapter.md`), so the gate is held. `rspress-plugin-api-extractor@1.0.0` ships on the 1.0 core. Docusaurus support is post-1.0.

## Executed phases

Each phase had a gate that held before the next started; phases were ordered by dependency, not calendar. The durable record of each is the design doc it produced.

1. **Consolidation.** The two external support libraries moved into this monorepo as `@tsdoctor/registry` and `@tsdoctor/model` with no behaviour change, the plugin workspace moved to `platforms/rspress/`, and the first releases shipped under the new org. Record: `monorepo-consolidation.md`.
2. **Carve the core.** `@tsdoctor/bundle` (the bundle spec, `bundle-spec.md`) and `@tsdoctor/snapshot` (on `@effected/store`, `snapshot-tracking-system.md`) were extracted; the model was redesigned as Effect v4 namespace modules and the plugin's delegation shims collapsed into direct usage; the registry's identity strings became tsdoctor-native, with a one-time on-disk cache invalidation accepted.
3. **Instrumentation, then scoping and performance.** Render-phase code-block time was attributed per scope and per block before any optimization; the data put nearly all cost in Twoslash and decided the fix priority: the persisted Twoslash result cache as the performance work, and per-scope TypeScript environments on correctness grounds only. Record: `render-phase-instrumentation.md`. The instrument-first sequencing paid for itself — the first two measurement attempts were both wrong in ways that would have misdirected the fix.
4. **Adapter refactor and SEO layer.** An unnumbered refactor first deleted the adapter's sixteen-field build context in favour of services and `Context.Reference`s, split the runtimes and collapsed the sync-emitter seams (`effect-service-layer.md`), fixing two live defects on the way (a second anchor spelling that produced dead cross-links, and compiler options reaching Twoslash in the wrong spelling). Then `@tsdoctor/seo` landed as the single `headTags` seam, with JSON-LD over `@effected/schema-org` and a change-detection defect closed. Record: `structured-data-and-og.md`. OG image generation was deliberately deferred.
5. **Doc IR and the VitePress adapter.** The Tier 1 core moves extracted `@tsdoctor/vfs` and moved the api-model files into the model; then `@tsdoctor/pages` lifted the page generators into a typed IR, the RSPress adapter switched to it behind a byte-identity gate, and `platforms/vitepress/` plus `sites/vitepress-basic` held the alpha gate: same bundle, same routes and anchors, Twoslash over the same VFS, prose links and head tags resolving, sidebar from the nav tree. Record: `doc-ir-and-pages.md`, `rspress-mdx-emitter.md`, `vitepress-adapter.md`.

## Remaining work

- **Phase 5 close-out:** the model's `Render` deprecation is in place; its deletion a minor later is the recorded lean (`doc-ir-and-pages.md`).
- **The next core-move tier**, measured by building the VitePress adapter and not yet taken (`tsdoctor-package-architecture.md`).
- **Phase 6 — 1.0:** stabilize APIs, write user docs, finalize deprecations; `@tsdoctor/*` core packages go 1.0 and `rspress-plugin-api-extractor@1.0.0` ships on them. TS7 / api-extractor is explicitly off the critical path — the bundle spec is the firewall, since `api.json` is the input contract regardless of which TypeScript produced it.
- **Unscheduled ideas:** `@tsdoctor/cli`, a scaffolding binary (`tsdoctor-package-architecture.md`).

## Rationale

- **Why consolidate:** a change to `@effected/*` used to need two release hops to reach this plugin; in-repo development eliminates them while workspace boundaries preserve the isolated test surfaces the separate repos provided.
- **Why the VitePress-alpha 1.0 gate:** a 1.0 promise on seams only one consumer has exercised is a guess.
- **Why the doc IR waited for phase 5:** an abstraction extracted from two live consumers is shaped by real needs; one designed up front for a hypothetical consumer calcifies wrong.
- **Why instrument before optimizing:** the two candidate fixes had very different costs and no data existed to rank them.
- **Why TS7 is off the critical path:** the bundle spec decouples doc generation from the toolchain that produced the `api.json`.

## Related documentation

- **Target package architecture:** `tsdoctor-package-architecture.md`
- **Phase 1 record:** `monorepo-consolidation.md`
- **Bundle spec:** `bundle-spec.md`
- **Phase 3 record:** `render-phase-instrumentation.md`
- **Phase 4 record:** `structured-data-and-og.md`
- **Phase 5 record:** `doc-ir-and-pages.md`
