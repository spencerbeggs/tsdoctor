# packages/registry/CLAUDE.md

`@tsdoctor/registry` (publishable, versioned via changesets) — TypeScript
virtual file systems
for Effect: fetch, cache and resolve npm type definitions (jsDelivr CDN) and
build `@typescript/vfs` environments for Twoslash tooling.

Moved in from the sibling `type-registry-effect` repo in phase 1 of the
consolidation (`monorepo-consolidation.md`); the API is identical to
`type-registry-effect@2.3.5`. **Do not "fix" the `Context.Service` tag id
strings** — they still read `type-registry-effect/...` deliberately, per the
phase 1 no-behavior-change gate.

## Key Facts

- Effect v4 native. Flat module layout: `TypeRegistry`, `TypeCache`,
  `TypeResolver`, `PackageFetcher`, `PackageSpec`, `RegistryEvent`,
  `TsEnvironment`, `Vfs`, `VirtualPackage`, `internal/`.
- Ships **no platform layer** — consumers compose the stack at the edge (the
  plugin does this in `platforms/rspress/src/layers/TypeRegistryServiceLive.ts`).
- Emits no logs; the `RegistryObserver` tag is the only diagnostic surface.
- **Peer closure is deliberate**: required peers `effect`,
  `@effect/platform-node`, `@effected/semver`, `@effected/store`; optional
  peers `@effected/xdg`, `@effected/tsconfig-json`, `@typescript/vfs`,
  `typescript` (optional ones stay behind lazy `import()`). Anything that
  peers on `effect` must remain a peer — a nested `effect` copy strands
  artifacts at import.
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
