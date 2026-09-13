---
type: Runbook
title: Measure hover parity before and after a Twoslash-path change
description: Verify that a change to the compiler-option seam, the VFS, the Twoslash transformer or the Twoslash result cache does not silently change rendered hovers, which no MDX diff can see because they render after config() returns.
resource: ../../sites/multi/package.json
tags: [testing, performance]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 81893363df9ec9197ad4163bef4071bd573fab83f1decc363af31af6b71deda0
---

# Measure hover parity before and after a Twoslash-path change

## Trigger

Any change to: the compiler-option decode/encode seam
(`@tsdoctor/vfs`'s `TsconfigParser.ts` / `TypeResolutionOptions.ts`), the
VFS construction (`ApiExtractedPackage`, import prepending), the Shiki
Twoslash transformer (`platforms/rspress/src/twoslash-transformer.ts`),
or the persisted Twoslash result cache
(`packages/vfs/src/TwoslashCache.ts`,
`platforms/rspress/src/services/TwoslashCacheService.ts`). Both fixture
sites and consumer sites are affected because the cache is shared XDG
state, not per-repo.

## Steps

1. Pick a fixture site that exercises more than one documented package so
   a per-scope regression is visible — `sites/multi`[^1] (two APIs:
   `@modules/effect-kit`, `@modules/kitchensink`).
2. Clear both caches so neither side gets a free ride:
   - The Twoslash XDG store: delete
     `~/.cache/tsdoctor/twoslash.sqlite` (or the platform-equivalent XDG
     cache path `@effected/xdg` resolves for the `"tsdoctor"` namespace).
   - Rsbuild/Rspack's own build cache for the site, so the MDX genuinely
     recompiles rather than reusing a cached render. A build that reuses
     Rspack's cache reports zero Twoslash lookups on either side and
     looks identical for the wrong reason.
3. Build the site **before** the change:
   `pnpm --filter @sites/multi run build` (or `pnpm build:multi` from the
   repo root). Capture the rendered output and the console build summary
   (Twoslash diagnostics count, cache hit/miss lines).
4. Apply the change, rebuild the same way from a cold cache.
5. Compare rendered hovers directly — an MDX diff between the two builds
   cannot see this, because head tags and Twoslash hovers are produced
   during RSPress's render pass, which runs after `config()` returns and
   after doc generation has finished writing files.
6. Read the build summary's `typechecked` count and the cache
   hit/miss lines on both runs.

## Observable end state

- Hovers are identical between the two builds (or differ only in the way
  the change intended).
- The `typechecked` count in the build summary is **not** zero on either
  run — a `0 typechecked` count, even with no diagnostics reported, means
  the render pass never reached a documented scope's Twoslash environment
  and every hover degraded silently rather than confirming parity.
- A rebuild with a warm cache (skip step 2 on a second pass) reports
  cache hits and a render-phase time reduced by an order of magnitude
  with output byte-identical to the cold build.

[^1]: [sites/multi/package.json](../../sites/multi/package.json)
