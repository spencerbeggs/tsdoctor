---
type: Gotcha
title: "ae-missing-release-tag on a _base class names a synthesized base, not a real undocumented class"
description: API Extractor flags AgentNotFoundError_base and RunManifest_base as missing a release tag; both are anonymous bases Effect's class factories synthesize, and the fix is a narrower suppressWarnings pattern, never a release tag on a base const.
resource: ../../modules/effect-kit/savvy.build.ts
tags: [dx, release]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: cbd0c774bb4d3bceb3fedd088acbe177734feb7a98f50fea8151bb1d72978cf0
---

# `ae-missing-release-tag` on a `_base` class names a synthesized base, not a real undocumented class

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
entry already in `savvy.build.ts`[^3]:

```ts
tsdoc: {
 suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
},
```

That entry only matches `ae-forgotten-export`. `ae-missing-release-tag` is
a different `messageId` on the same `_base` identifier, and the current
config does not list it, so it surfaces as a live warning instead of
landing in `suppressed` beside its sibling.

## What to do

Extend the existing `suppressWarnings` array in
`modules/effect-kit/savvy.build.ts`[^3] with a second entry matching
`ae-missing-release-tag` against the same `_base` pattern, so both
diagnostics the synthesized base produces land in the `suppressed`
bucket together:

```ts
suppressWarnings: [
 { messageId: "ae-forgotten-export", pattern: "_base" },
 { messageId: "ae-missing-release-tag", pattern: "_base" },
],
```

Never add `@public` (or any release tag) to a hand-written base const, and
never write a standalone annotation targeting the synthesized base — there
is no source-level declaration to attach it to. The house policy is to
write the factory call inline, exactly as `AgentNotFoundError` and
`RunManifest` already do, and suppress both message ids narrowly by
pattern rather than changing how the class is declared.

[^1]: [modules/effect-kit/dist/prod/issues.json](../../modules/effect-kit/dist/prod/issues.json)
[^2]: [modules/effect-kit/src/index.ts](../../modules/effect-kit/src/index.ts)
[^3]: [modules/effect-kit/savvy.build.ts](../../modules/effect-kit/savvy.build.ts)
