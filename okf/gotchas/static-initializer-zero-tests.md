---
type: Gotcha
title: "\"0 tests passed\" with exit 0 means a static threw at import time"
description: A service's static layer naming a const declared further down, or a binding from a module that imports it back, throws while the module body evaluates — vitest reports zero tests and a green exit code.
resource: ../../platforms/rspress/src/services/ConfigService.ts
tags: [testing, dx]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: a516af95db97a64a97f91d437aefc97944f7a45cc0cc53bd30839cdeba190361
status: stable
---

# "0 tests passed" with exit 0 means a static threw at import time

## What you see

`pnpm vitest run platforms/rspress/` (or any single test file import that
pulls in the affected module) reports something like `Tests 0 passed (0)`
and the process exits 0. No stack trace, no failing assertion, nothing red.

## What you will wrongly conclude

That the test file contains no tests, or that the test runner silently
skipped a file — a config problem, a glob that matched nothing, an empty
`describe` block. None of those are true, and chasing that theory wastes a
debugging pass.

## What is actually true

A class `static` initializer runs while the module body is still
evaluating. If a service's static layer reads a `const` declared further
down in the same file — or a binding imported from a module that in turn
imports this one back — that read throws at import time, before any test
in the file is ever collected. Vitest reports the import failure as "0
tests" with exit 0 rather than surfacing it as a failure, and the
typecheck stayed completely clean because TypeScript cannot see evaluation
order across a circular import.

`platforms/rspress/src/services/ConfigService.ts`[^1] carries exactly this
hazard: its `layer` static must read `makeConfigService` from
`../layers/config-resolution.js`, a module that imports `ConfigService`
itself. The same pattern recurs in `TypeRegistryService.layer`,
`TwoslashCacheService.layer`[^2] and `OgService.layer`.

## What to do

Wrap the risky reference in `Layer.suspend(() => …)` for a layer
composition, or `Effect.suspend(() => make())` for an effect body, so the
binding is read lazily once the module graph has finished evaluating
rather than eagerly at class-definition time. `ConfigService.layer` does
this with `Layer.effect(this, Effect.suspend(() => makeConfigService))`[^1];
`TwoslashCacheService.layer` does the same with `Layer.suspend(() =>
CacheBackedLive)`[^2]. When a test file you expect to run reports zero
tests and exit 0, suspect this before anything else — check whether any
service static in the import chain names a binding declared after it, or
imported from a module that imports back.

[^1]: [platforms/rspress/src/services/ConfigService.ts](../../platforms/rspress/src/services/ConfigService.ts)
[^2]: [platforms/rspress/src/services/TwoslashCacheService.ts](../../platforms/rspress/src/services/TwoslashCacheService.ts)
