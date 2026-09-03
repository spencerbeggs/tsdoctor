---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 88
related:
  - rspress-plugin-api-extractor/ssg-compatible-components.md
  - rspress-plugin-api-extractor/build-tooling.md
  - rspress-plugin-api-extractor/llms-integration.md
---

# Component development guide

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Registration](#registration)
- [Component structure](#component-structure)
- [Styling](#styling)
- [Accessibility](#accessibility)
- [Common pitfalls](#common-pitfalls)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

Conventions for the React components under `platforms/rspress/src/runtime/`. Every component must be SSG-MD compatible — render markdown when `import.meta.env.SSG_MD` is set — which `ssg-compatible-components.md` covers; this doc covers organization, registration and styling.

## Current state

Components live one per directory under `src/runtime/components/`, each with an `index.tsx` and, where it has browser-mode styling, an `index.module.css`. The tree holds the signature, member and example blocks and their SSG-MD-aware `Api*` wrappers, the parameter and enum tables, the shared toolbar and code display, the two LLMs components, the `buttons/` and `icons/` sets and `shared/` (CSS variables, the global Twoslash stylesheet, shared types). `src/runtime/index.tsx` is the public export; `src/runtime/utils/` holds the HAST-to-React renderer. See the directory for the authoritative list.

## Registration

Most components are exported from `src/runtime/index.tsx` and imported directly in generated MDX from `rspress-plugin-api-extractor/runtime`; the emitter chooses the import lines from the page kind (`rspress-mdx-emitter.md`). `ApiLlmsPackageActions` and `ApiLlmsViewOptions` are the exception: they use RSPress runtime hooks and would pull `react-dom` into the pre-imported runtime, so they are registered through `globalUIComponents` / `resolve.alias` against their transpiled `.js` files (`llms-integration.md`).

**Avoid `import * as` of sibling runtime modules.** The runtime is emitted bundleless, and a namespace import of a sibling forces a webpack namespace object plus a shared runtime chunk outside `runtime/`, breaking the per-file layout. The `Api*` wrappers use named imports of their block components.

## Component structure

Props are exported TypeScript interfaces with JSDoc on every prop. A component imports its CSS module as a default import and references class names off it; shared pieces are imported with `.js` extensions to satisfy Biome's `useImportExtensions` rule. The block components compose `SignatureToolbar` (wrap and copy buttons) with `SignatureCode` (Shiki HTML plus Twoslash tooltips). See any `index.tsx` for the shape.

## Styling

CSS modules, not Sass. Theming uses the custom properties in `shared/variables.css`, with `html.rp-dark` overrides for dark mode. Nested non-module elements (`pre`, `code`, `a`) are styled through `:global()` selectors. Twoslash hover and error styles are global and live in `shared/_twoslash.css`, imported once from `src/runtime/index.tsx`.

## Accessibility

Semantic elements (`<button type="button">` for actions), `aria-label` and `title` on icon-only buttons, keyboard operation with a visible `:focus-visible` outline and a VoiceOver pass when a component changes.

## Common pitfalls

- A missing default CSS-module import leaves every class name `undefined` and styling silently drops; a namespace import breaks against RSPress's `namedExport: false` configuration.
- Module selectors do not reach nested `pre` / `code` / `a` without `:global()`.
- Relative imports need `.js` extensions.

## Rationale

- **Why colocated CSS modules:** RSPress compiles the runtime per site and handles CSS modules natively; Sass would add a toolchain the site build does not have.
- **Why named sibling imports:** the bundleless layout is what lets RSPress resolve `import.meta.env` per site and what makes the LLMs registrations path-stable; anything that produces a shared chunk breaks both.

## Related documentation

- **Dual-mode rendering and the bundleless mechanism:** `ssg-compatible-components.md`
- **Build output and the runtime export:** `build-tooling.md`
- **The `globalUIComponents` registration path:** `llms-integration.md`
