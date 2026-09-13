---
type: Convention
title: Runtime component authoring
description: Conventions for React components under platforms/rspress/src/runtime/components — layout, styling, SSG-MD dual-mode rendering, and accessibility.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 439564d4abf41b028c4a46f51b849853211bdc328fa942aa940c1fa374ca64e7
stale_after: 2026-12-12T00:00:00Z
tags: [dx]
sources:
  - id: components-dir
    resource: ../../platforms/rspress/src/runtime/components
  - id: env-declares
    resource: ../../platforms/rspress/src/env.d.ts
  - id: api-example
    resource: ../../platforms/rspress/src/runtime/components/ApiExample/index.tsx
---

# Runtime component authoring

Every component under `platforms/rspress/src/runtime/components/` lives one
per directory with an `index.tsx` and, where it has browser-mode styling, a
sibling `index.module.css`.[^components-dir]

## Rules

- **CSS modules, not Sass.** Import the module as a *default* import and
  reference class names off it — a namespace import (`import * as styles`)
  leaves every class name `undefined` under RSPress's `namedExport: false`
  configuration. Wrap nested non-module elements (`pre`, `code`, `a`) in
  `:global()` — a module selector never reaches them otherwise.
- **Theme through custom properties.** Read colors and spacing from
  `shared/variables.css`; override for dark mode under `html.rp-dark`, never
  a component-local dark-mode branch.
- **Never `import * as` a sibling runtime module.** The runtime is emitted
  bundleless (one `.js` per component); a namespace import of a sibling
  forces a shared runtime chunk outside the per-file layout, which breaks the
  path-based registration `plugin.ts` relies on for the two aliased LLMs
  components. See [bundleless per-file runtime](../decisions/bundleless-per-file-runtime.md).
- **`.js` extensions on every relative import**, including siblings, to
  satisfy the ESM import-extension rule.
- **Branch on `import.meta.env.SSG_MD`.** Every component that renders
  markdown-consumable content must produce it in SSG-MD mode and the
  interactive React UI otherwise.[^api-example] The SSG-MD branch returns
  markdown assembled as a plain string wrapped in a JSX fragment — **never**
  `dangerouslySetInnerHTML`.
- **Props are exported TypeScript interfaces with JSDoc on every prop.**
- **Accessibility:** semantic elements (`<button type="button">` for
  actions), `aria-label` and `title` on icon-only buttons, a visible
  `:focus-visible` outline, keyboard operability, and a VoiceOver pass
  whenever a component's rendered output changes.
- **Declare every `*.module.css` import.** `platforms/rspress/src/env.d.ts`
  is where `declare module "*.module.css"` lives — a new CSS module path
  needs no new declaration, but do not remove or narrow this one.[^env-declares]
- **Registration.** Every component except the two LLMs components
  (`ApiLlmsPackageActions`, `ApiLlmsViewOptions`) is imported directly in
  generated MDX from `rspress-plugin-api-extractor/runtime`. The two LLMs
  components are registered through `globalUIComponents` / `resolve.alias`
  instead, because importing them from the pre-imported runtime would pull
  `react-dom` in.

## Why

RSPress renders a page twice — once as interactive HTML in the browser, once
as static markdown for LLM consumption (`llms.txt`) — and both must come
from one component tree or the two outputs drift. `import.meta.env.SSG_MD`
is only ever defined when RSPress itself compiles the component during a
site build, which is why the runtime is emitted bundleless rather than as
one bundled `runtime/index.js`: a single bundle froze the flag to `undefined`
and the SSG-MD branch never fired. The CSS-module and `.js`-extension rules
follow from the same bundleless, per-file emission: anything that would
force a shared chunk or an unresolvable specifier breaks the layout the
registration paths depend on.

## How to check

- A new component directory has both `index.tsx` and, if it renders anything
  visually distinct in the browser, `index.module.css` — no colocated Sass.
- `grep -rn "import \* as" platforms/rspress/src/runtime/` returns nothing.
- Every relative import inside `runtime/` ends in `.js`.
- Build the runtime (`pnpm --filter rspress-plugin-api-extractor run
  build:dev`) and confirm the emitted `dist/dev/pkg/runtime/` tree still has
  one file per component rather than a shared chunk.
- Generate a site's `llms-full.txt` and diff a changed component's markdown
  output against its browser rendering for parity of information (not
  markup).

[^components-dir]: See the component directories under `platforms/rspress/src/runtime/components/` (`ApiExample`, `ApiMember`, `ApiSignature`, `ParametersTable`, `EnumMembersTable`, `SignatureToolbar`, `SignatureCode`, and the rest) for the one-directory-per-component shape.
[^api-example]: `ApiExample/index.tsx` reads `import.meta.env.SSG_MD` to choose between a markdown string and the interactive Shiki/Twoslash render.
[^env-declares]: `platforms/rspress/src/env.d.ts` declares `*.module.css` (returning `CSSModuleClasses`) and the `ImportMetaEnv.SSG_MD` shape both halves of the dual-mode pattern depend on.
