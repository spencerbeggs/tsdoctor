---
type: Convention
title: No internal barrels
description: In an adapter's src, only src/index.ts re-exports; every internal import names a concrete module.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 78aaf4c2a56b5b89842360b03b22c5603c85e9c4e52a3f43308ea365b130bde2
stale_after: 2026-12-12T00:00:00Z
tags: [dx, architecture]
sources:
  - id: index
    resource: ../../platforms/rspress/src/index.ts
  - id: vitepress-index
    resource: ../../platforms/vitepress/src/index.ts
---

# No internal barrels

In an adapter workspace (`platforms/rspress/src`, `platforms/vitepress/src`),
`src/index.ts` is the package's **only** barrel.[^index] Every internal
import — anything not crossing the package's own public surface — must name
a concrete module. Do not add a second `index.ts` inside a subdirectory
(`emit/index.ts`, `services/index.ts`, `runtime/index.ts` as an internal
aggregator) that other internal modules import through.

`platforms/rspress/src/runtime/index.tsx` is the one apparent exception and
is not really one: it is the *public* entry for the `./runtime` export
condition, not an internal barrel other `src/` modules import through.

## Why

A barrel counts as a consumer of everything it re-exports, and it hides
unused exports from every reachability or dead-code scan: the scan sees the
barrel importing a symbol and stops there, never checking whether anything
outside the barrel actually uses it. Naming a concrete module at each import
site means a reachability check sees real consumers instead of a re-export
that only looks like one. When the adapter's two internal barrels were
removed, the very next dead-code scan surfaced an orphaned module the
barrels had been hiding.

## How to check

- `grep -rn "from \"\./.*index" platforms/rspress/src platforms/vitepress/src`
  (excluding the package's own top-level `src/index.ts` and the `./runtime`
  public entry) should return nothing.
- A dead-code / reachability scan run after adding a new internal `index.ts`
  is the confirming signal: if it reports a symbol as "used" only because a
  barrel re-exports it, the barrel is doing exactly the hiding this
  convention forbids.

[^index]: `platforms/rspress/src/index.ts` is the package's only barrel;
  `platforms/vitepress/src/index.ts` plays the same role for the second
  adapter.
