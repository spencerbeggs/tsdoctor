# Convention

* [@effected is the foundation: check before hand-rolling](effected-is-the-foundation.md) - Check @effected/\* before hand-rolling any capability; expand the kit through the dogfood loop when it lacks one.
* [A behaviour change in an emitter ships as its own labelled commit](byte-parity-emitter-changes.md) - Any behaviour change to the pages IR builders or either adapter's emitter must ship in its own commit, verified by byte-identical fixture output plus a snapshot rebuild.
* [Decode compiler options at one seam, never cast](compiler-options-decode-not-cast.md) - Accept both tsconfig and programmatic compiler-option spellings only through TypeResolutionOptions.ts; decode fails loudly rather than guessing, and user options are never cast from unknown.
* [Do not hand-format, hand-sort, or hand-chmod what the pre-commit hook already normalizes](never-hand-format.md) - lint-staged (Biome, sort-package-json, markdownlint-cli2, yaml fmt) formats staged files at commit and strips the exec bit off \*.sh; tsgo --noEmit is the only blocking step.
* [Keep every adapter's dependency closure whole](rspress-dependency-closure.md) - Every platforms/\* adapter declares the full @effected closure and every @tsdoctor/\* core package it consumes in dependencies, never as peers; never prune an entry as unused without checking.
* [Never measure a code-block span across an await](render-phase-spans.md) - Time code-block rendering with synchronous spans only, summed rather than measured across an await, and cross-check against wallMs.
* [Never set private:false in a publishable workspace's source package.json](private-true-publishconfig.md) - publishConfig controls publishing; the build rewrites the manifest.
* [No internal barrels](no-internal-barrels.md) - In an adapter's src, only src/index.ts re-exports; every internal import names a concrete module.
* [Report through events, not logs or direct metrics](observability-events-not-logs.md) - Every build diagnostic is a typed PluginEvent through the event bus, never a console.log or a direct metric increment.
* [Runtime component authoring](runtime-component-authoring.md) - Conventions for React components under platforms/rspress/src/runtime/components — layout, styling, SSG-MD dual-mode rendering, and accessibility.
* [SEO derivation degrades, never fails the build](seo-degrades-never-fails.md) - No head-tag, Open Graph, JSON-LD, or attribution derivation may abort a docs build; each failure degrades to a warning and the page renders without that tag.
* [Services own their layers](services-own-their-layers.md) - A service declares its live layer as a static on the class itself; no separate \*Live.ts modules.
* [pnpm --filter matches the package name, not the workspace folder](pnpm-filter-by-package-name.md) - Filter by the name field in package.json (or a ./path), never by the directory name.
