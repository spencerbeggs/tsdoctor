# tsdoctor

**Give us an `api.json` and we transform it into static API docs.**

A pnpm monorepo (npm org `@tsdoctor`) of tools for generating API documentation from [Microsoft API Extractor](https://api-extractor.com/) models. API Extractor distills a TypeScript package's public surface into a single `.api.json` file; tsdoctor turns that file into a static documentation site — one page per API item, syntax-highlighted signatures with Twoslash hover tooltips, type references that cross-link between pages, and per-package `llms*.txt` files so agents get the same documentation humans do. LLM-first output and crawlable SEO are core missions, not add-ons.

The core `@tsdoctor/*` libraries are framework-neutral. Framework adapters wire them into a specific static-site generator: RSPress today, VitePress planned. The repo was renamed from `spencerbeggs/rspress-plugin-api-extractor` (GitHub redirects the old URL), and the RSPress plugin keeps its original npm name.

## Packages

### Framework adapters

| Package | npm | Description |
| ------- | --- | ----------- |
| [rspress-plugin-api-extractor](platforms/rspress) | [published](https://www.npmjs.com/package/rspress-plugin-api-extractor) | The [RSPress](https://rspress.dev/) 2.0 adapter: reads `.api.json` models and generates an interactive documentation site with Twoslash tooltips, cross-linking, multi-package portals, multiVersion, i18n and LLMs integration |

A VitePress adapter is planned as `platforms/vitepress`; it gates the core packages' 1.0 release.

### Core libraries

Framework-neutral `@tsdoctor/*` libraries under `packages/`, consumed by the adapters:

| Package | npm | Description |
| ------- | --- | ----------- |
| [@tsdoctor/model](packages/model) | [published](https://www.npmjs.com/package/@tsdoctor/model) | Pure `api.json` loading, TSDoc extraction, type-signature formatting and per-item markdown rendering |
| [@tsdoctor/registry](packages/registry) | [published](https://www.npmjs.com/package/@tsdoctor/registry) | External package type loading: fetch, cache and resolve type definitions from npm and build `@typescript/vfs` environments for Twoslash tooling |
| [@tsdoctor/bundle](packages/bundle) | unreleased | The tsdoctor bundle spec: layered bundle discovery, the versioned `tsdoctor.json` sidecar manifest, provenance-carrying resolution and canonical input hashing |
| [@tsdoctor/snapshot](packages/snapshot) | unreleased | Incremental-build snapshot tracking: a schema-versioned SQLite store of per-file content hashes and timestamps, built on `@effected/store` |

The predecessors of the first two — `type-registry-effect` and `api-extractor-llms` — are deprecated on npm in favor of `@tsdoctor/registry` and `@tsdoctor/model`.

### Test fixtures

The remaining workspaces are private fixtures that exercise the plugin end-to-end:

| Workspace | Purpose |
| --------- | ------- |
| [modules/](modules) | TypeScript fixture libraries (`kitchensink`, `effect-kit`, `versioned-v1`/`v2`) that build the `.api.json` models the sites consume |
| [sites/](sites) | RSPress fixture sites, one per supported configuration: single API (`basic`), multiVersion (`versioned`), i18n, multi-API portal (`multi`) and Effect-TS patterns (`effect`) |

The repo also ships a companion Claude Code plugin, `api-docs`, under [plugin/](plugin). It is not a pnpm workspace; load it locally with `pnpm claude`.

## Using the RSPress plugin

Install [rspress-plugin-api-extractor](https://www.npmjs.com/package/rspress-plugin-api-extractor) in your own site and start with the guides in [docs/](docs):

- [Getting started](./docs/01-getting-started.md) — Install the plugin, point it at one API Extractor model and run your first build.
- [Configuration](./docs/02-configuration.md) — Every option the plugin accepts, organized by where it lives.
- [Config helpers](./docs/03-config-helpers.md) — Discover model, package.json and tsconfig fields from a package folder instead of writing them out by hand.
- [Single package](./docs/04-single-package.md) — The single-package recipe documents one library.
- [Multi-package](./docs/05-multi-package.md) — A multi-API portal documents several packages from one RSPress site.
- [Versioned](./docs/06-versioned.md) — Document each major version side by side with RSPress multiVersion.
- [i18n](./docs/07-i18n.md) — Document a package across locales with RSPress internationalization.
- [Multi-entry points](./docs/08-multi-entry-points.md) — Re-export deduplication, the "Available from" line and fail-fast route collisions.
- [LLMs](./docs/09-llms.md) — Per-package llms*.txt files and in-page assistant actions.
- [Runtime components](./docs/10-runtime-components.md) — The importable runtime components and live with-api code blocks.
- [Troubleshooting](./docs/11-troubleshooting.md) — The build problems you are most likely to hit, and what each one means.

## Working on the repo

```bash
pnpm install
pnpm run build     # build the core libraries, the plugin and the fixture modules (not the sites)
pnpm dev           # serve the basic fixture site with hot reload
```

Each fixture site has a matching pair of scripts — `pnpm dev:<site>` and `pnpm preview:<site>` for `basic`, `versioned`, `i18n`, `multi` and `effect`. Setup, the build pipeline, testing and the commit and pull-request flow live in [CONTRIBUTING.md](CONTRIBUTING.md).

## Requirements

- Node.js >=24.11.0
- pnpm 11.x

## License

[MIT](LICENSE)
