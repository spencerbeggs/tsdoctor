---
type: Gotcha
title: "ae-missing-release-tag on a _base class names a synthesized base, not a real undocumented class"
description: API Extractor flags AgentNotFoundError_base and RunManifest_base as missing a release tag; both are anonymous bases Effect's class factories synthesize, and the fix is a narrower suppressWarnings pattern, never a release tag on a base const.
resource: ../../modules/effect-kit/effected.toml
tags: [dx, release]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-11-09T18:10:55Z
status: deprecated
integrity:
  generated:
    body: 62d5e71263a643cd
---

# `ae-missing-release-tag` on a `_base` class names a synthesized base, not a real undocumented class

> **Deprecated.** Since the move to `effected package build`,
> `modules/effect-kit/dist/prod/issues.json` no longer reports
> `ae-missing-release-tag` for either `_base` identifier, and the
> `ae-forgotten-export` diagnostics on them land in `suppressed` through the
> build's default `_base` rule, with no entry in
> `modules/effect-kit/effected.toml`[^3]. The explanation below still
> describes what a `_base` identifier is if the warning returns.

## What you see

`modules/effect-kit/dist/prod/issues.json`[^1] reports two warnings:

```text
"AgentNotFoundError_base" is part of the package's API, but it is missing
a release tag (@alpha, @beta, @public, or @internal)
"RunManifest_base" is part of the package's API, but it is missing
a release tag (@alpha, @beta, @public, or @internal)
```

pointing at `modules/effect-kit/src/index.ts:50` and `:82` — the lines
where `AgentNotFoundError` and `RunManifest` are declared, not any `_base`
identifier written anywhere in the source.

## What you will wrongly conclude

That a class named `AgentNotFoundError_base` or `RunManifest_base` exists
somewhere and needs a `@public`/`@alpha`/`@beta`/`@internal` tag added to
it — or that the fix is to annotate the base of the factory call by hand.

## What is actually true

Neither `_base` identifier is written in the source. `AgentNotFoundError`
extends `Schema.TaggedError<AgentNotFoundError>()(...)` and `RunManifest`
extends `Schema.Class<RunManifest>(...)`[^2] — both Effect class factories
that synthesize an anonymous base class under the hood, which API
Extractor's dts-rollup names `<ClassName>_base` because it has no other
name to give it. The synthesized base is invisible in the TypeScript
source entirely; it exists only in the rolled-up `.d.ts` API Extractor
inspects, which is also why `ae-forgotten-export` on the same `_base`
identifier is already sitting in the `suppressed` bucket of the same
`issues.json` — that diagnostic IS handled, by the `suppressWarnings`
rule (the build's default, restated explicitly in
`packages/model/effected.toml`):

```toml
[[package.build.meta.tsdoc.suppressWarnings]]
messageId = "ae-forgotten-export"
pattern = "_base"
```

That rule only matches `ae-forgotten-export`. `ae-missing-release-tag` is
a different `messageId` on the same `_base` identifier, and the current
config does not list it, so it surfaces as a live warning instead of
landing in `suppressed` beside its sibling.

## What to do

If the warning returns, add `suppressWarnings` entries to
`modules/effect-kit/effected.toml`[^3] matching both message ids against
the same `_base` pattern. A list there replaces the default `_base` rule,
so restate it:

```toml
[[package.build.meta.tsdoc.suppressWarnings]]
messageId = "ae-forgotten-export"
pattern = "_base"

[[package.build.meta.tsdoc.suppressWarnings]]
messageId = "ae-missing-release-tag"
pattern = "_base"
```

Never add `@public` (or any release tag) to a hand-written base const, and
never write a standalone annotation targeting the synthesized base — there
is no source-level declaration to attach it to. The house policy is to
write the factory call inline, exactly as `AgentNotFoundError` and
`RunManifest` already do, and suppress both message ids narrowly by
pattern rather than changing how the class is declared.

[^1]: [modules/effect-kit/dist/prod/issues.json](../../modules/effect-kit/dist/prod/issues.json)
[^2]: [modules/effect-kit/src/index.ts](../../modules/effect-kit/src/index.ts)
[^3]: [modules/effect-kit/effected.toml](../../modules/effect-kit/effected.toml)
