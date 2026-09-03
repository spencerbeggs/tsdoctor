# packages/pages/CLAUDE.md

`@tsdoctor/pages` (publishable, versioned via changesets) — the framework-neutral
documentation page IR for static TypeScript API sites. A page is facts + an
ordered list of typed doc blocks + its navigation entry; prose inside a block is
`@effected/markdown` mdast. Adapters are EMITTERS over this IR (MDX with JSX
components for RSPress, plain markdown with `ts twoslash` fences for VitePress).
The phase-5 package; the settled design lives in
`.claude/design/rspress-plugin-api-extractor/doc-ir-and-pages.md`.

Keep it pure: no filesystem, no network, no `shiki` / `hast` / `react` /
`@rspress` / `vitepress` imports, typed errors only. Prettier is the one
non-trivial dependency and it is CPU-bound and I/O-free.

## Key Facts

- **The public surface is flat** (`src/index.ts` re-exports every symbol by
  name; no `export * as` namespaces). The dts rollup cannot attribute a class
  referenced across namespace boundaries — `Page` → `Block` members,
  `buildExample` → `Example` — and API Extractor reported them as forgotten
  exports; the three block names that collided (`ExampleGroup`,
  `ParameterTable`, `EnumMemberTable`) are named for it.
- Modules, one per concern: `Blocks.ts` (the block vocabulary — `Schema.Class`
  variants with `Schema.tag` on `kind`, unioned by `Schema.Union`), `Page.ts`
  (facts including a required `kind: PageKind` + blocks + nav entry),
  `WorkItems.ts` (`prepareWorkItems`: model → per-API `WorkItem[]` + cross-link
  route map), `Build.ts` (`buildPage`: `ApiItem` → `Option<Page>` over a
  neutral `BuildPageInput`; `buildIndexPage` → `IndexPage`; `isPageKind`),
  `Nav.ts` (one navigation tree per API),
  `Examples.ts` (display/source preparation + Prettier formatting),
  `TwoslashDirectives.ts` (the directive/cut regexes both sides share),
  `Markdown.ts` (the neutral plain-markdown emitter, superseding the model's
  `Render.tree`), `Llms.ts` (llms.txt text transforms), `Scope.ts` (API scope
  naming: `apiScopeOf`, `unscopedName`, `normalizeBaseRoute`).
- **`prepareWorkItems` reports, never decides.** It runs the per-API step
  every adapter needs — `EntryPoints.resolve` dedup, `SyntheticBases.detect`
  (bases get no page; the owner's `WorkItem.syntheticBase` inlines them),
  `ApiItems.categorize`, `Routes.detectCollisions` on the lowercased
  `folder/name`, the route map with bare names owned by
  `crossLinkKindPriority` (value kinds beat type-only kinds), member anchors
  and namespace members — and returns `uncategorized` and `collisions` as
  DATA. The caller decides: RSPress emits `ItemSkipped` / throws
  `Routes.RouteCollisionError`; VitePress dies on collisions and reports
  uncategorized names. **Always check `collisions`** — ignoring them writes
  two items to one route. `WorkItem<C>`
  is generic over a `WorkItemCategory` so an adapter's category config rides
  through unchanged.
- **Code-bearing blocks carry `display` AND `source` as separate fields.**
  `source` is the type-check text (hidden imports, `// ---cut---`, directives
  intact); `display` is the directive-stripped text a reader copies. Produce both
  once through `codeText` / `buildExample` — never derive one from the other in an emitter.
- **Anchors arrive as data.** A member block carries the id computed by
  `ApiItems.memberAnchors` (`@tsdoctor/model`); no emitter recomputes one.
- **Navigation is IR output.** `buildNav` sorts exactly as the RSPress
  `writeMetadata` did: groups in category insertion order, filtered to those
  with pages; pages by `label.localeCompare`; the index page always present.
- **Frontmatter assembly stays adapter-side.** The IR carries facts and a
  `HeadTag[]` (`@tsdoctor/seo`), not a frontmatter block; the snapshot
  frontmatter hash contract lives in the RSPress generate stage.
- **`buildPage`'s error channel is `never`.** Its one fallible step is
  Prettier (`formatExampleCode` → `ExampleFormatError`, cause preserved), which
  degrades through the optional `onExampleFormatError` hook — the adapter maps
  it to its `PrettierError` event — and the example keeps its unformatted code.
  This package emits no events and no logs.
- `BuildPageInput` carries no framework vocabulary: routes, folder, package
  facts, the per-API `CrossLinker`, `syntheticBase`/`memberAnchors` from the
  `WorkItem`, optional `HeadTag[]`. An adapter supplies inputs and
  emits the result; it does not post-process blocks.
- `apiScopeOf` is load-bearing across adapters: it keys Twoslash cache
  generations and names the per-package llms files. One definition, here.
- Peers: `effect` (`catalog:effect`) and `@effected/markdown`
  (`catalog:effected`) — never hand-pin an `@effected` range. Dependencies:
  `@tsdoctor/model`, `@tsdoctor/seo`, `@microsoft/api-extractor-model`,
  `prettier`.
- Builds with `build()` (`savvy.build.ts`, `@savvy-web/bundler`); tsconfig
  extends `@savvy-web/bundler/tsconfig/ecma.json`. Source `package.json` stays
  `"private": true`; `publishConfig` drives publishing.

## Commands

```bash
pnpm --filter @tsdoctor/pages run build:dev
pnpm vitest run packages/pages/
```

## Design Docs

The IR and the pipeline that runs it:

- @../../.claude/design/rspress-plugin-api-extractor/doc-ir-and-pages.md
- @../../.claude/design/rspress-plugin-api-extractor/page-generation-system.md
- @../../.claude/design/rspress-plugin-api-extractor/cross-linking-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/tsdoctor-package-architecture.md

The two emitters over the IR — load when a block change must render in both:

- @../../.claude/design/rspress-plugin-api-extractor/rspress-mdx-emitter.md
- @../../.claude/design/rspress-plugin-api-extractor/vitepress-adapter.md
