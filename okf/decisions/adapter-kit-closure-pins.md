---
type: Decision
title: Adapters seal their kit closure at exact versions
description: "Both platforms/* adapters spell every effect, @effect/* and @effected/* runtime dependency catalog:effected:exact and declare every kit package their closure reaches through a range, at any depth, and the core @tsdoctor/* libraries pin their regular @effected dependencies the same way, so a kit patch never reaches a consumer without a release."
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
  at: 2026-11-12T02:59:11Z
verified:
  - by: human:spencer
    at: 2026-11-12T02:38:59Z
  - by: human:spencer
    at: 2026-11-12T02:51:17Z
integrity:
  generated:
    body: 15c86237e46c40bf
  verified:
    by: human:spencer
    at: 2026-11-12T02:51:17Z
    content: bde93de33644fad6
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
2. **Adapters declare their whole kit closure, flattened.** Every
   `effect`, `@effect/*` or `@effected/*` package an adapter's closure
   reaches through a range (a regular dependency or a required peer, at
   any depth) is also one of the adapter's exact runtime dependencies.
   Upstream kit packages reach each other through carets (`@effected/jsonc`
   → `@effected/source@^0.5.0`, `@effected/github` →
   `@effected/jwt@^0.10.0`), and this repository cannot change those
   edges. It can make them resolve to one
   version: npm and pnpm both satisfy a transitive caret with the copy the
   installing package pins, so declaring the flattened closure holds every
   edge to the adapter's tested version. A scratch install confirmed it
   under both: a package that pinned `supports-color@5.3.0` beside
   `chalk@2.4.2` (which asks for `supports-color@^5.3.0`) installed one copy,
   5.3.0, although 5.5.0 is current. Optional peers are left out, because
   the closure never installs them and a host that installs one picks its
   version.

   A package reached **only** through exact upstream pins is already
   sealed, and is not redeclared. Redeclaring it can do harm: every pin
   must satisfy every published edge that reaches it. `@effected/store`
   0.25.0 pins `@effect/sql-sqlite-node` at exactly 4.1.3, while the
   catalog serves 4.1.4. This workspace's graph-wide Effect overrides hide
   the difference, but a consumer has no such overrides, so an adapter pin
   of 4.1.4 would install a dead second copy beside the 4.1.3 that `store`
   uses. `@effect/sql-sqlite-node` and `@effect/platform-node-shared`
   (exact under `@effect/platform-node`) are therefore left to upstream.

   Applying the rule found two gaps. `@effected/xdg` peers on
   `@effected/config-file`, which both adapters had carried only as a
   devDependency. Six transitive packages reached through carets were not
   declared at all: `@effected/commands`, `crypto`, `github-references`,
   `jwt`, `oidc` and `source`. All of them are now exact runtime
   dependencies of both adapters.
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
`catalog:effected:exact`. It then walks the installed closure through
regular dependencies and required peers, at any depth. It fails on:

- any kit package reached through a range that the adapter does not
  declare;
- any adapter pin that does not satisfy a published edge reaching it,
  checked against the edge's own range rather than the local install, so
  the workspace overrides cannot mask a consumer-side split;
- any kit package that resolves at more than one version;
- any `@tsdoctor/*` package in the closure with a non-exact regular kit
  dependency.

When a plugin bump makes the pin check fail on an upstream exact pin,
the upstream package was released against an older patch. Drop the
adapter's redeclaration if nothing reaches the package through a range;
otherwise report the stale pin upstream.

## Alternatives rejected

- **Keep `catalog:effected` carets in the adapters.** Rejected. That
  spelling is the failure this Decision guards against: the tool a consumer
  runs changes with no release of the adapter.
- **Pin only the adapters and leave core library dependencies on carets.**
  Rejected by the owner. pnpm resolves those carets on their own, so the
  closure would only look sealed. A kit patch could still reach a consumer
  through a core library.
- **Declare only direct and peer edges, and trust upstream ranges below
  them.** Rejected after review: the seal then stopped one hop in, and a
  patch to `@effected/source` or `@effected/crypto` reached every consumer
  through a kit library's caret. The owner accepted the longer dependency
  list, since consumers install each adapter as one unit anyway.
- **Bundle the kit into the adapter's `dist`.** Not taken now. It is the
  full seal, because nothing resolves at install time, but it breaks the
  per-file runtime layout and would duplicate `effect` for a host that
  shares it. The flattened closure seals the same versions without changing
  the build.
- **Pin core peers exactly too.** Rejected. A published peer spelled exactly
  holds every consumer of a core library to one patch. The `:peers` catalog
  floors each range to its minor for that reason.

## Consequences

- A kit patch reaches adapter consumers only when an
  `@effected/pnpm-plugin-effected` bump lands here and the adapters release.
  Dependency changesets for the adapters record each such move.
- Adding a core dependency on a new `@effected` package, or a kit package
  gaining a new dependency upstream, can fail the guard test after a plugin
  bump until the adapters declare the package. Add it as `catalog:effected:exact` in both adapters rather than
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
