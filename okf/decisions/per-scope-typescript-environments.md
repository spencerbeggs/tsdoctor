---
type: Decision
status: stable
title: One TypeScript environment per distinct resolved compiler config
description: Each documented API type-checks under its own resolved compiler options, deduplicated by a fingerprint of the encoded config, so one API's tsconfig no longer wins for every API on a multi-API site.
tags: [architecture, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: d2924a5cf9eb3c9ac4fa0cf83389f347690ae24caf9b5e3301d30565f5ee6de6
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# One TypeScript environment per distinct resolved compiler config

## Context

Before this decision, a multi-API RSPress site type-checked every
documented API's code examples under a single shared TypeScript
environment, built from whichever API's compiler configuration happened to
register first. An API with `strict: false` or a different `lib` setting
than its sibling would have its examples type-checked against the wrong
configuration, with no way to tell from the output that the wrong config
was in effect.

## Decision

`registerTypeEnvironments`
(`platforms/rspress/src/layers/type-environment.ts`) resolves every
documented API's raw tsconfig/`compilerOptions` config and calls
`registerEnvironment` once per distinct resolved configuration on
`TwoslashEnvironments`
(`platforms/rspress/src/services/TwoslashEnvironments.ts:54`); resolution
for APIs that share a tsconfig is memoized by config so it is read once.
Environments are deduplicated by a fingerprint of the *encoded* compiler
options (`TwoslashEnvironments.ts:50`), not the raw config object, so two
APIs whose configs resolve to the same canonical values — even if spelled
differently — share one environment and its language service.
`registerScope(apiScope, compilerOptions)` (`TwoslashEnvironments.ts:65`)
records which resolved configuration each API scope is documented under,
and `transformerFor(apiScope)` (`TwoslashEnvironments.ts:81`) routes a code
block to that scope's environment at render time — falling back to the
first environment ever registered for a block that belongs to no
documented scope (a `with-api` fence on a page outside any package's
route).

Resolution is a two-level cascade: `DEFAULT_COMPILER_OPTIONS`, then the
global plugin config, then the individual API's config, each layer merging
onto the previous rather than replacing it — except `lib`, where a
discovered tsconfig that declares it replaces the array wholesale, which
is why every `fromDir`-configured fixture site resolves to `lib:
["esnext"]` with no DOM. `VersionConfig` (`packages/*/src/schemas/config.ts`
family) deliberately carries no `tsconfig` or `compilerOptions` field of
its own: that third cascade level existed once and was never read by
anything, so a multi-version site type-checked every version against the
same defaults regardless of what a version-level tsconfig said. The unused
level was deleted rather than wired up, since wiring a level nobody had
verified worked is a bigger correctness risk than removing it.

The underlying file set stays shared across every environment: every
documented package's declarations live under `node_modules/<packageName>/`
in one combined virtual file system, because the import-generation system
emits `import type { X } from "B"` whenever package A's declarations
reference a type owned by package B, and those imports resolve only
because both packages are visible in the same VFS. Per-scope environments
therefore differ from each other in compiler configuration only, never in
which declaration files they can see.

## Alternatives rejected

- **Keep one shared environment and pick "the most permissive" config.**
  Rejected as a worse version of the original bug: it would still
  type-check every API under a configuration none of them necessarily
  declared, just a differently wrong one.
- **Split the file set per scope along with the compiler config.** Would
  sharpen cache invalidation (a change to one package would not touch
  another package's cached results) but breaks the cross-package `import
  type` references the import-generation system relies on; not planned.
- **Wire the never-read `VersionConfig` tsconfig level instead of deleting
  it.** Rejected: nothing in the pipeline ever read it, so keeping it would
  have kept the same silent-defaults bug at one more level of the cascade
  without adding any real capability.

## Consequences

- Fingerprinting must stay computed identically wherever an environment is
  registered and wherever a scope is registered; if the two fingerprint
  computations drift, every scope lookup falls through to the
  first-registered-environment fallback and per-scope type-checking
  silently degrades to build-wide again, with no error and no obviously
  wrong output — the fallback is the subsystem's most dangerous behavior,
  and a test that only asserts "some transformer came back" cannot catch
  the drift.
- This was deliberately not built or measured as a performance change: see
  `persisted-twoslash-result-cache.md` for why the render-phase cost lived
  almost entirely in Twoslash itself, not in environment sharing.
- A `VersionConfig` entry that wants its own compiler options has no level
  to declare them at; adding one back would need to be re-verified as
  actually read before shipping, given why the previous level was removed.
