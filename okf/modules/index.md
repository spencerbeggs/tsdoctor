# Module

* [@tsdoctor/bundle](tsdoctor-bundle.md) - The versioned bundle spec — layered discovery, the tsdoctor.json manifest, provenance-carrying resolution, fetchers and Open Graph asset publishing.
* [@tsdoctor/manifest](tsdoctor-manifest.md) - The tsdoctor.json sidecar manifest schema: spec, encode/decode boundaries and the ManifestSource authoring-file shape.
* [@tsdoctor/model](tsdoctor-model.md) - Framework-neutral analysis of Microsoft API Extractor models — loading, TSDoc extraction, multi-entry resolution, routes, cross-linking, signatures and the api.json-to-TypeScript bridge.
* [@tsdoctor/pages](tsdoctor-pages.md) - The framework-neutral documentation page IR for static TypeScript API sites — blocks, builders, navigation, and the plain-markdown emitter.
* [@tsdoctor/registry](tsdoctor-registry.md) - External package type loading — fetch, cache and resolve published npm type definitions into a Vfs for Twoslash tooling.
* [@tsdoctor/seo](tsdoctor-seo.md) - Framework-neutral head metadata — canonical URLs, Open Graph, Twitter cards, attribution, and schema.org JSON-LD — for static TypeScript API documentation.
* [@tsdoctor/snapshot](tsdoctor-snapshot.md) - Incremental-build snapshot store and content-hashing helpers for static documentation pipelines.
* [@tsdoctor/vfs](tsdoctor-vfs.md) - Virtual file system primitives, the compiler-options seam and the persisted Twoslash result cache both adapters share.
* [Fixture modules](fixture-modules.md) - Private packages under modules/ built purely to produce API Extractor models (.api.json) for the adapters' test fixture sites.
* [Fixture sites](fixture-sites.md) - Private RSPress and VitePress sites under sites/ that consume the adapters via workspace:\* against one or more fixture modules, exercising every plugin configuration shape.
* [The tsdoctor monorepo workspace](workspace.md) - pnpm workspace root — task orchestration, dependency catalogs, code-quality hooks, release tooling and vendored reference repos.
* [api-docs Claude Code plugin](api-docs-claude-plugin.md) - Claude Code plugin (skills, an agent, commands, hooks, a monitor) for authoring and maintaining RSPress API documentation — not a pnpm workspace, not the RSPress plugin.
* [rspress-plugin-api-extractor](rspress-plugin-api-extractor.md) - The RSPress adapter over the @tsdoctor/\* core — hooks, Effect service layer, page pipeline, emitters, cross-linking, observability, and LLMs wiring.
* [vitepress-plugin-api-extractor](vitepress-plugin-api-extractor.md) - The VitePress adapter over the @tsdoctor/\* core — markdown-only alpha proving the core/adapter boundary with a second consumer of the @tsdoctor/pages IR.
