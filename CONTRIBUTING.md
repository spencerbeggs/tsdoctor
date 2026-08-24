# Contributing to tsdoctor

Thanks for your interest in contributing. This repo is a pnpm monorepo: framework-neutral `@tsdoctor/*` libraries under `packages/`, framework adapters under `platforms/` (the publishable `rspress-plugin-api-extractor` lives at `platforms/rspress/`), and private fixture modules and sites that run the plugin against real configurations. This guide covers local setup, the build and test pipeline, and the conventions a change has to satisfy before it can merge.

## Prerequisites

- **Node.js 24.11 or newer.** The `engines` field requires `>=24.11.0`.
- **pnpm 11.** The exact version is pinned in `package.json#packageManager`; the simplest way to match it is to let [corepack](https://nodejs.org/api/corepack.html) manage it for you.
- **git.**

```bash
corepack enable
# corepack now shims pnpm to the version in package.json#packageManager
```

## Getting started

```bash
git clone https://github.com/spencerbeggs/tsdoctor.git
cd tsdoctor
pnpm install     # install every workspace, register the git hooks
pnpm run build   # build the core libraries, the plugin and the fixture modules
pnpm run test    # run the full test suite
```

`pnpm install` wires up the whole workspace, runs husky to register the git hooks, and resolves the Effect and `@effected/*` versions through the pnpm catalogs supplied by the `@effected/pnpm-plugin-effect` config dependency in `pnpm-workspace.yaml`. Never hand-pin an `@effected/*` version range — declare those dependencies as `catalog:effected` (or `catalog:effected:peers` under `peerDependencies`).

## Repository layout

- `packages/` — the publishable framework-neutral `@tsdoctor/*` libraries (`model`, `registry`, `bundle`, `snapshot`).
- `platforms/` — framework adapters; `platforms/rspress/` is the publishable `rspress-plugin-api-extractor`.
- `modules/` — private fixture libraries that build the `.api.json` models the sites consume.
- `sites/` — private RSPress fixture sites, one per supported plugin configuration.
- `docs/` — user-facing documentation for the RSPress plugin.
- `plugin/` — the api-docs Claude Code plugin (not a pnpm workspace).
- `lib/configs/` — shared tool configuration (commitlint, lint-staged, markdownlint).

`pnpm --filter` matches **package names**, not folder names: filter the plugin as `rspress-plugin-api-extractor` (or by path, `./platforms/rspress`), the libraries as `@tsdoctor/model` and so on.

## Build pipeline

[Turbo](https://turbo.build/) orchestrates the build graph. Each publishable workspace builds with the `@savvy-web` builders and emits dual outputs: a development build under `dist/dev/` and a production build under `dist/prod/`.

```bash
pnpm run build     # build packages + plugin + fixture modules via Turbo (sites are excluded)
```

Build a single workspace by filtering:

```bash
pnpm --filter @tsdoctor/model run build:dev              # one core library
pnpm --filter rspress-plugin-api-extractor run build:dev  # the plugin only
```

The workspace links resolve to each package's built `dist/dev/pkg`, not its `src/` — the sites import the built plugin, and the plugin imports the built libraries. Run `pnpm run build` after cloning before starting a dev server.

## Fixture sites

Each site has a dev server and a production preview:

```bash
pnpm dev                 # basic site with hot reload
pnpm dev:versioned       # multiVersion site
pnpm dev:i18n            # i18n site
pnpm dev:multi           # multi-API portal
pnpm dev:effect          # Effect-TS site
pnpm preview             # preview the basic site's production build
```

Every `dev:<site>` script has a matching `preview:<site>`.

## Testing

Tests run on [Vitest](https://vitest.dev/) with v8 coverage and project-based discovery:

```bash
pnpm run test              # run the full suite once
pnpm run test:watch        # re-run on change
pnpm run test:coverage     # run with v8 coverage
pnpm run ci:test           # what CI runs (sets CI=true, enables coverage)
```

Run a single file directly:

```bash
pnpm vitest run platforms/rspress/__test__/build-stages.test.ts
```

Tests live in each workspace's `__test__/` directory, never co-located in `src/`. The Claude Code plugin's hooks are covered by bats instead of Vitest:

```bash
pnpm run test:bats
```

New behavior needs tests, and a bug fix should come with a test that fails without it.

## Type-checking and linting

```bash
pnpm run typecheck       # type-check every workspace via Turbo
pnpm run lint            # check with Biome
pnpm run lint:fix        # apply Biome's safe fixes
pnpm run lint:md         # lint markdown
pnpm run lint:md:fix     # fix markdown
```

Formatting and linting run through [Biome](https://biomejs.dev/) (no ESLint, no Prettier); markdown is linted separately with the repo config under `lib/configs/`, so run `pnpm run lint:md` rather than invoking `markdownlint-cli2` directly.

## TypeScript conventions

- Use `.js` extensions for relative imports (ESM requirement).
- Use the `node:` protocol for Node.js built-ins, e.g. `import fs from "node:fs"`.
- Separate type imports: `import type { Foo } from "./bar.js"`.

## Commit conventions

Commits follow the [Conventional Commits](https://www.conventionalcommits.org/) format (`feat`, `fix`, `chore` and so on) and require a [Developer Certificate of Origin](https://developercertificate.org/) sign-off — see the [DCO](./DCO) file. Add the sign-off with `-s`:

```bash
git commit -s -m "fix(plugin): preserve timestamps on unchanged pages"
```

The `commit-msg` hook runs [commitlint](https://commitlint.js.org/) (the `@savvy-web/commitlint` preset, configured in `lib/configs/commitlint.config.ts`) against every message, and the `pre-commit` hook runs lint-staged over your staged files — Biome reformats staged code and re-stages the result, so don't hand-format to pre-empt it. If a hook blocks you, the message or the code is what needs fixing; don't reach for `--no-verify`.

## Changesets

Releases are managed with [Changesets](https://github.com/changesets/changesets) through the [@savvy-web/changesets](https://github.com/savvy-web/changesets) workflow. Any change that affects a publishable package — `rspress-plugin-api-extractor` or any `@tsdoctor/*` library — needs a changeset describing it, in its own file under `.changeset/`. Changes confined to the fixture modules and sites do not (they are ignored in `.changeset/config.json`), and neither do purely internal changes to tests, tooling or CI.

A changeset declares the affected packages and their bump levels in YAML frontmatter, with the body under `##` category headings (Features, Bug Fixes, Documentation and so on):

```markdown
---
"@tsdoctor/model": patch
---

## Bug Fixes

Preserves fenced code blocks when extracting TSDoc summary text.
```

Bump levels follow the usual rule: `patch` for fixes, docs and internal refactoring; `minor` for new exports and other non-breaking additions; `major` for removed exports, changed signatures and behavior breaks. Write for someone reading the release notes, not for the reviewer of the diff.

## Pull requests

`main` is the base branch. Work on a topic branch and open a pull request against `main`; do not push directly to it.

1. Branch from an up-to-date `main`.
2. Make your change with tests and, where it applies, a changeset.
3. Make sure `pnpm run build`, `pnpm run test`, `pnpm run typecheck`, `pnpm run lint` and `pnpm run lint:md` all pass locally.
4. Open a pull request. CI re-runs the build and test suite, and a reviewer takes it from there.

Keep pull requests focused — one logical change per branch is far easier to review than a mixed bag.

## License

By contributing you agree that your contributions are licensed under the [MIT](LICENSE) license, the same terms that cover the rest of the repo.
