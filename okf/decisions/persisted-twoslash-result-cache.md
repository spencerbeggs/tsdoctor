---
type: Decision
status: draft
title: A persisted Twoslash result cache is the render-phase performance fix
description: Measurement showed nearly all render-phase code-block cost is Twoslash type-checking concentrated in example blocks, so a persisted, XDG-shared result cache — not per-scope environments — is the performance work.
tags: [performance, architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 058c9611f91cf964ada1f0c506bb9f86542c5307034e6cb1a50bbc37db3f69fe
---

# A persisted Twoslash result cache is the render-phase performance fix

## Context

On a large multi-API site, the RSPress render pass that invokes the remark
plugins and Twoslash could run for minutes, and there were two candidate
fixes on the table before any decision was made: persist Twoslash's
type-check results across builds, or split the single shared TypeScript
environment into one environment per API scope. The two fixes have very
different costs to build, so which one to prioritize needed data, not a
guess — and the first two attempts to measure render-phase cost were
themselves wrong in ways that would have pointed the fix at the wrong
target (a batch-window span that measured a whole page's concurrent block
count rather than one block, and a Twoslash/Shiki split that mislabeled
which hook the time was spent in).

## Decision

Instrument first, then act on what the instrumentation showed. Measured on
the two-API `sites/multi` fixture, `ApiExample` blocks — roughly a tenth of
all code blocks — accounted for almost all render-phase time, and all of
that time was inside Twoslash; `ApiSignature` and `ApiMember` blocks, never
type-checked on RSPress, cost about a millisecond each. Every block flagged
as slow was a Twoslash block. That data settled the priority: a persisted
Twoslash result cache is the performance work, because it targets nearly
all of the measured cost, and per-scope TypeScript environments are not a
performance fix at all — splitting one shared environment reduces
environment-cache sharing, if anything working against the cache. Per-scope
environments shipped anyway, on correctness grounds only (see
`per-scope-typescript-environments.md`), not as a speed measure.

The cache implementation hooks `@shikijs/twoslash`'s `TwoslashTypesCache`
extension point: `read` and `write` wrap the whole `twoslasher()` call
(`packages/vfs/src/TwoslashCache.ts`), so a hit skips type-checking
entirely. Because those hooks are synchronous, persistence is load-once
before the render phase (`registerTypeEnvironments`, once the combined VFS
is final) and save-once after it (`afterBuild`); every lookup in between is
an in-memory map hit. The neutral half — keying, the generation codec,
`makeTwoslashCache` — lives in `@tsdoctor/vfs` rather than in either
adapter, so both RSPress and VitePress share one on-disk store
(`~/.cache/tsdoctor/twoslash.sqlite`) and one keying scheme; a site built
by either adapter warms the cache for the other.

Soundness of a cached result depends on the code, the compiler options,
the declarations it was checked against, and the compiler itself. The
per-entry key covers the code, its language, and the compiler options
(`twoslashEntryKey`); the generation hash (`twoslashEnvHash`,
`TwoslashCache.ts:127`) covers the combined VFS and the TypeScript version
— the TypeScript version is load-bearing because `lib.d.ts` and inference
change between compiler releases, so without it a warm cache would keep
serving the previous compiler's hovers. One input is deliberately kept out
of any derived key: the `@shikijs/twoslash` / `twoslash` renderer version,
which determines the shape of the stored `nodes`. `TWOSLASH_CACHE_FORMAT`
(`TwoslashCache.ts:66`) is the manual lever for that — bumped by hand when
those packages are upgraded.

## Alternatives rejected

- **Split into per-scope TypeScript environments as the primary
  performance fix.** Measurement showed the cost concentrated in
  type-checking itself, not in sharing one environment across scopes;
  splitting environments does not reduce type-check work and can reduce
  environment-cache reuse. It shipped later, but on correctness grounds
  only.
- **Optimize before measuring.** The first two measurement attempts —
  a batch-window span crossing an `await`, and a mislabeled Twoslash/Shiki
  split — would each have sent the effort at the wrong target had either
  been trusted without a second pass.
- **A per-adapter cache instead of a shared one in `@tsdoctor/vfs`.** A
  cache keyed and stored separately per adapter would mean a site rebuilt
  by the other adapter gets no benefit from a warm cache — the whole point
  of hosting it in the neutral VFS package.

## Consequences

- Coarse invalidation is accepted deliberately: because the generation key
  covers the whole VFS, a change to any documented package invalidates the
  cached results for every package, and the build immediately after an API
  item changes gets no benefit from the cache. Repeat builds over an
  otherwise-unchanged API — CI re-runs, prose-only edits, theme and config
  changes — are the case the cache optimizes, and on `sites/multi` a warm
  build's render phase dropped by more than an order of magnitude with
  output byte-identical to the cold build's.
- Every cache failure path (an unreachable or corrupt store) degrades to a
  cache miss rather than failing the build, matching the adapter's general
  posture that a cache is an optimization, never a correctness dependency.
- A future upgrade of `@shikijs/twoslash` or `twoslash` requires manually
  bumping `TWOSLASH_CACHE_FORMAT`; forgetting to do so risks serving stored
  node shapes the new renderer version does not expect.
