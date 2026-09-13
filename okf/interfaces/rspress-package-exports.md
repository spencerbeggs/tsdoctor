---
type: Interface
status: draft
kind: api
resource: ../../platforms/rspress/package.json
title: rspress-plugin-api-extractor package exports
description: Three entry points -- ".", "./runtime", "./tsconfig/rspress.json" -- plus the "./env" types-only export.
tags: [compat, release]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 25064406bf114454019823fcf18d821bb40da1a347f0d027d3fb34dd13f7513a
---

# `rspress-plugin-api-extractor` package exports

## The entry points

`package.json`'s `exports` map[^1] promises four entries:

| Entry | Points at (source) | Consumer gets |
| --- | --- | --- |
| `.` | `src/index.ts` | the `ApiExtractorPlugin` factory, `serve`, and every exported option type |
| `./env` | `src/env.d.ts` (types only) | ambient module declarations (e.g. CSS module typings) |
| `./runtime` | `src/runtime/index.tsx` | the React runtime components |
| `./tsconfig/rspress.json` | `public/tsconfig/rspress.json` | an RSPress React-JSX, bundler-resolution tsconfig for a site to extend |

In the built package these source-relative paths are rewritten by
`@savvy-web/rspress-builder`'s `build()` to point at the emitted per-file
`dist/dev/pkg/` (or `dist/prod/`) layout; a consumer's `workspace:*`
dependency resolves against `publishConfig.directory`
(`dist/dev/pkg`)[^1], never against `src/`.

## The main entry (`.`)

Exports the `ApiExtractorPlugin` factory function (with `api.fromDir` /
`apis.fromDir` attached as namespaces — see
[rspress-plugin-options.md](rspress-plugin-options.md)) plus `serve`. `serve(options?)`
is a dev/preview runner[^2]: it frees the target port (best-effort), spawns
`pnpm rspress dev|preview`, streams output and opens a browser once RSPress's
own readiness line appears. `ServeOptions`, `ServeMode`,
`ResolvedServeConfig`, and the pure helpers `isServerReady` and
`resolveServeConfig` are exported alongside it; the process-spawning side
effects are deliberately not unit-tested — only the pure helpers are.

## The runtime entry (`./runtime`)

Exports React components consumed directly in generated MDX: `ApiSignature`,
`ApiMember`, `ApiExample`, `ParametersTable`, `EnumMembersTable`, and the
supporting toolbar/table pieces[^3]. Two components —
`ApiLlmsPackageActions` and `ApiLlmsViewOptions` — are **not** exported here;
they are registered by absolute path through RSPress's own
`globalUIComponents` / `resolve.alias` mechanisms instead, because importing
them from the pre-imported runtime path would pull `react-dom` into every
page. The runtime is emitted **bundleless**, one file per component, so that
`import.meta.env.SSG_MD` is resolved by RSPress's own per-site compile rather
than frozen at plugin-build time — see
[../decisions/bundleless-per-file-runtime.md](../decisions/bundleless-per-file-runtime.md).

## Peer dependencies

`@rspress/core`, `react`, and `react-dom` are the only three
`peerDependencies`[^1]; every other runtime dependency the plugin needs
(the full `@tsdoctor/*` core closure, `@effected/*`, `ioredis`, etc.) is
declared directly in `dependencies` so a consumer's `pnpm autoInstallPeers`
never has to guess a version for them.

[^1]: [platforms/rspress/package.json](../../platforms/rspress/package.json)
[^2]: [platforms/rspress/src/serve.ts](../../platforms/rspress/src/serve.ts)
[^3]: [platforms/rspress/src/runtime/index.tsx](../../platforms/rspress/src/runtime/index.tsx)
