---
"@tsdoctor/vfs": minor
---

## Features

First release of `@tsdoctor/vfs`: the virtual file system substrate shared by `@tsdoctor/registry` and `@tsdoctor/model`, factored out of the registry so neither has to depend on the other.

### `Vfs`, `mergeVfs`, `prefixVfs`, `isTypeDefinition`

The currency type — a `Map` of `node_modules/`-prefixed paths to file contents — plus the helpers that combine maps, root a package's entries, and decide whether a path names a declaration file.

### `VirtualPackage`

A named, versioned set of declaration entries that renders to a `Vfs` with a synthetic `package.json`, choosing the `types` field for a single entry and an `exports` map for several, so TypeScript resolves subpaths the way the real package would.

### `TsEnvironment`

A `@typescript/vfs` environment built over a `Vfs`, loading `typescript` and `@typescript/vfs` lazily so they stay optional peers. `@effected/tsconfig-json` is a required peer: the compiler-options seam value-imports it and evaluates its schema at module load, so it cannot be optional the way the other two are.

All four modules move verbatim from `@tsdoctor/registry`, which re-homes rather than reimplements them. Hover output is byte-for-byte unchanged: a cold-cache build of the `multi` fixture site produced 230 Twoslash hovers across 129 code blocks before and after the move.

## Bug Fixes

`@effected/tsconfig-json` was declared as an optional peer in `peerDependenciesMeta`, but the compiler-options seam imports it as a value and evaluates its schema at module load — so importing this package without it installed failed outright rather than degrading. Removed from `peerDependenciesMeta`; it stays a required peer.

## Documentation

Corrects the npm listing description, which undersold the package once the compiler-options seam moved in alongside it: "Virtual TypeScript projects for documentation tooling: the Vfs currency type, declaration-backed virtual packages, @typescript/vfs environments, and the compiler-option resolution that configures them."

## Maintenance

Adds the `LICENSE` file the README already linked to.
