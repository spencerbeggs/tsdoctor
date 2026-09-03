---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/plugin-lifecycle.md
  - rspress-plugin-api-extractor/configuration-system.md
  - rspress-plugin-api-extractor/ssg-compatible-components.md
  - rspress-plugin-api-extractor/component-development.md
  - rspress-plugin-api-extractor/doc-ir-and-pages.md
---

# LLMs integration

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Data flow](#data-flow)
- [Post-processing](#post-processing)
- [Per-package files](#per-package-files)
- [Structured global llms.txt](#structured-global-llmstxt)
- [Runtime UI components](#runtime-ui-components)
- [Configuration](#configuration)
- [Lifecycle integration](#lifecycle-integration)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

The LLMs integration extends RSPress's `@rspress/plugin-llms` with package-scoped LLM text files and UI. It runs as a post-processing step in `afterBuild`, reading the global `llms.txt` and `llms-full.txt` RSPress generated and splitting them into per-package files, and injects package-scoped copy/open actions into RSPress's existing LLMs UI. The text transforms are pure functions in `@tsdoctor/pages` (`Llms.ts`), so a second adapter can emit byte-identical files; the file I/O is an Effect program in the adapter.

## Current state

| Module | Purpose |
| --- | --- |
| `packages/pages/src/Llms.ts` | Parse, filter and generate llms text (`parseLlmsTxtLine`, `filterLlmsTxt`, `generateStructuredLlmsTxt`, `filterLlmsFullTxt`, `generatePackageLlmsTxt`, `generatePackageLlmsFullTxt`) |
| `platforms/rspress/src/llms-program.ts` | `processLlmsFiles`, the Effect program orchestrating file I/O and prefix discovery |
| `platforms/rspress/src/config-utils.ts` | `mergeLlmsPluginConfig` defaults and merge |
| `platforms/rspress/src/schemas/config.ts` | The `LlmsPlugin` schema |
| `platforms/rspress/src/plugin.ts` | Scope injection, the `resolve.alias`, the `afterBuild` call |
| `src/runtime/components/ApiLlmsPackageActions/` | Portal-based package actions (outline mode) |
| `src/runtime/components/ApiLlmsViewOptions/` | The aliased replacement for RSPress's `LlmsViewOptions` |

The VitePress adapter does not produce llms.txt: VitePress has no first-party equivalent to post-process, so that adapter would generate from scratch, and the pure half is ready for it (`vitepress-adapter.md`).

## Data flow

```text
RSPress build completes
  -> @rspress/plugin-llms writes dist/llms.txt + dist/llms-full.txt
  -> afterBuild (plugin.ts), when rspressLlmsEnabled && resolvedLlmsPlugin.enabled
       processLlmsFiles():
         buildApiRoutes()      every API page URL from the build results
         discoverPrefixes()    version/locale path prefixes (root always included)
         per prefix, concurrently:
           rewrite global llms.txt (structured when scopes is on, filtered otherwise)
           filter API sections out of global llms-full.txt
           when scopes: generatePerPackageFiles() per build result

config() (plugin.ts)
  -> themeConfig.apiExtractorScopes populated from the build results
  -> ApiLlmsPackageActions registered as a globalUIComponent
  -> RSPress's LlmsViewOptions aliased to ApiLlmsViewOptions via resolve.alias
```

## Post-processing

The transforms operate on RSPress's llms.txt grammar: link lines of the form `- [title](url): description` and, in `llms-full.txt`, sections delimited by `---\nurl: {path}\n---` frontmatter blocks. `filterLlmsTxt` removes API entries and appends pointer lines when scoping is off; `generateStructuredLlmsTxt` reorganizes the flat list when it is on; `filterLlmsFullTxt` removes whole API sections; the two `generatePackage*` functions produce the per-package files. `llms-program.ts` supplies the I/O and the helpers that collect entries and sections per package and per prefix — see the module.

## Per-package files

When `scopes` is enabled, four files are generated per package at the package route (`dist/<package>/`): `llms.txt` (an index with `## Guides` and `## API Reference` sections), `llms-full.txt` (guide plus API page content with frontmatter delimiters), `llms-docs.txt` (guide-only content) and `llms-api.txt` (API-only content, when `apiTxt` is enabled). The global files stay at the site root, restructured or filtered.

## Structured global llms.txt

With scoping on, the global `llms.txt` becomes a `## Others` section for pages matching no package route and a `## Packages` section with one `### {name} {version}` heading per package carrying its description, its guide links and an API Reference pointer to the per-package `llms-api.txt`. Pages are partitioned by matching URL against each package's route. With scoping off, the global file is filtered of API entries and pointer lines to the per-package files are appended.

## Runtime UI components

`ApiLlmsPackageActions` is registered as a `globalUIComponent` by absolute path to its transpiled `.js` (`ssg-compatible-components.md` explains why that path is layout-invariant). It reads `themeConfig.apiExtractorScopes`, matches the current route against the package scopes by longest prefix and, in outline placement, portals action rows (copy package docs, copy the llms.txt link, open in ChatGPT or Claude with a package-scoped prompt) into RSPress's outline; in title placement it defers to the aliased component. It reuses RSPress's own `rp-llms-*` and `rp-outline__*` classes.

`ApiLlmsViewOptions` replaces RSPress's `LlmsViewOptions` through a `resolve.alias` from RSPress's `dist/theme/components/Llms/LlmsViewOptions.js` to the plugin's transpiled component. Outside a package scope it reproduces the original dropdown; inside one it adds a divider and the package-level actions. Page-level options come from the `viewOptions` config, with RSPress's `useI18n` hook for the strings.

The scope metadata injected into `themeConfig.apiExtractorScopes` is one record per API — display name, package name, package and base routes, version and locale, and the URLs of its four llms files — see the `scopes` construction in `plugin.ts`.

## Configuration

`LlmsPlugin` (`schemas/config.ts`) carries `enabled`, `scopes`, `apiTxt`, `showCopyButton`, `showViewOptions`, `copyButtonText` and `viewOptions`, all defaulted on decode. The `llmsPlugin` field accepts `boolean | LlmsPlugin` at the global level and can be overridden per API and per version; `mergeLlmsPluginConfig` merges the levels with spread precedence. RSPress's own `llms: true` (or `pluginLlms()` in the plugins array) is a prerequisite: both `rspressLlmsEnabled` and the resolved `enabled` flag must be true for post-processing and UI injection to activate.

## Lifecycle integration

In `config()`, scope injection, the `globalUIComponents` registration and the alias are gated on the plugin not being inert: an inert plugin documents no packages, so there are no scopes to inject, and aliasing RSPress's `LlmsViewOptions` in that state would replace a working component with one that can never enter a scope (`configuration-system.md`). In `afterBuild`, post-processing runs once on the first build (never on HMR rebuilds) after `logBuildSummary`, through a dynamic import of `llms-program.ts`, with the FileSystem from the main runtime; the inert path skips it and leaves RSPress's own output untouched. `buildResults`, the package route map, the resolved LLMs config and RSPress's `llms` and `outDir` settings are hoisted to plugin level so `config()` and `afterBuild` share them (`plugin-lifecycle.md`).

## Rationale

- **Why post-process rather than generate:** RSPress already produces correct global files; splitting them is cheaper and stays in step with the framework's own llms grammar.
- **Why the transforms live in `@tsdoctor/pages`:** they are pure text over a cross-framework standard, and a second adapter wanting byte-identical output is the reason the core packages exist.
- **Why alias rather than fork the RSPress component:** the dropdown's page-level behaviour is RSPress's to evolve; the alias adds the package tier without copying the rest.

## Related documentation

- **The hooks this wiring lives in:** `plugin-lifecycle.md`
- **The inert gates and the `LlmsPlugin` schema's home:** `configuration-system.md`
- **The bundleless component paths:** `ssg-compatible-components.md`
- **Component conventions:** `component-development.md`
- **`Llms.ts` in the pages package:** `doc-ir-and-pages.md`
