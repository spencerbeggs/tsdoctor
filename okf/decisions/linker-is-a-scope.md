---
type: Decision
status: stable
title: A linker is a scope — no mutable current-scope holder
description: CrossLinker and ShikiCrossLinker are immutable per-API values, not module-level state a build swaps in and out.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 489a276027d91627371b7420a4a9e9e4f920b49a88bfb6e7b37ef52bcfd18214
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# A linker is a scope — no mutable current-scope holder

## Context

Cross-linking turns type references into clickable links at two levels: in
prose (`CrossLinker`) and in Shiki-rendered code blocks (`ShikiCrossLinker`).
`generateApiDocs` runs per API concurrently, and both linkers must resolve
names against the route map of the API whose page is currently being built —
not whichever API happened to run last.

## Decision

`CrossLinker.fromRoutes(routes)`[^1] and
`ShikiCrossLinker.fromRoutes(routes, apiScope)`[^2] are immutable values
constructed once per API from that API's own route map. The prose linker
travels as a value through the pipeline context into `buildPage`; the Shiki
linker sits behind that API's `VfsRegistry`[^3] entry for the remark plugins
to read by scope. There is no mutable "current scope", no `reinitialize`
method, and no scope parameter on `transformHast` — the caller selects the
scope by selecting which linker instance it calls. Anything a builder needs
reaches it as a value on `BuildPageInput`, never through a shared holder.

Cross-linking in code blocks runs as HAST post-processing after Shiki
renders, rather than during rendering, because Twoslash's hover-popup
positioning depends on the original HAST structure the renderer produced;
mutating spans during rendering shifted or broke the popup containers.

## Alternatives rejected

- **A module-level prose linker swapped per API.** This is what the RSPress
  generators did before the page IR lift, and it was a real, observed bug:
  under a multi-API build, `generateApiDocs` running concurrently meant one
  API's prose could be linked against a different API's route map, producing
  cross-links that pointed at the wrong package's pages. The IR builder
  fixed this by taking the `CrossLinker` per API through the pipeline
  context instead.
- **Cross-link during Shiki rendering rather than as post-processing.**
  Rejected because Twoslash's popup positioning is a function of the HAST
  Shiki produced; modifying it mid-render broke popup containers.

## Consequences

- A linker's scope is a property of the value, not of when a build phase
  runs — reintroducing a module-level "current scope" for any future linker
  is exactly the defect class this decision closes.
- Adding a new cross-linking consumer means threading the relevant linker
  value to it explicitly (via pipeline context or `VfsRegistry`), never
  reaching for global/module state to avoid the plumbing.
- `VfsRegistry.clear()` runs at the start of each build alongside the other
  per-build resets, since a registry entry is scoped data that must not
  survive into the next build.

[^1]: [packages/model/src/CrossLinker.ts](../../packages/model/src/CrossLinker.ts)
[^2]: [platforms/rspress/src/shiki-transformer.ts](../../platforms/rspress/src/shiki-transformer.ts)
[^3]: [platforms/rspress/src/vfs-registry.ts](../../platforms/rspress/src/vfs-registry.ts)
