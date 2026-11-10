---
type: Decision
status: stable
title: Emit the runtime bundleless, per file
description: The React runtime is transpiled 1:1 per component rather than bundled, so import.meta.env.SSG_MD resolves per site.
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
  - by: human:spencer
    at: 2026-11-02T19:11:05Z
  - by: human:spencer
    at: 2026-11-09T18:10:30Z
integrity:
  generated:
    body: 6207226d843793fe
  verified:
    by: human:spencer
    at: 2026-11-09T18:10:30Z
    content: bd94efa13df83e81
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

The runtime (`./runtime` export) is built by a `[[package.build.overrides]]`
block in the adapter's `effected.toml`[^1] (`entries = ["./runtime"]`,
`outSubdir = "runtime"`, `platform = "browser"`), emitted bundleless: each
component is transpiled 1:1 into its own `.js` under `runtime/`, with
`react`, `react/jsx-runtime`, `@rspress/core` and `@theme` left external,
CSS modules compiled through `@tsdown/css` with `inject = true`, and
`import.meta.env.SSG_MD` left unresolved, so RSPress does the final
per-site compile and resolves `import.meta.env.SSG_MD` for real. A single
bundled `runtime/index.js` froze that value to `undefined`, which
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

`effected package build` writes the package to `dist/prod/npm/pkg`. The
source manifest stays `"private": true`[^3] and its `exports` resolve to
`src/` by default; every export also carries an `effected-built` condition,
listed first, pointing at the built file under `./dist/prod/npm/pkg/`[^3]
(the build strips it from the published manifest). The fixture sites run
under `NODE_OPTIONS=--conditions=effected-built` and prepend
`effected-built` to rspack's `resolve.conditionNames`, so a site depending
on the plugin via `workspace:*` imports the built per-file JS rather than
`src/`; under the default condition `import.meta.url` would point into
`src/`, where the `runtime/components/.../index.js` paths do not exist.

## Alternatives rejected

- **Bundle the runtime into one `runtime/index.js`.** Rejected: it collapses
  `import.meta.env.SSG_MD` to a build-time constant (`undefined`), so the
  dual-mode branch can never take the markdown path.
- **Resolve the LLMs component registrations against a source-tree-relative
  path.** Rejected: that path only resolves against the dev workspace link
  (`src/`), not the published package root, so the registration would work
  in this monorepo and break for every external consumer.
- **Run the fixture sites against `src/` directly.** Rejected: sites would
  then exercise TypeScript source rather than the exact per-file JS artifact
  that ships, hiding build-only breaks (a missing export condition, a wrong
  runtime path) until publish. The workspace link itself resolves to `src/`
  for tests and type-checking; the sites opt into the built output through
  the `effected-built` condition.

## Consequences

- Any new runtime component must stay a plain named export transpiled 1:1;
  `import * as` of a sibling runtime module forces a shared webpack runtime
  chunk outside `runtime/` and breaks the per-file layout.
- The two LLMs components' absolute-path registration only works because
  every emitted package root has the same flat shape; changing that shape is
  a breaking change to `plugin.ts`'s registration logic, not just to the
  build.
- Every fixture site under `sites/*` exercises the real built artifact via
  the `workspace:*` link under the `effected-built` condition, so a
  build-only regression surfaces in the fixture sites before it reaches any
  external consumer.

[^1]: [platforms/rspress/effected.toml](../../platforms/rspress/effected.toml)
[^2]: [platforms/rspress/src/plugin.ts](../../platforms/rspress/src/plugin.ts)
[^3]: [platforms/rspress/package.json](../../platforms/rspress/package.json)
