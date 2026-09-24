---
type: Gotcha
title: A dev session's Twoslash cache never gets saved
description: hooks.buildEnd persists the Twoslash result cache and disposes the runtime, but VitePress never calls buildEnd under `vitepress dev`, so a dev-only session leaves every render-phase result unpersisted for the next build.
resource: ../../platforms/vitepress/src/ApiExtractor.ts
tags: [performance, dx]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: a37eae0a12a4b443d590f5886148979651e9a1b713df4daa36d7d1642a92cda2
status: stable
---

# A dev session's Twoslash cache never gets saved

## What you see

You spend a dev session (`vitepress dev`) iterating on content, hovering
over plenty of Twoslash fences. Later, a production build (`vitepress
build`) — or the next dev session — starts cold: every hover re-runs the
full type-check instead of hitting a warm cache.

## What you will wrongly conclude

That the persisted Twoslash result cache is broken, or that dev-session
hovers do not warm it the way a production build's would.

## What is actually true

`apiExtractor()`'s returned `hooks.buildEnd`[^1] is what persists the
in-memory Twoslash result cache to the shared XDG sqlite store and
disposes the runtime. VitePress's `dev` command never invokes `buildEnd` —
it is a build-only hook — so no dev session, however long, ever reaches
the code path that writes the cache back to disk. Every type-check a dev
session performs is real and correct in the moment, but none of that work
survives the process exiting.

## What to do

Run `vitepress build` at least once to persist a cold cache to disk before
relying on a warm cache for a subsequent build or dev session. A long dev
session is not a substitute for a build when you are trying to warm the
shared cache — only `buildEnd`, which only a real `build` invokes, writes
anything back. If a build after a long dev session still starts cold,
that is expected; it is the dev session that never saved, not the cache
that failed to persist.

[^1]: [platforms/vitepress/src/ApiExtractor.ts](../../platforms/vitepress/src/ApiExtractor.ts)
