---
type: Interface
status: draft
kind: config
resource: ../../platforms/rspress/src/schemas/config.ts
title: RSPress plugin options (PluginOptions)
description: The Effect Schema PluginOptions decodes into ResolvedApiConfig; consumer-facing types are the Encoded (optional-field) shapes.
tags: [dx, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 8c52fa3afe976972067c0ef10ba96db7ef2a5fd7e25aeecf6e100ad8fc4872df
---

# RSPress plugin options (`PluginOptions`)

## What a consumer writes

A site passes an object matching `PluginOptions`'s **`Encoded`** type[^1] to
`ApiExtractorPlugin(rawOptions)`. Every field on `SingleApiConfig`,
`MultiApiConfig`, `VersionConfig`, `CategoryConfig` and `LlmsPlugin` is
optional in the type a consumer writes — decoding through Effect Schema
fills in the documented defaults (`collapsible: true`, `collapsed: true`,
`overviewHeaders: [2]`, `llmsPlugin.enabled: true`, etc.)[^1]. Reading the
`.Type` (post-decode) shape instead of `.Encoded` will show fields that look
required but are not something a caller ever has to supply.

## `api` vs `apis`, and the inert opt-in

`api` (a `SingleApiConfig`) and `apis` (an array of `MultiApiConfig`) are
mutually exclusive and both accept `null`[^1]. `classifyApiConfig`[^2]
collapses the two into one of three states:

| State | Trigger | Effect |
| --- | --- | --- |
| `configured` | at least one of `api`/`apis` carries real config | docs generate |
| `disabled` | `api: null`, `apis: null`, or `apis: []` | plugin is inert: RSPress wiring installs, nothing generates |
| `missing` | neither key supplied, or one supplied as `undefined` | validation error |

A populated option always wins over an empty sibling, so `{ api: cfg, apis:
[] }` decodes as `configured`. An explicit `undefined` is `missing`, not
`disabled` — it is what a spread or a conditional produces when it yields
nothing, and is treated as "forgot to set this" rather than "opted out."

## `baseRoute` defaulting

When a config omits `baseRoute`, resolution applies a context-aware default:
under `api:` it mounts at `/api`; under `apis:` at
`/{unscopedName}/api`; both append `apiFolder ?? "api"`. A caller can still
pass a literal string, a `{dirname}` / `{packageName}` template string, or a
`(info: DirInfo) => string` callback to `fromDir`/`fromParentDir`[^3]. This
promise is elaborated in
[../decisions/site-url-is-derived-not-configured.md](../decisions/site-url-is-derived-not-configured.md)
for the adjacent (and deliberately absent) `siteUrl` option.

## Config helpers: `api.fromDir` / `apis.fromDir`

`ApiExtractorPlugin.api.fromDir(dir, overrides?)`[^3] builds one
`MultiApiConfig` from a built model folder (requires `package.json` plus a
`*.api.json`); `ApiExtractorPlugin.apis.fromDir(parentDir, options?)` scans a
parent directory and builds one config per subfolder, requiring every
non-dotfile subdirectory to be a valid model folder. Both are attached as
namespaces on the exported `ApiExtractorPlugin` factory function[^4], not
separate exports.

## `llmsPlugin`: `boolean | LlmsPlugin`

`llmsPlugin` accepts a bare `boolean` or a full `LlmsPlugin` object, and can
be set at the plugin level, per-API (`SingleApiConfig`/`MultiApiConfig`), and
per-version (`VersionConfig`)[^1] — the most specific level wins via a
spread-precedence merge. RSPress's own `llms: true` (or `pluginLlms()` in the
site's plugins array) is a separate prerequisite: both it and the resolved
`enabled` flag must be true for LLMs post-processing and UI injection to
activate.

## `observability`

`observability.progressInterval` accepts a number of **seconds** or `false`;
omitted or `true` resolves to a 10-second default, and `false` or a
non-positive/non-finite number disables the heartbeat entirely[^5].
`observability.logLevel` accepts `"none" | "error" | "warn" | "info" |
"debug" | "trace" | "verbose"`; `"verbose"` normalizes to `"debug"`, and
`json` output is derived automatically (`true` only when the resolved level
is `"debug"`)[^5]. `observability.trace` accepts `true` (a computed path
under `.api-docs/build/`) or an explicit string path.

## External type loading

`externalPackages` (`{ name, version }` specs) and `autoDetectDependencies`
(`{ dependencies, devDependencies, peerDependencies, autoDependencies }`,
each independently toggled, defaulting to `dependencies: true`,
`peerDependencies: true`, `autoDependencies: true`,
`devDependencies: false`) control which external package declarations load
into the shared VFS for Twoslash[^1]. `tsconfig` and `compilerOptions` are
promised at the **global** (`PluginOptions` has no such field directly — set
it via `SingleApiConfig`/`MultiApiConfig`) and **per-API** levels only.
**`VersionConfig` carries neither field** — a per-version tsconfig level was
never wired to anything, so declaring one on a `VersionConfig` is silently
ignored rather than type-checking that version differently.

## Open Graph

`ogImage` is a legacy, still-live option at the global and per-API levels,
resolved through `OgService`. It **outranks** whatever Open Graph image the
resolved `@tsdoctor/bundle`'s `tsdoctor.json` carries, because `OgService`
can additionally probe the site's own `docs/public` directory — something
the bundle resolver has no access to. There is no `siteUrl` option (see the
linked decision) and no `twitterSite` option; `twitterSite` is a seam
`@tsdoctor/seo`'s `headTags` accepts but no plugin option currently supplies
a value for it.

[^1]: [platforms/rspress/src/schemas/config.ts](../../platforms/rspress/src/schemas/config.ts)
[^2]: [platforms/rspress/src/config-utils.ts](../../platforms/rspress/src/config-utils.ts)
[^3]: [platforms/rspress/src/config-helpers.ts](../../platforms/rspress/src/config-helpers.ts)
[^4]: [platforms/rspress/src/plugin.ts](../../platforms/rspress/src/plugin.ts)
[^5]: [platforms/rspress/src/schemas/observability.ts](../../platforms/rspress/src/schemas/observability.ts)
