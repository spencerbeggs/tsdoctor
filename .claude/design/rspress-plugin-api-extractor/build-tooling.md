---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-09-03
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/effect-service-layer.md
  - rspress-plugin-api-extractor/plugin-lifecycle.md
  - rspress-plugin-api-extractor/configuration-system.md
  - rspress-plugin-api-extractor/ssg-compatible-components.md
  - rspress-plugin-api-extractor/component-development.md
---

# Build tooling

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Per-file plugin and bundleless runtime](#per-file-plugin-and-bundleless-runtime)
- [Output roots and the workspace link](#output-roots-and-the-workspace-link)
- [TypeScript configuration](#typescript-configuration)
- [Component registration](#component-registration)
- [Dev and preview servers](#dev-and-preview-servers)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

The plugin is built by `@savvy-web/rspress-builder`'s `build()` (on top of the tsdown-based `@savvy-web/bundler`) from a self-executing `platforms/rspress/savvy.build.ts`. Both halves — the Node plugin and the React runtime — are emitted per file, mirroring the source tree; they differ by environment and externals, not by bundling strategy.

## Current state

| Concern | Where it lives |
| --- | --- |
| Build script | `platforms/rspress/savvy.build.ts` |
| Source manifest, `exports` and `publishConfig` | `platforms/rspress/package.json` |
| Published RSPress tsconfig | `platforms/rspress/public/tsconfig/rspress.json` |
| Dev and preview runner | `src/serve.ts` |
| Runtime entry | `src/runtime/index.tsx` |

## Per-file plugin and bundleless runtime

**Plugin half (Node.js).** `src/index.ts` is the entry; every `src/*.ts` becomes its own `.js` under the package root, sibling imports stay relative `./…js` specifiers and `dependencies` are left external. A bundled `index.d.ts` inlines the declarations of the `bundledPackages` named in `savvy.build.ts`.

**Runtime half (browser).** Exported as `./runtime`. It is emitted bundleless: each component is transpiled 1:1 into its own `.js` next to its CSS module under `runtime/`, with `react` / `@theme` external and `import.meta.env` left as a runtime expression so RSPress does the final per-site compile. A single bundle froze `import.meta.env.SSG_MD` to `undefined` and broke the SSG-MD dual-mode branch; the per-file layout is also what lets `plugin.ts` register `globalUIComponents` and `resolve.alias` entries against real per-component `.js` files. See `ssg-compatible-components.md`.

`build()` produces the two-entry shape from `runtime: true`; the `exports` map (`.`, `./runtime`, `./tsconfig/rspress.json`) and `private: false` are produced by the builder's manifest handling. The source manifest stays `private: true` with `src/`-pointing exports.

## Output roots and the workspace link

The dev build writes `dist/dev/pkg`, and `publishConfig` (`directory: "dist/dev/pkg"`, `linkDirectory: true`) makes that directory the workspace link target: sites depending on the plugin via `workspace:*` import the built per-file JS, not `src/`. The production build emits the published root under `dist/prod/`, recorded in `dist/prod/targets.json`; publishing targets npm only. Every `pkg` root carries the identical flat layout with the runtime beside `index.js`, which is what makes the runtime component paths layout-invariant.

## TypeScript configuration

The plugin's own `tsconfig.json` uses `"module": "esnext"` and `"moduleResolution": "bundler"` because API Extractor requires bundler resolution and the root config's `node20` module setting is incompatible with it.

The package also publishes `rspress-plugin-api-extractor/tsconfig/rspress.json` (source `public/tsconfig/rspress.json`), a standard RSPress React-JSX bundler-resolution config the documentation sites extend from, exported as the third entry point.

## Component registration

Components are imported directly in generated MDX from `rspress-plugin-api-extractor/runtime`; the emitter chooses the import lines from the page kind (`page-generation-system.md`). The two LLMs components are the exception, registered through `globalUIComponents` and `resolve.alias` (`llms-integration.md`).

## Dev and preview servers

`serve(options?)` in `src/serve.ts` is exported from the main entry and used by every site's `lib/scripts/dev.mts` / `preview.mts`. It frees the target port (best-effort `lsof`), spawns `pnpm rspress dev|preview`, streams output and opens a browser once the server is ready — readiness detected from RSPress's `Local:` address line, with a dev `built in` fallback. `ServeOptions`, `ServeMode`, `ResolvedServeConfig` and the pure helpers `isServerReady` and `resolveServeConfig` are exported; the spawning side effects are not unit-tested. Option defaults are in the source.

## Rationale

- **Why per-file rather than bundled:** the runtime must be recompiled per site for `import.meta.env` to resolve, and the plugin half gains nothing from bundling while losing a stable per-file layout for path-based registrations.
- **Why the link target is the built output:** sites exercise exactly the artifact that ships, so a build-only break (a missing export condition, a wrong runtime path) shows up in the fixture sites rather than in a consumer.
- **Why one tsconfig for the plugin and another for sites:** the plugin's constraints are API Extractor's; the sites' are RSPress's, and the published tsconfig keeps the latter in one place.

## Related documentation

- **Build architecture overview:** `build-architecture.md`
- **SSG-compatible components and the bundleless mechanism:** `ssg-compatible-components.md`
- **Component conventions:** `component-development.md`
- **Plugin lifecycle:** `plugin-lifecycle.md`
