---
type: Convention
title: Services own their layers
description: A service declares its live layer as a static on the class itself; no separate *Live.ts modules.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 358204e008f1cbfef2d1531a68e3f656db8f5bdfda14ce53a29cf49c58dda36d
stale_after: 2026-12-12T00:00:00Z
tags: [architecture, dx, testing]
sources:
  - id: build-env
    resource: ../../platforms/rspress/src/BuildEnv.ts
  - id: services-inventory
    resource: ../../platforms/rspress/CLAUDE.services.md
---

# A service owns its layer as a static; no separate `*Live.ts` modules

Declare a service as `class X extends Context.Service<X, XShape>()("rspress-plugin-api-extractor/X")` and put its live layer on the class itself as a static (`X.layer`). Do not create a separate `XServiceLive.ts` module — `../../platforms/rspress/src/services/` holds one file per service, tag and layer together, matching the pattern the core `@tsdoctor/*` packages use; `../../platforms/rspress/CLAUDE.services.md` is the current inventory.

Use `Layer.suspend(() => …)` for a layer composition, or `Effect.suspend(() => make())` for an effect body, whenever a service's static layer names a `const` declared further down the same module, or names a binding imported from a module that imports this one back. A static initializer runs while the module body is still being evaluated, so referencing something not yet defined throws at import time — and the only symptom is a test run reporting zero tests passed with exit code 0, not a stack trace pointing at the real cause. `TypeRegistryService.layer`, `TwoslashCacheService.layer`, `ConfigService.layer`, and `OgService.layer` all need this treatment because they name something defined after them.

Make a layer static zero-argument unless the layer genuinely needs a runtime argument. Layers memoize by reference, so a factory function called twice mints two distinct layers — the second one silently capturing its own dependency instance. `ConfigService.layer` is a plain static for exactly this reason: calling it twice would be a type error, not a silent duplicate build. `HighlighterService.layer(themes)` and `SnapshotService.layer(dbPath)` remain factories because they genuinely vary per build, so `../../platforms/rspress/src/layers/AppLayer.ts` binds each factory's result to a single `const` before merging it into the stack — never calls the factory inline at more than one merge site.

Reach for a `Context.Reference` — see `../../platforms/rspress/src/BuildEnv.ts` — only where its default is merely conservative, never where a silently wrong default would be dangerous. Use a `Context.Service` instead wherever there is no sensible default at all, so a forgotten wiring fails loudly as "service not provided" rather than quietly running with a default. The decoded plugin options (`PluginConfig`) are a Service and not a Reference for this reason: there is no sane default for "which APIs is this site documenting."

Ship `makeTest(overrides)` and `layerTest(overrides)` beside a service's live layer whenever a test double is needed. Every member should default to the shape a build takes when nothing is configured — a snapshot lookup misses, a spec resolves unchanged, a cache is cold. A member whose natural "nothing configured" default is indistinguishable from a real answer must throw when called unstubbed instead of returning that default silently; `ConfigService.resolve` and `OgService.resolveImage` both do this because their natural defaults (an empty array, `Option.none`) are exactly what an inert plugin also produces, so a test that forgot to stub them would otherwise assert against a build that generated nothing and pass anyway.

## Why

One place to read a service's contract and its construction — the class itself — is the same shape every core `@tsdoctor/*` package already uses, so a reader moving between workspaces meets one pattern rather than relearning a second convention per package. The static-initializer ordering hazard is not a hypothetical: it is why several real services in this codebase already carry `Layer.suspend` / `Effect.suspend` wrappers, and a new service skipping this step reintroduces a "0 tests passed, exit 0" failure mode that gives no direct signal about its cause. The zero-argument-static rule exists because a factory-shaped layer looks correct until it is called from two merge sites, at which point it silently builds two independent resources (two highlighters, two open database connections) instead of failing to compile.

## How to check

- `grep -rn "extends Context.Service" ../../platforms/rspress/src/services/` should show every service defining its layer as a class static, not in a sibling `*Live.ts` file.
- For a service whose static names a later-declared binding: confirm it is wrapped in `Layer.suspend` or `Effect.suspend` — grep the service file for the name it references and check ordering by eye.
- `grep -rn "\.layer(" ../../platforms/rspress/src/layers/AppLayer.ts` — every factory-style layer call should appear exactly once, bound to a `const`, never invoked twice across the app and emitter stacks.
- Confirm a test double exists for any service another module stubs in a test: `ls ../../platforms/rspress/src/services/*.ts` then check each for `makeTest` / `layerTest` exports.
