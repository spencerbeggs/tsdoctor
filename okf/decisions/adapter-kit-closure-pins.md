---
type: Decision
title: Adapters seal their kit closure at exact versions
description: "Both platforms/* adapters spell every effect, @effect/* and @effected/* runtime dependency catalog:effected:exact and declare every non-optional kit peer in their closure, and the core @tsdoctor/* libraries pin their regular @effected dependencies the same way, so a kit patch never reaches a consumer without a release."
status: stable
tags: [deps, release, compat]
sources:
  - id: owner
    resource: conversation with the repository owner
    author: human:spencer
    last_modified: 2026-11-11T00:00:00Z
  - id: ledger-0011
    resource: npm:@effected/pnpm-plugin-effected@0.26.2
    title: "effected upgrade ledger entry 0011: the effected tool pins its kit closure exactly"
  - id: workspace
    resource: ../../pnpm-workspace.yaml
  - id: rspress-pkg
    resource: ../../platforms/rspress/package.json
  - id: vitepress-pkg
    resource: ../../platforms/vitepress/package.json
  - id: registry-pkg
    resource: ../../packages/registry/package.json
  - id: rspress-test
    resource: ../../platforms/rspress/__test__/kit-closure-pins.test.ts
  - id: vitepress-test
    resource: ../../platforms/vitepress/__test__/kit-closure-pins.test.ts
generated:
  by: okfit/claude-code
  at: 2026-11-12T02:39:25Z
verified:
  - by: human:spencer
    at: 2026-11-12T02:38:59Z
integrity:
  generated:
    body: 942038ff3417f0aa
  verified:
    by: human:spencer
    at: 2026-11-12T02:38:59Z
    content: f81ebfc6d3e01d87
---

# Adapters seal their kit closure at exact versions

## Context

The two adapters, `rspress-plugin-api-extractor` and
`vitepress-plugin-api-extractor`, are what consumers install. Until this
change every kit edge in them was spelled `catalog:effected`, which packs to
a caret on each `0.x` `@effected/*` package. A floating `0.x` patch then
changes the tool a consumer runs with no release of the adapter. A kit
library can also resolve a peer from a different release line than the one
the adapter was built against, which fails at load with "does not provide an
export named …". The effected kit recorded the same rule for its own tool
in upgrade ledger entry 0011, shipped with `@effected/pnpm-plugin-effected`
0.26.2.[^ledger-0011] [^workspace]

## Decision

The repository owner decided this on 2026-11-11.[^owner]

1. **Adapters pin their kit runtime dependencies exactly.** Every `effect`,
   `@effect/*` and `@effected/*` entry in an adapter's `dependencies` is
   spelled `catalog:effected:exact`.[^rspress-pkg] [^vitepress-pkg] That
   catalog is the plugin's operator-stripped twin of `effected`: it packs a
   plain exact version and still moves with every
   `@effected/pnpm-plugin-effected` bump, so nothing is hand-pinned.
   `devDependencies` stay `catalog:effected`.
2. **Adapters declare every non-optional kit peer in their closure.** Any
   `effect`, `@effect/*` or `@effected/*` peer reached anywhere in an
   adapter's installed closure, unless it is marked optional, is also one of
   the adapter's exact runtime dependencies. Applying the rule found one
   gap: `@effected/xdg` peers on `@effected/config-file`, which both adapters
   carried only as a devDependency. It is now an exact runtime dependency of
   both.
3. **Core libraries pin their regular kit dependencies exactly.** A core
   `@tsdoctor/*` library spells each `@effected/*` entry in its
   `dependencies` as `catalog:effected:exact`.[^registry-pkg] The adapters
   ship the core libraries through `workspace:*`, but pnpm resolves each
   core library's own carets independently, so a caret there would let a kit
   patch float inside the adapter's sealed closure. Core **peer**
   dependencies are unchanged: they stay `catalog:effected:peers`, and which
   edges are peers is still decided by the public `.d.ts` surface (see
   [core-peers-follow-public-surface](core-peers-follow-public-surface.md)).

A guard test in each adapter enforces all three
rules.[^rspress-test] [^vitepress-test] It checks that the adapter declares at
least one kit runtime dependency and that every one is
`catalog:effected:exact`. It then walks the installed closure, failing on any
non-optional kit peer the adapter does not declare and on any `@tsdoctor/*`
package in the closure with a non-exact regular kit dependency.

## Alternatives rejected

- **Keep `catalog:effected` carets in the adapters.** Rejected. That
  spelling is the failure this Decision guards against: the tool a consumer
  runs changes with no release of the adapter.
- **Pin only the adapters and leave core library dependencies on carets.**
  Rejected by the owner. pnpm resolves those carets on their own, so the
  closure would only look sealed. A kit patch could still reach a consumer
  through a core library.
- **Pin core peers exactly too.** Rejected. A published peer spelled exactly
  holds every consumer of a core library to one patch. The `:peers` catalog
  floors each range to its minor for that reason.

## Consequences

- A kit patch reaches adapter consumers only when an
  `@effected/pnpm-plugin-effected` bump lands here and the adapters release.
  Dependency changesets for the adapters record each such move.
- Adding a core dependency on a new `@effected` package, or a new kit peer
  appearing upstream, can fail the guard test until the adapters declare the
  package. Add it as `catalog:effected:exact` in both adapters rather than
  loosening the test.
- The adapter dependency-closure convention
  ([rspress-dependency-closure](../conventions/rspress-dependency-closure.md))
  now names `catalog:effected:exact` as the adapter spelling.

[^owner]: conversation with the repository owner
[^ledger-0011]: `npm:@effected/pnpm-plugin-effected@0.26.2`
[^workspace]: `../../pnpm-workspace.yaml`
[^rspress-pkg]: `../../platforms/rspress/package.json`
[^vitepress-pkg]: `../../platforms/vitepress/package.json`
[^registry-pkg]: `../../packages/registry/package.json`
[^rspress-test]: `../../platforms/rspress/__test__/kit-closure-pins.test.ts`
[^vitepress-test]: `../../platforms/vitepress/__test__/kit-closure-pins.test.ts`
