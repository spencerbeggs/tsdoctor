---
type: Decision
status: stable
title: Packages and platforms stay on TypeScript 6 while the effected build chain runs TypeScript 7.1
description: "packages/* and platforms/* declare typescript ^6.0.3 because the Twoslash runtime needs TypeScript 6's JS API; peerDependencyRules let the effected build chain's TypeScript 7.1 peer accept 6, and the fixture modules take TypeScript from catalog:effected:build."
tags: [deps, compat, dx]
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
sources:
  - id: workspace-yaml
    resource: ../../pnpm-workspace.yaml
  - id: rspress-pkg
    resource: ../../platforms/rspress/package.json
  - id: kitchensink-pkg
    resource: ../../modules/kitchensink/package.json
  - id: plugin-peer
    resource: npm:@effected/plugin
verified:
  - by: human:spencer
    at: 2026-11-09T18:10:29Z
integrity:
  generated:
    body: 88634dd59c699424
  verified:
    by: human:spencer
    at: 2026-11-09T18:10:29Z
    content: f3b2ce1dea8962f6
---

# TypeScript 6 for packages and platforms, 7.1 for the build chain

## Context

The build moved to `effected package build` (`@effected/plugin`, with
`@effected/bundler` under it), whose packages declare a TypeScript 7.1
peer.[^plugin-peer] The core packages and both adapters do more than
compile TypeScript: Twoslash, `@typescript/vfs` and the registry drive the
TypeScript compiler's JS API at runtime, and TypeScript 7's native compiler
does not offer that API in the form those libraries use.

## Decision

Every `packages/*` and `platforms/*` workspace declares
`"typescript": "^6.0.3"`[^rspress-pkg], and `pnpm-workspace.yaml`'s
`peerDependencyRules.allowedVersions` lets `@effected/bundler>typescript`
and `@effected/plugin>typescript` accept `6`, so installing the build
chain beside TypeScript 6 is not a peer conflict.[^workspace-yaml] The
fixture modules, which have no runtime TypeScript dependency, take
`typescript` from `catalog:effected:build`[^kitchensink-pkg], the catalog
that also supplies the toolchain devDependencies (`@types/node`,
`@microsoft/api-extractor-model` and the rest) formerly drawn from
`catalog:build`.

## Alternatives rejected

- **Move everything to TypeScript 7.1.** Rejected: the Twoslash runtime
  the adapters ship needs TypeScript 6's JS API.
- **Leave the peer mismatch as an install warning.** Rejected: an
  unexplained peer warning hides real ones and pushes someone to "fix" it
  by bumping TypeScript.

## Consequences

- Do not bump `typescript` past 6 in a package or platform until Twoslash
  and `@typescript/vfs` support a TypeScript 7 runtime API; revisit this
  Decision when they do.
- Remove the two `peerDependencyRules` entries in the same change that
  moves packages and platforms to TypeScript 7.

[^plugin-peer]: `npm:@effected/plugin` (`peerDependencies.typescript`)
[^rspress-pkg]: `platforms/rspress/package.json`
[^workspace-yaml]: `pnpm-workspace.yaml` (`peerDependencyRules`)
[^kitchensink-pkg]: `modules/kitchensink/package.json`
