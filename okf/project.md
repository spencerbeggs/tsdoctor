---
type: Project
title: tsdoctor
description: Generates API documentation for static-site frameworks from TypeScript API Extractor models, via framework-neutral core packages and thin per-framework adapters.
status: stable
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: b231bec2ebf0cf1358e8a0aed381d35056091611bcc1f3b9e653c5c1309dfd98
---

# tsdoctor

## Purpose

tsdoctor turns a TypeScript API Extractor model (`*.api.json`) into static
API documentation. The fundamental contract is narrow on purpose: give it an
`api.json` and it produces pages, cross-links, navigation and `<head>`
metadata for a static-site framework to publish. The repository is organized
as a set of framework-neutral `@tsdoctor/*` core packages under `packages/`
(loading and decoding the model, external type resolution, the page IR,
SEO/head-tag derivation, incremental-build snapshots, the bundle spec) plus
thin adapters under `platforms/` that render that IR into a specific
framework's dialect — currently RSPress (`platforms/rspress`, published as
`rspress-plugin-api-extractor`) and an alpha VitePress adapter
(`platforms/vitepress`, `vitepress-plugin-api-extractor`). LLM-first
documentation (llms.txt generation, `with-api` Twoslash-checked examples) and
proper SEO (canonical URLs, Open Graph, JSON-LD structured data) are core
missions of the project, not afterthoughts bolted onto one adapter.

## Boundaries

- **Core owns:** model loading and TSDoc extraction, route and cross-link
  computation, external type resolution into a virtual TypeScript
  environment, the page IR (`@tsdoctor/pages`) and its builders, every
  `<head>` tag decision (`@tsdoctor/seo`), the incremental-build snapshot
  store, and the bundle spec (`tsdoctor.json` sidecar manifest,
  provenance resolution, fetchers).
- **Adapters own:** the framework's component/rendering layer, the
  remark/markdown-it or Twoslash integration specific to that framework,
  lifecycle wiring (hooks, dev server), and framework-specific SEO/llms.txt
  injection points. See [`../okf/modules/index.md`](modules/index.md) for
  the adapter and package modules.
- **Workspace layout:** `packages/*` (core `@tsdoctor/*` libraries),
  `platforms/*` (framework adapters), `modules/*` (private fixture
  packages), `sites/*` (private fixture sites exercising the adapters). See
  [`../okf/modules/workspace.md`](modules/workspace.md) for the pnpm/turbo
  mechanics.
- A core package reaching this project's own 1.0 is gated on having two
  live consumers exercise its seams — that gate is why the VitePress
  adapter exists at all, not merely as a nice-to-have second target.

## Non-goals

- **Docusaurus support** is a possible future adapter, explicitly deferred
  past 1.0.
- **The TypeScript compiler / API Extractor toolchain itself is off the
  critical path.** The bundle spec (`tsdoctor.json` plus the `api.json`
  it accompanies) is the firewall between whatever produced the model and
  this project's doc generation; a future TS7-based extractor is a
  producer-side concern this project does not need to track.
- **A `tsdoctor` scaffolding CLI** is an unscheduled idea, not a committed
  deliverable.
- **The pre-consolidation npm packages `type-registry-effect` and
  `api-extractor-llms`** are deprecated; their functionality lives in
  `@tsdoctor/registry` and `@tsdoctor/model` in this repository, and this
  project does not maintain the old packages.
