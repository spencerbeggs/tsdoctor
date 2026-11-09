---
type: Convention
status: stable
title: Never set private:false in a publishable workspace's source package.json
description: publishConfig controls publishing; the build rewrites the manifest.
tags: [release]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
integrity:
  generated:
    body: 66d0e3fae8db340a
---

# Never set `private: false` in a publishable workspace's source `package.json`

Every publishable workspace's source `package.json` carries `"private":
true`[^1] — always, even for a package that ships to npm. Never edit that
field to `false` to "fix" publishing; publishing is controlled entirely by
each package's `publishConfig` block, which the build tool rewrites into the
final manifest.

`platforms/rspress/package.json`'s `publishConfig` sets `"access": "public"`
and `"targets": { "npm": true }`[^1]; the core `packages/*` workspaces
(`@tsdoctor/vfs`, `@tsdoctor/model`, etc.) and `platforms/vitepress` carry
the same `"private": true` source manifest with their own
`publishConfig`[^2]. There is no `publishConfig.directory` or
`linkDirectory`: the workspace link resolves through `exports` to `src/`,
and each export's leading `effected-built` condition points at the built
file under `./dist/prod/npm/pkg/` for the fixture sites that opt into it.

`effected package build` — each workspace's single `build` script, the bin
from the root `@effected/plugin` devDependency — transforms `package.json`
at build time: it flips `private` to `false`, rewrites `exports` to point at
the built output, strips the `effected-built` condition and writes the
manifest that actually reaches npm into `dist/prod/npm/pkg/`. The source
manifest never needs to say `private: false` itself; that would only make
the *source* checkout on disk look publishable while doing nothing to
change what the builder emits.

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
