---
type: Convention
status: draft
title: Never set private:false in a publishable workspace's source package.json
description: publishConfig controls publishing; the build rewrites the manifest.
tags: [release]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 7702d87a0a65027495c55ec4bd5b799ce782eb82597bbc0e8e2a397341713494
---

# Never set `private: false` in a publishable workspace's source `package.json`

Every publishable workspace's source `package.json` carries `"private":
true`[^1] — always, even for a package that ships to npm. Never edit that
field to `false` to "fix" publishing; publishing is controlled entirely by
each package's `publishConfig` block, which the build tool rewrites into the
final manifest.

`platforms/rspress/package.json`'s `publishConfig` sets `"access": "public"`,
`"directory": "dist/dev/pkg"`, `"linkDirectory": true` and `"targets": {
"npm": true }`[^1]. `directory` + `linkDirectory` also make `dist/dev/pkg`
the workspace link target: a sibling site depending on the plugin via
`workspace:*` imports the built per-file JS under `dist/dev/pkg`, never
`src/`. The core `packages/*` workspaces (`@tsdoctor/vfs`, `@tsdoctor/model`,
etc.) and `platforms/vitepress` carry the same `"private": true` source
manifest with their own `publishConfig`[^2].

`@savvy-web/bundler` and `@savvy-web/rspress-builder` — the build tools
invoked by each workspace's `build:dev` / `build:prod` script — transform
`package.json` at build time: they flip `private` to `false`, rewrite
`exports` to point at the built output and produce the manifest that
actually reaches npm. The source manifest never needs to say `private:
false` itself; that would only make the *source* checkout on disk look
publishable while doing nothing to change what the builder emits.

## Why

A hand-edited `private: false` in source has no effect on what gets
published — the builder controls that — but it does remove the guard that
stops `pnpm publish` (or an accidental `npm publish`) from running directly
against the unbuilt source tree, which has `src/`-relative `exports` and
would publish broken paths.

## How to check

```bash
grep '"private"' packages/*/package.json platforms/*/package.json
```

Every line must read `"private": true`. Confirm a workspace's actual publish
target by reading its `publishConfig` block, not its `private` field.

[^1]: [platforms/rspress/package.json](../../platforms/rspress/package.json)
[^2]: [packages/vfs/package.json](../../packages/vfs/package.json)
