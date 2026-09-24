---
type: Gotcha
title: Passing the VFS as fsMap "works" and silently type-checks against nothing
description: Twoslash treats a supplied fsMap as the entire file system and switches off the compiler's node_modules/lib overlay, so every lib.*.d.ts disappears and noErrorValidation swallows the resulting diagnostics.
resource: ../../platforms/vitepress/src/Twoslash.ts
tags: [compat]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: da2ea4dbe94492614f61dd04381ccad364685bf146a74037d4594ec96727e013
status: stable
---

# Passing the VFS as fsMap "works" and silently type-checks against nothing

## What you see

You wire the combined declaration VFS into `@shikijs/vitepress-twoslash`'s
`transformerTwoslash` as `fsMap` instead of `extraFiles`. The build
succeeds. Twoslash fences render. No error appears anywhere.

## What you will wrongly conclude

That `fsMap` and `extraFiles` are interchangeable ways to hand Twoslash
the package's declarations, and that `fsMap` "worked" because the build
was green and nothing complained.

## What is actually true

Twoslash treats a supplied `fsMap` as the ENTIRE file system, not an
overlay — it switches the compiler's local `node_modules` overlay off
entirely. Handing it the combined VFS alone drops every `lib.*.d.ts` the
compiler would otherwise see, so every hover and every type-check runs
against a program with no standard library at all. Because both the
RSPress and VitePress adapters set `noErrorValidation: true`[^1] (examples
are documentation, not a test suite, and a type error in one example must
not fail the whole build), the resulting cascade of "cannot find name
`Promise`" / "cannot find name `Array`" diagnostics is swallowed rather
than surfaced. The only symptom is a hover that renders a confidently
wrong or empty type.

## What to do

Always pass the combined VFS as `twoslashOptions.extraFiles`, never as
`fsMap`. `extraFiles` overlays the compiler's own libs rather than
replacing the whole file system — `makeTwoslashTransformer` in
`src/Twoslash.ts`[^1] does this, matching what the RSPress plugin's own
transformer does with the same VFS and compiler options, which is what
"the same type environment" means across both adapters. If a hover on
either site ever looks confidently wrong rather than simply absent, check
first whether `fsMap` crept back in before suspecting the compiler options
or the VFS contents.

[^1]: [platforms/vitepress/src/Twoslash.ts](../../platforms/vitepress/src/Twoslash.ts)
