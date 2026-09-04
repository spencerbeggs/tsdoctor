---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-09-03
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/effect-service-layer.md
  - rspress-plugin-api-extractor/plugin-lifecycle.md
  - rspress-plugin-api-extractor/build-tooling.md
  - rspress-plugin-api-extractor/bundle-spec.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
---

# Configuration system

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Option schemas](#option-schemas)
- [Inert configuration](#inert-configuration)
- [Config helpers](#config-helpers)
- [ConfigService.resolve](#configserviceresolve)
- [Config resolution modules](#config-resolution-modules)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

Plugin options are Effect Schemas decoded once at factory time. `ConfigService.resolve` then turns the decoded options plus a subset of RSPress's own config into the fully resolved per-API configurations the pipeline runs over: loaded models, output paths, categories, the derived site URL, the decoded manifest and the type environments. Two pure helpers, `ApiExtractorPlugin.api.fromDir` and `ApiExtractorPlugin.apis.fromDir`, build option objects from built model folders.

## Current state

| Concern | Where it lives |
| --- | --- |
| Option schemas and `DEFAULT_CATEGORIES` | `src/schemas/config.ts` |
| Observability options and their resolution | `src/schemas/observability.ts`, `src/schemas/performance.ts` |
| Option classification and LLMs config merge | `src/config-utils.ts` |
| `fromDir` / `fromParentDir` helpers | `src/config-helpers.ts` (over `@tsdoctor/bundle`'s `discoverBundle` through `src/sync-node-fs.ts`) |
| The `ConfigService` contract and `ResolvedApiConfig` | `src/services/ConfigService.ts` |
| The resolution implementation | `src/layers/config-resolution.ts` plus `api-results.ts`, `type-environment.ts`, `external-types.ts` |
| Category merging across the precedence chain | `src/category-resolver.ts` |

## Option schemas

`schemas/config.ts` defines `PluginOptions`, `SingleApiConfig` (`api:`), `MultiApiConfig` (`apis:`), `VersionConfig`, `CategoryConfig`, `ExternalPackageSpec` and `LlmsPlugin`. Consumer-facing types are the `Encoded` shapes (optional fields), decoding applies the defaults. Open Graph vocabulary is `@tsdoctor/seo`'s and is re-exported from `src/index.ts`; performance thresholds reach the build only through `observability.thresholds` and the `Thresholds` reference.

`VersionConfig` carries no `tsconfig` or `compilerOptions`. Those levels of the resolution cascade were never read, so a multi-version site silently type-checked every version against the defaults; the unwired levels were deleted rather than wired (`type-loading-vfs.md`).

The exported `ApiExtractorPlugin` is the factory function with the helpers attached as namespaces (`api.fromDir`, `apis.fromDir`) — see the bottom of `src/plugin.ts`.

## Inert configuration

`api` and `apis` are both optional and both nullable. Supplying `api: null`, `apis: null` or `apis: []` is an explicit opt-in to an inert plugin: options are validated and the RSPress wiring is installed, but nothing is generated. This lets a site add the plugin before any API model exists. Omitting both keys remains a configuration error — the distinction is between "I said there is no API" and "I forgot to say anything".

`classifyApiConfig(options)` (`config-utils.ts`) collapses the option shapes into an `ApiConfigMode`:

| Mode | Meaning |
| --- | --- |
| `configured` | At least one option carries real config. Generate docs. |
| `disabled` | A key carries an empty value. Inert. |
| `missing` | Neither key was supplied, or one was supplied as `undefined`. Fail validation. |

A populated option wins over an empty sibling, so `{ api: cfg, apis: [] }` is `configured`; the both-provided error fires only when both carry real config. An explicit `undefined` is `missing`, not `disabled`: `undefined` is what a spread or a conditional produces when it yields nothing, so it is indistinguishable from a forgotten key. The classifier tests values, not key presence.

Two consumers read the classification: `validateOptions` in `config-resolution.ts` returns successfully on `disabled` so `resolve()` yields an empty array, and `plugin.ts` computes `isInert` once to gate its hooks (`plugin-lifecycle.md`). When inert, no model is loaded, no `ManagedRuntime` is built and no snapshot database is opened; the LLMs alias and scope injection are skipped so RSPress's own LLMs UI is left untouched (`llms-integration.md`).

## Config helpers

`fromDir(dir, overrides?)` builds one `MultiApiConfig` from a built model folder; `fromParentDir(parentDir, options?)` scans a parent directory and builds one per subfolder, requiring every non-dotfile subdirectory to be a valid model folder. Discovery delegates to `@tsdoctor/bundle`'s `discoverBundle`, run synchronously over the `SyncDiscoveryLayer` FileSystem bridge so the helper API stays sync. Adapter-side and deliberately not delegated: the `package.json` requirement (the bundle spec's discovery needs only layer 0; the plugin is stricter), baseRoute templating, `MultiApiConfig` assembly and the error messages.

The helpers inject no default `baseRoute`. When omitted, resolution applies a context-aware default: under `api:` the docs mount at `/api`, under `apis:` at `/{unscopedName}/api`, in both cases appending `apiFolder ?? "api"`. A caller can still pass a `{dirname}` / `{packageName}` template string or a `(info: DirInfo) => string` callback.

## ConfigService.resolve

`ConfigService.layer` is a zero-argument static; the implementation is `makeConfigService` in `layers/config-resolution.ts`.

**Inputs:** `PluginConfig` (the decoded options, read once at layer construction) and an `RspressConfigSubset` extracted from RSPress's `UserConfig` per call.

**Output:** `ReadonlyArray<ResolvedApiConfig>` — model, paths, categories, source, theme, the derived site URL, `ogImage`, docs roots, two views of the package's `package.json`: the loose `packageJson` that feeds dependency extraction and `manifest?: PackageManifest`, the same file decoded through `@effected/package-json`, which is the shape `@tsdoctor/seo` derives attribution from, plus a resolved `@tsdoctor/bundle`: `bundle: ResolvedBundle` (always present — a bundle with no `tsdoctor.json` still resolves, its `name` falling back to the api.json model's own name), `siteName?: string` (`resolved.project?.value.name ?? resolved.name.value`, for `og:site_name`) and `bundleOgImage?: PublishedOpenGraphImage` (the manifest's Open Graph image, published into the site's public directory; the legacy `ogImage` option, resolved through `OgService`, always outranks it). `PackageManifest` is presence-lenient but shape-strict, so one malformed field fails the whole decode — and that degrades to the field being absent with a `ConfigValidationWarning`, never to a failed build.

**The canonical site URL is derived, not configured.** There is no `siteUrl` option; `RspressConfigSubset` carries RSPress's `siteOrigin` and `base`, and `deriveSiteUrl` joins them in RSPress's documented `siteOrigin + base + routePath` order. Asking for the deployment URL twice invites the two answers to disagree. With no `siteOrigin` the prefix is `""` and URLs are root-relative, so head tags are still emitted and inspectable under `rspress dev` — which is why the head-tag block is gated on `packageName`, not on a non-empty site URL (`structured-data-and-og.md`).

**Resolving the bundle.** `resolveApiBundle` (`layers/config-resolution.ts`) runs alongside the rest of `resolve` per API: it calls `loadBundle` on the model's directory — a loader-function or URL-based model has no directory to discover a `tsdoctor.json` sidecar beside, so it falls back to an inferred bundle carrying only the package name — resolves it with an empty platform tier (the RSPress adapter has no platform-override tier of its own) and, when a `siteUrl` and an `openGraph` block both exist, publishes the images through `publishBundleAssets` into `<rspressRoot>/public/tsdoctor/<unscopedName>/` (a `VersionConfig` entry passes its version as the `subdir`, so per-version images do not overwrite each other — `bundle-spec.md`). `loadBundle` pins the model it was already handed (`overrides: { modelPath, name: packageName }`) rather than letting discovery re-pick an `*.api.json` candidate in the directory; re-running candidate selection here would widen what "a bundle failure" means to "a second unrelated model file in this folder" or "a malformed package.json", neither of which the field name should cover. Only a malformed `tsdoctor.json` (`BundleManifestError`) fails typed as `ConfigValidationError` with `field: "bundle"`, the same posture as a malformed tsconfig; a discovery or layer-read failure (`BundleDiscoveryError` / `BundleLayerError`) degrades to a `ConfigValidationWarning` with `field: "bundle"` plus the inferred bundle, exactly the loader-function fallback above. An asset-publish failure separately degrades to a `ConfigValidationWarning` with `field: "openGraph"` rather than failing the build (`structured-data-and-og.md`).

`@tsdoctor/manifest` — the schema `loadBundle` and `publishBundleAssets` decode and encode through — is in both adapters' `dependencies`, not merely a transitive workspace edge; the RSPress dependency closure invariant (`effect-service-layer.md`) treats it the same as the rest of the `@tsdoctor/*` graph.

**Error channel:** `ConfigValidationError` only; the requirement channel is `TwoslashCacheService | TwoslashEnvironments | FileSystem.FileSystem | Path.Path` — `Path` joined the channel for `resolveApiBundle`'s directory and public-path arithmetic. Model-load failures emit `ModelLoadFailed` and are `Effect.orDie`d; external type loading degrades rather than fails. A bad `package.json`, an `externalPackages` conflict and a malformed tsconfig each fail as a typed `ConfigValidationError` carrying `field`, `reason` and the original `cause`, so they reach `issues.json` rather than escaping as defects (`build-progress-and-issues.md`). A malformed tsconfig stays fatal rather than degrading to default compiler options, which would type-check every example against a configuration the user did not ask for.

`errors.ts` holds only `ConfigValidationError` and `TypeRegistryError`. What the page, Twoslash and Prettier subsystems report is a `PluginEvent` through the event bus (`error-observability.md`), not a second error vocabulary.

## Config resolution modules

`config-resolution.ts` keeps the long resolution generator; three concerns live beside it:

| Module | Contents |
| --- | --- |
| `layers/api-results.ts` | `mergeApiResult` (pure) and `emitVfsPayloadEvents` (effectful) — the per-API accumulator seam shared by the versioned, single and multi-API paths |
| `layers/type-environment.ts` | `registerTypeEnvironments`, `resolveTsConfigTyped` |
| `layers/external-types.ts` | `mergeExternalTypes` — the one phase that degrades rather than fails |

`api-results.ts` is split along the pure/effectful seam because the multi-API path emits its events at a different moment than the other two; one combined helper would fit two paths and leave the third with its own copy. `mergeExternalTypes` takes the type registry as an argument rather than yielding the tag, because the layer resolves it once at construction and yielding it inside would widen `resolve`'s requirement channel for a dependency that does not vary per call.

## Rationale

- **Why a typed inert mode instead of "comment the plugin out":** a site can wire the plugin before its first model build and keep user-authored `with-api` code blocks working, and the difference between an explicit empty value and a forgotten key stays loud.
- **Why the manifest is decoded twice:** dependency extraction wants a loose object and attribution wants typed `Person` / `Repository` / SPDX values; replacing the loose field with the typed one is a separate refactor.
- **Why the site URL is not an option:** the plugin's answer would silently win over RSPress's, emitting `canonical` and `og:url` for a host the site is not served from.
- **Why `resolve` returns only the API configs:** it used to return a sixteen-field build context that carried things config resolution neither produced nor owned; each of those now has a service or a `Context.Reference` (`effect-service-layer.md`).

## Related documentation

- **Build architecture overview:** `build-architecture.md`
- **Effect service layer:** `effect-service-layer.md`
- **Plugin lifecycle and the inert gates:** `plugin-lifecycle.md`
- **Bundle discovery, resolution and Open Graph asset publishing:** `bundle-spec.md`
- **Per-scope type environments and compiler-option normalization:** `type-loading-vfs.md`
- **The site URL and manifest consumers:** `structured-data-and-og.md`
- **Where typed configuration failures land:** `build-progress-and-issues.md`
