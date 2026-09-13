---
type: Limitation
title: with-api scope inference never fires on any fixture site
description: "inferApiScope's docs/en/{api}/ path pattern matches no fixture site, so a user-authored with-api fence outside a package's route always falls back to the first registered Twoslash environment."
bounds: ../modules/rspress-plugin-api-extractor.md
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 635875b8da91d000e4717847e0bb8d569a1f86611a0239598eb9409ad7413c9c
---

# `with-api` scope inference never fires

## Trigger

A user-authored `with-api` code fence (as opposed to a generated
`ApiSignature`/`ApiMember`/`ApiExample` block) sits on a hand-written MDX
page that is not part of any documented package's generated route tree.
`remark-with-api.ts`'s `inferApiScope` tries to recover which API's Twoslash
environment such a fence should type-check against by matching the file path
against a `docs/en/{api}/...` (or `website/docs/en/{api}/...`) shaped
regular expression.[^1]

## Symptom

No fixture site (`sites/basic`, `sites/versioned`, `sites/i18n`,
`sites/multi`, `sites/effect`) ever produces a path shaped that way, so
`inferApiScope` returns `undefined` on every real build this repo runs. The
fence's `getTransformer(apiScope)` call then falls back to the first
Twoslash environment registered for the build,[^2] silently type-checking
the block against whichever API happened to resolve first rather than the
one the page is actually about. Nothing reports this: the block renders,
hovers appear, and the fallback looks identical to a correct scope match.

## Why this is acceptable

Generated blocks (`ApiSignature`, `ApiMember`, `ApiExample`) never take this
path — their scope comes from the pipeline's per-API `WorkItem`, not from
path inference. `with-api` is reserved for hand-authored guide prose, which
every fixture site in this repo happens not to use in a nested per-API path
layout, so the defect has never been observed against real content.

## What a fix would take

Which module should own path-to-scope inference is an open design question,
not a small patch: the mapping from a rendered page's file path to a
documented API's scope is currently implicit in each site's `baseRoute`
configuration, and no single function computes it in the direction
`remark-with-api.ts` needs (file path → scope). A fix requires either
threading the resolved route map's scope-to-route mapping backward into the
remark plugin, or having each site declare its own path pattern explicitly
rather than assuming `docs/en/{api}/`.

[^1]: platforms/rspress/src/remark-with-api.ts:28-43
[^2]: platforms/rspress/src/remark-with-api.ts:49-50
