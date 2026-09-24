---
type: Decision
status: stable
title: "@tsdoctor/vfs sits below the registry and the model"
description: Extract VirtualPackage and TsEnvironment into a dependency-light substrate so the registry and the model share it without depending on each other.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-24T20:28:47Z
  body_sha256: e65451ae8ee6c0fccb1d5c99c4e9a77d5054a63c784495ef5e2b44788f66f695
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# `@tsdoctor/vfs` sits below the registry and the model

## Context

`@tsdoctor/registry` fetches, caches and resolves external package types
into a virtual TypeScript file system for Twoslash. `@tsdoctor/model`
needs to reconstruct a documented package's own declarations into that
same kind of virtual file system (`ApiExtractedPackage` extends
`VirtualPackage`[^1]). Both packages need the same `Vfs` currency type and
the same `TsEnvironment` compiler-options seam, but `VirtualPackage` and
`TsEnvironment` had no consumers inside the registry itself while the
model needed them directly — hosting either primitive inside one package
would force an edge the other did not want: the registry depending on the
api.json vocabulary, or the model dragging in the registry's
fetch/cache/XDG stack just to reuse one Schema class.

## Decision

Extract the primitives into a separate package, `@tsdoctor/vfs`, sitting
below both: the `Vfs` currency type and its helpers (`mergeVfs`,
`prefixVfs`, `isTypeDefinition`), `VirtualPackage`, `TsEnvironment`, the
compiler-options seam (`parseTsConfig`, `decodeCompilerOptions`,
`toProgrammaticCompilerOptions`) and the Twoslash result cache. The
package depends on `effect` alone[^2], with `typescript`, `@typescript/vfs`
and `@shikijs/twoslash` as optional peers — a constraint that holds nowhere
else in the core package set. `@effected/tsconfig-json` is a required peer
because its types are on the public surface (see
[core-peers-follow-public-surface](core-peers-follow-public-surface.md)). `@tsdoctor/registry`
sits on top of it for the fetch/cache/resolve stack; `@tsdoctor/model`
sits on top of it independently for `VirtualPackage`, with no edge between
the model and the registry in either direction.

## Alternatives rejected

- **Host `VirtualPackage` / `TsEnvironment` inside `@tsdoctor/registry`
  and have the model depend on the registry.** Rejected: the model would
  gain a dependency on the registry's fetch, cache and XDG stack purely to
  reuse one Schema class it does not otherwise need.
- **Host them inside `@tsdoctor/model` and have the registry depend on the
  model.** Rejected: the registry has no reason to know the api.json
  vocabulary, and coupling it to the model would tie type-fetching to a
  documentation-specific data shape.
- **Duplicate `VirtualPackage` / `TsEnvironment` in both packages.**
  Rejected: the two packages would need to keep the VFS shape and the
  compiler-option normalization in lockstep by hand, which is the drift
  the extraction exists to prevent.

## Consequences

- `@tsdoctor/vfs`'s dependency-light shape (`effect` and
  `@effected/tsconfig-json`, everything else an optional peer) makes it
  safe for either core consumer package to depend on without pulling in TypeScript, `@typescript/vfs` or
  `@shikijs/twoslash` unless the consumer actually needs them at runtime.
- Any future third consumer of the VFS or compiler-options seam has one
  package to depend on rather than choosing between the registry and the
  model.
- Because the file set in a documented build is shared across every
  package's declarations, a change to the compiler-options seam in
  `@tsdoctor/vfs` is felt by both the registry-driven external types and
  the model-driven reconstructed declarations at once — the seam is a
  single point of normalization by design.

[^1]: [packages/model/src/ApiExtractedPackage.ts](../../packages/model/src/ApiExtractedPackage.ts)
[^2]: [packages/vfs/package.json](../../packages/vfs/package.json)
