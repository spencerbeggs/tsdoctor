---
type: Gotcha
title: Zero Twoslash cache lookups can mean Rspack never recompiled, not that the cache is useless
description: Measuring the Twoslash result cache with Rspack's own build cache intact reports zero lookups because the MDX never recompiled, which looks identical to "the cache isn't helping" but means the measurement never exercised Twoslash at all.
resource: ../../platforms/rspress/src/services/TwoslashCacheService.ts
tags: [performance, testing]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: fc986d4bec24ed0c7d4d49e53ba87bc8b11a3513c08896b31c10875cc518ed43
---

# Zero Twoslash cache lookups can mean Rspack never recompiled, not that the cache is useless

## What you see

You rebuild a site to measure the persisted Twoslash result cache and the
build finishes fast, with the cache reporting zero (or very few) lookups.

## What you will wrongly conclude

That the Twoslash result cache is not doing anything — no hits, no
misses, nothing measurable — and therefore not worth the persistence
machinery in `TwoslashCacheService`[^1].

## What is actually true

RSPress's own Rspack build cache, when warm, skips recompiling MDX that
has not changed. If the MDX never recompiles, the remark plugins — and
therefore the Twoslash transformer and its result cache — never run at
all. A fast build with zero cache lookups in that situation is not
evidence the cache is unhelpful; it is evidence the render pass the cache
instruments never executed. The two states (a genuinely useless cache, and
a render pass that Rspack skipped entirely) produce identical output —
zero lookups, a fast build — from the outside.

The service is built to persist across builds precisely because the
render pass IS expensive when it runs: Twoslash accounts for nearly all
render-phase code-block time, and the cache is the fix, measured on the
two-API `sites/multi` fixture as more than a 10x drop in render-phase time
between a cold and a warm cache, with byte-identical output.

## What to do

Before drawing any conclusion from a Twoslash-cache measurement, clear
Rspack's own build cache so the MDX genuinely recompiles and the render
pass actually runs. Then compare a cold Twoslash cache against a warm one
on the same cleared-Rspack-cache build — that is the only comparison that
isolates the Twoslash cache's own contribution. A "zero lookups, fast
build" result with Rspack's cache intact tells you nothing about whether
the Twoslash cache works.

[^1]: [platforms/rspress/src/services/TwoslashCacheService.ts](../../platforms/rspress/src/services/TwoslashCacheService.ts)
