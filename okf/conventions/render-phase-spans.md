---
type: Convention
title: Never measure a code-block span across an await
description: Time code-block rendering with synchronous spans only, summed rather than measured across an await, and cross-check against wallMs.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: e3dd4b89b9f18440f8b8e39827f4af5f3e17d8192de75fbd5edbecb64351c775
stale_after: 2026-12-12T00:00:00Z
tags: [observability, performance, testing]
sources:
  - id: remark-api-codeblocks
    resource: ../../platforms/rspress/src/remark-api-codeblocks.ts
  - id: twoslash-timing-wrapper
    resource: ../../platforms/rspress/src/twoslash-timing-wrapper.ts
---

# Never measure a code-block span across an await

When timing code-block rendering (Shiki, Twoslash), measure only synchronous
spans and add them together. Never open a span before an `await` and close
it after — `unist-util-visit`'s traversal is synchronous, so every code
block's async IIFE on a page starts before any of them resumes from its
first `await`, and Shiki's `codeToHast` is itself synchronous, so the render
work for every block on the page completes during that same synchronous
pass before any continuation runs. A span that crosses the `await` therefore
reports the whole page's batch window, not that one block's cost.

## Rules

- In `platforms/rspress/src/remark-api-codeblocks.ts`, measure only the
  render call and the cross-linking pass as separate synchronous spans and
  sum them — do not wrap the `await hastPromise` line in a timer.[^remark-api-codeblocks]
- Wrap Twoslash's `preprocess` hook fresh **per block** via
  `createTwoslashTimingWrapper` (`twoslash-timing-wrapper.ts`), closing over
  that block's own accumulator. Blocks on a page render concurrently, so a
  shared accumulator races.[^twoslash-timing-wrapper]
- Spread the remaining Shiki transformer hooks onto the wrapper rather than
  replacing the transformer outright — Shiki's `WeakMap` keyed on `this.meta`
  must still line up with the original transformer's hooks.
- Keep the additivity cross-check: the render sink's `wallMs` is the window
  from the first code-block event to the last on a page. Summed per-block
  spans may legitimately exceed `wallMs` by up to one block's duration (the
  window opens after the first block's work is already done), but a summed
  total that comes out as a multiple of `wallMs` means the await-crossing
  bug is back.
- `with-api` fence timing (`remark-with-api.ts`) is a known upper bound, not
  an exact measurement: that path calls the standalone async `codeToHast`,
  which resolves a lazily created highlighter and must cross an `await`, so
  concurrently rendered blocks on the same page can land inside its
  `shikiMs` span. Do not "fix" this by trying to make it exact — the
  highlighter it would need is scoped to documented API scopes only, and a
  `with-api` fence can render outside any scope.

## Why

The signature of the await-crossing bug is every "slow" block on a page
reporting the identical duration — that is the page's batch window, not any
individual block's cost. Two earlier measurement attempts got this wrong in
exactly this way, and the wrong data would have misdirected the fix (which
turned out to be a persisted Twoslash result cache, not, say, per-block
Shiki tuning). A unit test cannot catch this because a batch-window artifact
still produces a plausible-looking number; only the additivity check against
real page timings surfaces it.

## How to check

- Any new or edited timing code: confirm no `await` sits between the
  `Effect`/timer start and its corresponding stop inside the code-block
  render path.
- Run a fixture site build with several code blocks per page and inspect
  `.api-docs/build/render-phase.json`'s `byFile` / `slowest` entries — if
  every block on one page reports the same `twoslashMs` or `shikiMs`, the
  await-crossing bug has returned.
- Recompute the additivity check: sum every block's span for a page and
  compare it against that page's `wallMs`. The sum should exceed `wallMs` by
  at most one block's duration, never be a clean multiple of it.

[^remark-api-codeblocks]: The synchronous-span comment and the `await hastPromise` line sit
  together in `remark-api-codeblocks.ts`, spelling out exactly why the timer
  boundaries are drawn where they are.
[^twoslash-timing-wrapper]: `twoslash-timing-wrapper.ts` wraps `preprocess` per invocation
  rather than mutating the shared transformer, and spreads the transformer's
  other hooks onto the wrapper object.
