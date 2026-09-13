---
type: Decision
status: draft
title: A working VitePress alpha gates every core package's 1.0
description: Core @tsdoctor/* packages stay pre-1.0 until platforms/vitepress proves the core/adapter boundary as a second live consumer; rspress-plugin-api-extractor ships 1.0.0 on that same core.
tags: [release, architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: bfd32dcf3dcd20e5912fe038d924f7ef4b8d3cf8c18214b50b24c0337106e7a4
---

# A working VitePress alpha gates every core package's 1.0

## Context

Eight `@tsdoctor/*` core packages under `packages/`[^1] and one adapter,
`rspress-plugin-api-extractor`, existed for several phases with exactly one
consumer of the core/adapter boundary. Every core package sat on a fresh
0.x line — `packages/vfs` at 0.2.4, `packages/registry` at 0.3.6,
`packages/model` at 0.6.6, `packages/manifest` at 0.1.2, `packages/bundle`
at 0.3.3, `packages/snapshot` at 0.2.6, `packages/seo` at 0.2.2,
`packages/pages` at 0.1.7[^2] — and the RSPress adapter itself at 0.16.5.
A boundary drawn from a single consumer is drawn by inference, not by
measurement: whatever the RSPress adapter happened to need shaped what
counted as "core" versus "adapter-specific", and nothing forced that split
to be tested against a second framework.

## Decision

Core `@tsdoctor/*` packages do not reach 1.0.0 until a working VitePress
adapter alpha proves the seams a second live consumer actually needs.
`platforms/vitepress`[^3] (`vitepress-plugin-api-extractor`, currently
0.2.5) is that alpha: markdown-only, no Vue components, consuming the same
eight core packages the RSPress adapter does, exercised end to end by the
`sites/vitepress-basic` fixture[^4]. `rspress-plugin-api-extractor@1.0.0`
ships on top of that same 1.0 core — not independently and not ahead of
it. Docusaurus support, a third possible adapter, is explicitly deferred
until after 1.0. TS7 and the eventual replacement of `@microsoft/api-extractor`
stay off the 1.0 critical path entirely: the bundle spec in
`packages/bundle`[^1] is the firewall between doc generation and whichever
toolchain produced the `api.json` model, so nothing about reaching 1.0
depends on which TypeScript compiler generation is in use.

## Alternatives rejected

- **Ship `rspress-plugin-api-extractor@1.0.0` first, on core packages
  still at 0.x.** Rejected: a 1.0 promise on a package's public surface
  is a promise about the whole surface, including the parts only a second
  adapter would exercise; shipping the adapter first would freeze an
  unproven boundary.
- **Declare the core packages 1.0 once the VitePress alpha merely
  compiles.** Rejected: the gate is a working alpha that proves the same
  bundle produces the same routes and anchors, Twoslash runs over the
  same VFS, prose links resolve and the sidebar is built from the same
  nav tree — a compiling adapter that diverges on any of those has not
  actually tested the boundary.
- **Block 1.0 on TS7 / API Extractor migration.** Rejected: the bundle
  spec already decouples doc generation from the model-producing
  toolchain, so the model schema, not the tool that authored it, is the
  actual input contract.

## Consequences

- Every core package stays on a 0.x line, and every breaking change to a
  core package's public surface is still a semver-free adjustment until
  the VitePress alpha gate is declared held and the packages move to 1.0
  together.
- The remaining 1.0 work is enumerated as: closing out `Render`'s
  deprecation in `packages/model` a minor after it shipped (see
  [deprecate-model-render.md](deprecate-model-render.md)); the next core-move
  tier measured by building the VitePress adapter and not yet taken;
  an unscheduled follow-up (requested 2026-09-03) to generate a versioned
  JSON Schema for `tsdoctor.json` from `@tsdoctor/manifest`'s
  `BundleManifest` via `@effected/schemastore`, emitted to the repo root
  under `schemas/<version>/tsdoctor-<version>.json` for SchemaStore
  submission; and the final phase-7 pass to stabilize APIs, write user
  docs and finalize deprecations before tagging 1.0 across the core and
  `rspress-plugin-api-extractor@1.0.0` on top of it.
- Docusaurus support and a `@tsdoctor/cli` scaffolding binary are both
  explicitly post-1.0 ideas with no phase or gate committed against them.

[^1]: [packages/bundle](../../packages/bundle)
[^2]: [packages/vfs/package.json](../../packages/vfs/package.json)
[^3]: [platforms/vitepress](../../platforms/vitepress)
[^4]: [sites/vitepress-basic](../../sites/vitepress-basic)
