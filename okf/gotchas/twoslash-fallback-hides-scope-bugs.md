---
type: Gotcha
title: A transformer coming back proves nothing about scope routing
description: transformerFor(apiScope) falls back to the first registered environment on any unknown scope, so a scope-routing bug degrades to build-wide type-checking with a green suite instead of failing loudly.
resource: ../../platforms/rspress/src/services/TwoslashEnvironments.ts
tags: [testing]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: f48477b71c5fb82c54d31b31283ed5d386a160f43441b3ee17b7b8e09ac78e0c
status: stable
---

# A transformer coming back proves nothing about scope routing

## What you see

A test (or a manual check) calls `transformerFor(someScope)` and gets back
a non-null `ShikiTransformer`. The test passes. Hover tooltips render on
the site. Nothing in the output says which compiler configuration actually
checked the block.

## What you will wrongly conclude

That a non-null return means the scope is wired correctly — checked under
its own `tsconfig`/`compilerOptions`, the environment its API declared.

## What is actually true

`TwoslashEnvironmentsShape.transformerFor`[^1] falls back to the **first**
environment ever registered whenever the requested scope has no
registration of its own. That fallback exists on purpose — a `with-api`
fence on a page outside any documented package's route still gets checked
under something rather than nothing — but it makes every scope-routing bug
invisible by construction: if `registerScope`'s fingerprint ever drifts
from `registerEnvironment`'s (both must compute the fingerprint of the
encoded compiler options identically), every scope lookup misses its own
environment and silently falls back to the first one registered instead.
This already happened once: every scope degraded to build-wide
type-checking while a 994-test suite stayed green, because every assertion
in the suite was "a transformer came back", which is true of the fallback
too.

## What to do

Never assert "`transformerFor` returned non-null" as evidence that
per-scope routing works. Assert that a registered scope's transformer is
the SAME instance (or produces demonstrably different behavior) as the one
built for its own `registerEnvironment` call — i.e., that two APIs with
different compiler configurations get two different environments, not one
shared fallback. When debugging a site where hovers look wrong for one
package only, suspect the fingerprint computed in `registerScope` has
drifted from the one `registerEnvironment` computes, not a Twoslash or
Shiki failure.

[^1]: [platforms/rspress/src/services/TwoslashEnvironments.ts](../../platforms/rspress/src/services/TwoslashEnvironments.ts)
