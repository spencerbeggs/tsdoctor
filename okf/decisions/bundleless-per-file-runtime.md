---
type: Decision
status: stable
title: Emit the runtime bundleless, per file
description: The React runtime is transpiled 1:1 per component rather than bundled, so import.meta.env.SSG_MD resolves per site.
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 67fa171e3ee8d223de8cb25916fd869813ba0d2a88862e357c01cff2506dfb1c
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# Emit the runtime bundleless, per file

## Context

The RSPress adapter ships two halves: a Node.js plugin and a browser-side
React runtime whose components must render two ways — interactive HTML in
the browser and markdown-only output for LLM consumption — branching on
`import.meta.env.SSG_MD` at render time. `import.meta.env.SSG_MD` is only
defined when RSPress itself compiles the component during a site's own
build.

## Decision

The runtime (`./runtime` export) is built with `runtime: true` in
`savvy.build.ts`[^1], emitted bundleless: each component is transpiled 1:1
into its own `.js` next to its CSS module under `runtime/`, with `react`,
`react/jsx-runtime` and `@theme` left external and `import.meta.env`
preserved as a runtime expression via an identity `define`, so RSPress does
the final per-site compile and resolves `import.meta.env.SSG_MD` for real. A
single bundled `runtime/index.js` froze that value to `undefined`, which
permanently took the browser-render branch and broke the SSG-MD dual-mode
split.

The per-file layout is also load-bearing for component registration outside
the pre-imported runtime path. `plugin.ts` registers `ApiLlmsPackageActions`
via `globalUIComponents` and `ApiLlmsViewOptions` via `builderConfig.resolve
.alias`, both resolved from `import.meta.url`[^2] rather than any
source-tree-relative path. Because every emitted package root — the dev
workspace link and the published root alike — carries the identical flat
`runtime/components/.../index.js` shape, those absolute-path registrations
resolve correctly regardless of which root is in play; a source-relative
path resolves only against `src/` and breaks once the package is published.

The dev build writes `dist/dev/pkg`, and `publishConfig` (`"directory":
"dist/dev/pkg"`, `"linkDirectory": true`)[^3] makes that directory the
workspace link target, so a site depending on the plugin via `workspace:*`
imports the built per-file JS rather than `src/`. The source manifest stays
`"private": true`[^3] with `src/`-pointing exports; the builder transforms
`package.json` during build.

## Alternatives rejected

- **Bundle the runtime into one `runtime/index.js`.** Rejected: it collapses
  `import.meta.env.SSG_MD` to a build-time constant (`undefined`), so the
  dual-mode branch can never take the markdown path.
- **Resolve the LLMs component registrations against a source-tree-relative
  path.** Rejected: that path only resolves against the dev workspace link
  (`src/`), not the published package root, so the registration would work
  in this monorepo and break for every external consumer.
- **Link the workspace against `src/` directly.** Rejected: sites would then
  exercise TypeScript source rather than the exact per-file JS artifact that
  ships, hiding build-only breaks (a missing export condition, a wrong
  runtime path) until publish.

## Consequences

- Any new runtime component must stay a plain named export transpiled 1:1;
  `import * as` of a sibling runtime module forces a shared webpack runtime
  chunk outside `runtime/` and breaks the per-file layout.
- The two LLMs components' absolute-path registration only works because
  every emitted package root has the same flat shape; changing that shape is
  a breaking change to `plugin.ts`'s registration logic, not just to the
  build.
- Every fixture site under `sites/*` exercises the real built artifact via
  the `workspace:*` link, so a build-only regression surfaces in the fixture
  sites before it reaches any external consumer.

[^1]: [platforms/rspress/savvy.build.ts](../../platforms/rspress/savvy.build.ts)
[^2]: [platforms/rspress/src/plugin.ts](../../platforms/rspress/src/plugin.ts)
[^3]: [platforms/rspress/package.json](../../platforms/rspress/package.json)
