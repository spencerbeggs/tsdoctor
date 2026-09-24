---
type: Decision
status: stable
title: Post-process llms.txt rather than generate it
description: The RSPress adapter rewrites @rspress/plugin-llms' own output instead of generating llms.txt from scratch.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 6ee85dbd2f850f2433a95d5a38c1ca05ded909c0930be52aa5b55050145231dd
tags: [architecture]
sources:
  - id: llms-program
    resource: ../../platforms/rspress/src/llms-program.ts
  - id: llms-transforms
    resource: ../../packages/pages/src/Llms.ts
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# Post-process llms.txt rather than generate it

## Context

`@rspress/plugin-llms` already writes a correct global `llms.txt` and `llms-full.txt` for a whole RSPress site once the build completes. The tsdoctor adapter wants those files split per documented package (an index, a full-content file, a guide-only file, and — optionally — an API-only file per package) and wants its own package-scoped copy/open actions inside RSPress's existing LLMs UI, without maintaining a second llms-grammar writer. The VitePress adapter has no first-party llms.txt plugin to post-process at all, so it cannot reuse this approach and does not attempt to.

## Decision

Run llms.txt handling as a post-processing step in `afterBuild`, on the first build only, reading and rewriting the files RSPress's own plugin already produced, rather than generating llms.txt from scratch. The text transforms — parsing `llms.txt` link lines and `llms-full.txt`'s frontmatter-delimited sections, filtering out API entries, restructuring the global file into package/guide/API sections, and producing the four per-package files — are pure functions in `../../packages/pages/src/Llms.ts`, so any future adapter with something to post-process could reuse them. The Effect program that does the actual file I/O — discovering path prefixes, reading and rewriting the global files, writing the per-package files — is `../../platforms/rspress/src/llms-program.ts`, invoked from `afterBuild` via a dynamic import.

The runtime UI similarly extends rather than forks RSPress's own component: `ApiLlmsViewOptions` is registered through `resolve.alias`, replacing RSPress's own `LlmsViewOptions.js` at build time (`platforms/rspress/src/plugin.ts`), so RSPress's own page-level dropdown behavior keeps working and the package tier is added on top rather than copied. `ApiLlmsPackageActions` is registered separately through `globalUIComponents` and portals its action rows into RSPress's own outline. Both post-processing and the UI wiring require RSPress's own `llms: true` (or `pluginLlms()`) AND the plugin's own resolved `llmsPlugin.enabled` — either one absent skips both, so an inert or llms-disabled site is left with RSPress's untouched output.

## Alternatives rejected

- **Generate llms.txt from scratch in the adapter.** Would require re-implementing RSPress's own link-list and frontmatter-delimited-section grammar just to produce files RSPress's own plugin already writes correctly, doubling the maintenance surface for no functional gain.
- **Fork RSPress's `LlmsViewOptions` component.** The page-level dropdown behavior (strings, `useI18n`, `viewOptions` config) is RSPress's to evolve; a fork would have to be kept in sync with RSPress's own updates by hand. Aliasing over the built `.js` file adds the package tier without owning the rest of the component.

## Consequences

- Post-processing only ever runs once per site build (first build, never on HMR rebuilds), so a dev session with `llms: true` never sees the per-package files regenerate on a rebuild.
- The two prerequisite flags (RSPress's own `llms` setting and the plugin's `llmsPlugin.enabled`) must both be true; forgetting either produces no error, just RSPress's stock output with no package-scoped files — a state that looks identical to "llms integration was never configured."
- Because the transforms are pure and framework-neutral, a VitePress equivalent has no llms.txt to post-process and would need to call `packages/pages/src/Llms.ts`'s generators directly rather than filter an existing file — a different integration shape from RSPress's, not a port of it.
