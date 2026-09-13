---
type: Convention
title: A behaviour change in an emitter ships as its own labelled commit
description: Any behaviour change to the pages IR builders or either adapter's emitter must ship in its own commit, verified by byte-identical fixture output plus a snapshot rebuild.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 457c9be06aed01d1cb35d44103729fb12c366345baa68ecd58415ffd06f86efd
stale_after: 2026-12-12T00:00:00Z
tags: [testing, architecture]
sources:
  - id: mdx-emit
    resource: ../../platforms/rspress/src/emit/mdx.ts
  - id: meta-emit
    resource: ../../platforms/rspress/src/emit/meta.ts
  - id: vitepress-markdown-emit
    resource: ../../platforms/vitepress/src/emit/markdown.ts
  - id: build-page
    resource: ../../packages/pages/src/Build.ts
---

# A behaviour change in an emitter ships as its own labelled commit

A behaviour change to a `@tsdoctor/pages` builder (`packages/pages/src/Build.ts`
and friends) or either adapter's emitter (`platforms/rspress/src/emit/mdx.ts`,
`emit/meta.ts`; `platforms/vitepress/src/emit/markdown.ts`) must land in its
own labelled commit. Never hide it inside a structural refactor of the
emitter or the pipeline around it.

## Rules

- Two output quirks are carried deliberately and must not be "fixed" as a
  side effect of unrelated work: the summary paragraph is never
  cross-linked, and the namespace member index routes members into the
  default category folders rather than the site's configured ones. Changing
  either is a product change and needs its own commit.
- The RSPress emitter's generics-escaping inconsistency (applied to the
  deprecation notice, member summaries and returns, function-level parameter
  descriptions, the returns section, see-also references and the namespace
  member index, but deliberately *not* to member-level parameter
  descriptions or enum member descriptions) stays as-is until a labelled
  commit decides to normalize it.
- When refactoring an emitter or a builder with no intended behaviour
  change, the acceptance evidence is: (1) byte-identical generated output
  for every fixture site, captured before the change and diffed after, and
  (2) a snapshot rebuild over the real pipeline reporting every file
  unchanged — followed by a second, no-change rebuild that stays
  byte-identical. Do not commit the captured goldens; they are a one-time
  diff, not a fixture to maintain.
- A passing unit test alone is not evidence of parity. A unit test can pass
  forever on an input no caller actually produces — the acceptance evidence
  must come from a rebuild over the real pipeline, not an assertion someone
  wrote by hand.

## Why

Pages and emitters have exactly one live behaviour: the bytes they write to
disk, checked by the snapshot system's content hash. A structural refactor
that quietly also changes output invalidates every downstream cache entry
and reads, in the commit history, as a refactor — nobody reviewing it knows
to look for a content change. Splitting the two kinds of change into
separate commits keeps "what changed" legible from the log alone. The
carried quirks and the escaping inconsistency exist because the generators
they replaced behaved that way; the byte-identity gate that validated the
generator-to-IR lift would have failed the moment either was "corrected" in
passing, so the design choice was to preserve them and flag them rather than
quietly diverge from a labelled, reviewed baseline.

## How to check

- Before merging a refactor of any file under `packages/pages/src/` or
  `platforms/*/src/emit/`, capture the generated output of every fixture
  site (`sites/*`), apply the change, regenerate, and diff — the diff must
  be empty.
- Run a snapshot-tracked build twice in a row over an unchanged fixture: the
  first run should report the touched files as changed only if intended
  (none, for a pure refactor); the second run must report every file
  `unchanged`.
- If a diff is non-empty and was not the point of the change, treat it as a
  regression, not an acceptable side effect — split the intended behaviour
  change into its own commit instead.
