---
type: Limitation
title: The VitePress adapter is a deliberately scoped alpha
description: platforms/vitepress ships no Vue components, no code-block cross-links, no llms.txt, no multiVersion/i18n/multi-API, no incremental writes and no serve runner, and re-spells three pieces of RSPress's neutral logic that must be kept in step by hand.
bounds: ../modules/vitepress-plugin-api-extractor.md
tags: [architecture, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 2f832cd810af9f4678eafd707a0f8b4db98cb37fae84c3b8f2ecbe27c14cad0b
---

# VitePress adapter alpha scope

## Trigger

Any site built with `vitepress-plugin-api-extractor` — `apiExtractor()` in
`platforms/vitepress/src/ApiExtractor.ts`, exercised by `sites/vitepress-basic`
— rather than `rspress-plugin-api-extractor`.

## Symptom

Several capabilities the RSPress adapter has are simply absent, each a
deliberate scope cut rather than a bug:

- **No Vue components.** Every block renders as markdown or a Twoslash
  fence; there is no interactive runtime layer.
- **No code-block cross-links.** `ShikiCrossLinker` post-processes Shiki's
  HAST output and is coupled to how the RSPress transformer runs; a port
  would be a rewrite, not an import, so code blocks carry prose links and
  working anchors but no in-code link decoration.
- **No llms.txt.** VitePress has no first-party post-processor comparable to
  `@rspress/plugin-llms` to hook into, even though `@tsdoctor/pages`'s
  `Llms.ts` transforms are already framework-neutral and ready.
- **No multiVersion, i18n, or multi-API sites.**
- **No snapshot-tracked incremental writes.** Every file is rewritten on
  every build (`Generate.ts`'s program runs load → build → write with no
  snapshot comparison), so there is no unchanged-file skip and no preserved
  publish timestamps.
- **No `serve` runner** — no equivalent of `platforms/rspress/src/serve.ts`.
- **Open Graph publish failures degrade silently.** With no event bus on
  this adapter, a `publishBundleAssets` failure falls back to no image with
  nothing reported, unlike RSPress's `ConfigValidationWarning`.

Beyond missing features, three pieces of RSPress's neutral logic are
re-spelled rather than shared, and each pair must be kept manually in step:

- `Generate.ts` re-derives import prepending, dependency extraction and
  tsconfig/manifest resolution — the neutral half of RSPress's
  `layers/config-resolution.ts` — using the same `@tsdoctor/vfs`
  `resolveTypeScriptConfig` and `@tsdoctor/seo` `packageContext` seams but its
  own orchestration code.[^1]
- `platforms/vitepress/src/Categories.ts` duplicates RSPress's
  `DEFAULT_CATEGORIES` table and its override-merge logic.[^2] If the two
  lists drift, the same bundle generates different category folders — and
  therefore different routes — depending on which adapter built it.
- `platforms/vitepress/src/Registry.ts` duplicates the `@tsdoctor/registry`
  stack composition and the `"tsdoctor"` XDG namespace literal that RSPress's
  `layers/xdg.ts` also declares.[^3] A namespace mismatch here would silently
  fork the shared type and Twoslash caches between adapters.

## Why this is acceptable

The adapter exists to prove the core/adapter seams a second consumer needs —
markdown pages, working routes and anchors, Twoslash over the shared VFS,
prose links, and head tags — not to reach feature parity with RSPress before
those seams are validated. Each cut capability has an obvious home once a
second real consumer or the 1.0 stabilization pass asks for it; none is a gap
in the architecture.

## What a fix would take

Each missing feature is independent: Vue components are a new component
layer; llms.txt needs VitePress-side hook wiring around the already-ready
`Llms.ts` transforms; incremental writes need a `SnapshotService`-equivalent
wired into `Generate.ts`'s write step; code-block cross-links need either a
markdown-it plugin analogous to the remark pipeline or acceptance that prose
links are sufficient. The three duplicated pieces (config-resolution,
categories, registry) are candidates for extraction into `@tsdoctor/pages` or
a new shared module once a third consumer or the 1.0 pass forces the
decision — the destinations are open, not undecided-forever.

[^1]: platforms/vitepress/src/Generate.ts:29-254
[^2]: platforms/vitepress/src/Categories.ts:6,49
[^3]: platforms/vitepress/src/Registry.ts:23-35
