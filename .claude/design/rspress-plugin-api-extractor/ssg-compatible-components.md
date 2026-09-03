---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 88
related:
  - rspress-plugin-api-extractor/component-development.md
  - rspress-plugin-api-extractor/build-tooling.md
  - rspress-plugin-api-extractor/rspress-mdx-emitter.md
  - rspress-plugin-api-extractor/llms-integration.md
---

# SSG-compatible components

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Dual-mode pattern](#dual-mode-pattern)
- [Why bundleless per-file output](#why-bundleless-per-file-output)
- [Layout-invariant component paths](#layout-invariant-component-paths)
- [Markdown generation in SSG-MD mode](#markdown-generation-in-ssg-md-mode)
- [Troubleshooting](#troubleshooting)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

RSPress renders pages two ways: as interactive HTML in the browser and as static markdown for LLM consumption (`llms.txt`, `llms-full.txt`). The runtime components produce both from one codebase by branching on `import.meta.env.SSG_MD`: in SSG-MD mode they return clean markdown, otherwise the interactive React UI.

## Current state

| Component | Role |
| --- | --- |
| `SignatureBlock`, `MemberSignature`, `ExampleBlock` | The code blocks (signature with heading and wrap toggle; member signature; example with copy and wrap) |
| `ApiSignature`, `ApiMember`, `ApiExample` | The SSG-MD-aware wrappers the emitter targets |
| `ParametersTable`, `EnumMembersTable` | The tables |
| `ApiLlmsPackageActions`, `ApiLlmsViewOptions` | Registered via RSPress, not exported (`llms-integration.md`) |

The bundleless mechanism lives in `@savvy-web/rspress-builder`'s `build()`; the plugin opts in with `runtime: true` in `savvy.build.ts` (`build-tooling.md`).

## Dual-mode pattern

The SSG-MD branch returns markdown as a JSX fragment wrapping a string — never `dangerouslySetInnerHTML`; the browser branch renders with CSS-module class names. See `ApiExample/index.tsx` for the canonical split: SSG-MD emits a simple `<pre><code>` that RSPress converts to a clean fence, browser mode renders Shiki HTML with Twoslash tooltips, a copy button carrying the directive-stripped code and a wrap toggle.

## Why bundleless per-file output

`import.meta.env.SSG_MD` is only defined when RSPress compiles the component during the site build. A single bundled `runtime/index.js` froze it to `undefined`, so the dual-mode branch always took the browser path. The runtime is therefore emitted bundleless: each component transpiled 1:1 into its own `.js` under `runtime/` next to its CSS module, `react` / `react/jsx-runtime` / `@theme` external, JSX transpiled to `react/jsx-runtime` calls and `import.meta.env` preserved by an identity `define`. A bundled `runtime/index.d.ts` is still emitted so the export's `types` condition resolves. The published `./runtime` export points at `runtime/index.js`; the source manifest keeps `src/runtime/index.tsx` for the dev workspace link, and the build rewrites it.

## Layout-invariant component paths

`plugin.ts` references `ApiLlmsPackageActions` (via `globalUIComponents`) and `ApiLlmsViewOptions` (via `resolve.alias` over RSPress's `LlmsViewOptions.js`) by absolute `.js` path resolved from `import.meta.url` — a zero-level `path.resolve(pluginDir, "runtime/components/.../index.js")`. Because every emitted package root carries the same flat shape (the dev link target and the published root alike), the runtime always sits at `runtime/components/.../index.js` beside `index.js`, and RSPress compiles the referenced file, resolving `import.meta.env.SSG_MD`. A source-tree-relative path resolves only against `src/` and breaks the registration in the published package.

## Markdown generation in SSG-MD mode

Headings, lists and formatting are assembled as a markdown string and returned as a fragment. Tables emit `| col | col |` rows with a header separator and sanitize HTML out of cell text. Shiki HTML is converted by stripping tags and decoding entities. Base64 summaries are decoded with `Buffer.from(summary, "base64")`, falling back to tag-stripping on failure.

## Troubleshooting

- **Component never renders markdown** — confirm it is imported from `rspress-plugin-api-extractor/runtime` (the bundleless `.js`) and the `SSG_MD` branch exists; check the generated `dist/*.md`.
- **CSS classes undefined** — use a default CSS-module import, not a namespace import.
- **Styles missing on nested elements** — wrap nested selectors in `:global()`.
- **TS cannot find `*.module.css`** — declare the module in `types/env.d.ts`.

## Rationale

- **Why one component for both modes:** two component trees would drift, and the markdown branch is small next to the interactive one.
- **Why the framework does the final compile:** the value of `import.meta.env.SSG_MD` is a property of the site build, not of the plugin build, so the plugin cannot bake it in.

## Related documentation

- **Component conventions, styling and accessibility:** `component-development.md`
- **The build that emits the runtime and the output roots:** `build-tooling.md`
- **The emitter that imports these components:** `rspress-mdx-emitter.md`
- **SSG-MD file generation and the `globalUIComponents` path:** `llms-integration.md`
