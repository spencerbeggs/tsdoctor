---
type: Glossary
title: Bundle
description: In this repository a bundle is a folder or tarball describing one documented package — the api.json trio plus an optional bundle.json sidecar, an og/ image directory and an optional SBOM pointer — never an Rspack/tsdown build output.
tags: [architecture, dx]
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
status: stable
integrity:
  generated:
    body: 182dcaaf5151fa3f
---

# Bundle

## What this repository means

A **bundle** is the input contract `@tsdoctor/bundle`[^1] resolves: a
directory (or tarball, or GitHub release asset) that describes one
documented npm package. Its layers are additive — absence of an
optional layer means "enrich less", never "fail":

- **Layer 0 (required):** the `<name>.api.json` model API Extractor
  produced, read minimally as `ApiModelInfo`[^2] (just the package name)
  — full model loading (entry points, members, TSDoc) is
  `@tsdoctor/model`'s job, not this package's.
- **Layer 1:** the package's own `package.json`.
- **Layer 2:** a discovered or provided `tsconfig.json`.
- **Layer 3 (optional):** a `bundle.json` sidecar manifest[^3] —
  project/leaf identity, Open Graph image config, SBOM pointer — decoded
  through `@effected/manifest`'s schema, re-exported by
  `@tsdoctor/bundle`.
- **`og/`:** a directory of Open Graph images the manifest's `openGraph`
  block can reference, published into a site's public directory by
  `publishBundleAssets`[^4].

`BundleDiscovery`[^5] finds these layers on disk; `BundleResolver`[^6]
resolves them (with an empty or platform-supplied override tier) into a
`ResolvedBundle`; `BundleFetch`[^7] pulls a bundle from an npm tarball or
a GitHub release when it is not local. A bundle that carries only the
api.json still resolves — to an inferred bundle whose `name` falls back
to the model's own package name.

## Where the wider meaning differs

Everywhere else in this monorepo's toolchain, "bundle" means the output
of a JavaScript bundler: an Rspack/Rsbuild output under `dist/`, or a
tsdown build artifact from `effected package build` (`@effected/bundler`,
under `dist/prod/npm/pkg/`). Those are build **outputs**; a
`@tsdoctor/bundle` bundle is a documentation **input** — a package
description a doc generator reads, not something a compiler emits.
`@effected/bundler`'s meta pass is the one thing that *writes* the
`bundle.json` sidecar (composed from `ManifestSource` tiers and encoded
through `@effected/manifest`) into `dist/prod/npm/meta/`, which is easy to
conflate with "the bundler bundles the bundle" — it does not: the bundler
writes one layer of the bundle, `@tsdoctor/bundle` reads and resolves all
of them.

## Why this earns a concept

The collision is the word itself, tripled now that the sidecar file is
named `bundle.json` and its writer is `@effected/bundler`:
`@effected/manifest` owns the `bundle.json` *schema* (an `effect`-only
peer, no fetch or discovery stack); `@tsdoctor/bundle` owns *resolving a
bundle*, of which the manifest is one optional layer; `@effected/bundler`
builds code and, in its meta pass, writes the manifest. Reading "bundle" as a JS build
artifact instead of this input contract misdirects a search for where a
documented package's identity, categories or model path come from.

[^1]: [packages/bundle/src/Bundle.ts](../../packages/bundle/src/Bundle.ts)
[^2]: [packages/bundle/src/Bundle.ts](../../packages/bundle/src/Bundle.ts)
[^3]: `npm:@effected/manifest`
[^4]: [packages/bundle/src/BundleAssets.ts](../../packages/bundle/src/BundleAssets.ts)
[^5]: [packages/bundle/src/BundleDiscovery.ts](../../packages/bundle/src/BundleDiscovery.ts)
[^6]: [packages/bundle/src/BundleResolver.ts](../../packages/bundle/src/BundleResolver.ts)
[^7]: [packages/bundle/src/BundleFetch.ts](../../packages/bundle/src/BundleFetch.ts)

See also: [`@tsdoctor/bundle` module](../modules/tsdoctor-bundle.md),
[the `bundle.json` manifest interface](../interfaces/bundle-json-manifest.md).
