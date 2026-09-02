# packages/registry/CLAUDE.md

`@tsdoctor/registry` (publishable, versioned via changesets) — external
package type loading for Effect: fetch, cache and resolve npm type definitions
(jsDelivr CDN) into a `Vfs` for Twoslash tooling.

Moved in from the sibling `type-registry-effect` repo in phase 1 of the
consolidation (`monorepo-consolidation.md`); the API is otherwise identical to
`type-registry-effect@2.3.5`. Phase 2 executed the identity rename: the
`Context.Service` tag ids now read `"@tsdoctor/registry/..."` (the legacy
`type-registry-effect/...` strings are gone), and the plugin's XDG cache
namespace is `"tsdoctor"`.

The VFS primitives left for `@tsdoctor/vfs` — `Vfs`, `mergeVfs`, `prefixVfs`,
`isTypeDefinition`, `VirtualPackage`, `TsEnvironment`. They had no consumers
inside this package while `@tsdoctor/model` needed them, and hosting them here
would have forced `@tsdoctor/model` to depend on a package that fetches from a
CDN. **This package's job is now exactly its name**: fetch, cache and resolve
external package types into a `Vfs`. Do not re-add a VFS primitive here —
`@tsdoctor/vfs` (a plain `dependency`) owns them.

## Key Facts

- Effect v4 native. Flat module layout: `TypeRegistry`, `TypeCache`,
  `TypeResolver`, `PackageFetcher`, `PackageSpec`, `RegistryEvent`,
  `internal/`.
- Ships **no platform layer** — consumers compose the stack at the edge (the
  plugin does this in `platforms/rspress/src/services/TypeRegistryService.ts`,
  which owns its layer as a static; there is no `*ServiceLive.ts`).
- Emits no logs; the `RegistryObserver` tag is the only diagnostic surface.
- **Peer closure is deliberate**: required peers `effect`,
  `@effect/platform-node`, `@effected/semver`, `@effected/store`; one optional
  peer, `@effected/xdg`. `typescript`, `@typescript/vfs` and
  `@effected/tsconfig-json` left with `TsEnvironment` — do not add them back.
  Anything that peers on `effect` must remain a peer — a nested `effect` copy
  strands artifacts at import. `@tsdoctor/vfs` is the one plain dependency.
- Builds with `defineBuild()` (`savvy.build.ts`, `@savvy-web/bundler`);
  tsconfig extends `@savvy-web/bundler/tsconfig/ecma.json`. Source
  `package.json` stays `"private": true`; `publishConfig` drives publishing.

## Commands

```bash
pnpm --filter @tsdoctor/registry run build:dev
pnpm vitest run packages/registry/
```

## Design Docs

Registry/VFS/Twoslash integration in the plugin:

- @../../.claude/design/rspress-plugin-api-extractor/type-loading-vfs.md
- @../../.claude/design/rspress-plugin-api-extractor/multi-entry-vfs.md
