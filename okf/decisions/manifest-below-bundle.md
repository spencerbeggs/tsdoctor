---
type: Decision
status: stable
title: "@tsdoctor/manifest sits below @tsdoctor/bundle"
description: Split the tsdoctor.json schema out of the bundle package so a writer can depend on encode/decode without the bundle's fetch, cache and discovery stack.
tags: [architecture, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 4642686e9a5a8edece258633d0e423855ac97eb6b0928f3c3daeadbb26b050b9
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# `@tsdoctor/manifest` sits below `@tsdoctor/bundle`

## Context

`@savvy-web/bundler`'s meta build pass needs to write a `tsdoctor.json`
sidecar manifest — call `encodeBundleManifest` and produce a
schema-conformant file — without also pulling in `@tsdoctor/bundle`'s
fetch, cache and discovery stack (npm tarball fetching, GitHub release
fetching, XDG-backed caching), none of which a build-time writer needs.
Until this split, the `tsdoctor.json` schema, its encode/decode boundary
and every fetcher and resolver that reads it lived in one package.

## Decision

Split the schema out of `@tsdoctor/bundle` into a new package,
`@tsdoctor/manifest`: `BundleManifest`, `MANIFEST_SPEC`,
`encodeBundleManifest` / `decodeBundleManifest` and the `ManifestSource`
authoring-file shape[^1]. `@tsdoctor/manifest` depends on `effect` alone —
no `@effected/*` dependency[^2] — so a writer that needs only the schema
boundary carries the lightest dependency closure available.
`@tsdoctor/bundle` depends on `@tsdoctor/manifest` and re-exports every
manifest name[^3], so every reader inside this repository imports from
`@tsdoctor/bundle` rather than reaching past it to the manifest package
directly. Both adapters (`platforms/rspress`, `platforms/vitepress`) list
`@tsdoctor/manifest` directly in `dependencies`, not merely as a
transitive workspace edge[^4] — the same dependency-closure discipline
that keeps the rest of the `@tsdoctor/*` graph explicit rather than
implicit.

## Alternatives rejected

- **Keep the schema inside `@tsdoctor/bundle` and have the bundler build
  pass depend on the whole package.** Rejected: the writer would gain the
  fetch/cache/discovery stack purely to reach `encodeBundleManifest`,
  the same "substrate a second consumer needs without the rest of the
  stack" problem the `@tsdoctor/vfs` split solved for the registry and
  the model.
- **Let the adapters resolve `@tsdoctor/manifest` transitively through
  `@tsdoctor/bundle` rather than declaring it directly.** Rejected: the
  RSPress dependency-closure invariant treats every `@tsdoctor/*` package
  an adapter's own code imports directly as belonging in that adapter's
  own `dependencies` block, regardless of what a sibling workspace already
  pulls in.

## Consequences

- `@tsdoctor/manifest`'s bare `effect` dependency is the reason
  `@savvy-web/bundler`'s meta pass can depend on it without inheriting
  npm-fetch or GitHub-fetch code paths it never exercises.
- A reader inside this repository that imports manifest types directly
  from `@tsdoctor/manifest` instead of `@tsdoctor/bundle` is bypassing the
  intended single entry point; `@tsdoctor/bundle`'s re-export is the
  supported surface.
- Any future third writer of `tsdoctor.json` (a different bundler, a
  hand-written script) has the same lightweight dependency to reach for
  that `@savvy-web/bundler` already uses.

[^1]: [packages/manifest/package.json](../../packages/manifest/package.json)
[^2]: [packages/manifest/package.json](../../packages/manifest/package.json)
[^3]: [packages/bundle/src/index.ts](../../packages/bundle/src/index.ts)
[^4]: [platforms/rspress/package.json](../../platforms/rspress/package.json)
