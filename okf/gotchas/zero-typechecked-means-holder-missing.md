---
type: Gotcha
title: "A build summary reporting 0 typechecked means the holder never ran, not that Twoslash found nothing"
description: The remark plugins run outside any fiber; binding the render pass to a ManagedRuntime instead of a module-level holder either throws AsyncFiberError or silently resolves a second, empty TwoslashEnvironments instance.
resource: ../../platforms/rspress/src/twoslash-access.ts
tags: [observability, dx]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 16ad1cce13276e1f1c55760e1c8513a2de08c43bf58f1e9716af750602accb1c
status: stable
---

# A build summary reporting 0 typechecked means the holder never ran, not that Twoslash found nothing

## What you see

The build finishes successfully. The summary line reports zero code blocks
type-checked — or every hover on the site reads back plain text with no
type information and no error is logged anywhere.

## What you will wrongly conclude

That there were genuinely no type-checkable code blocks in the build, or
that Twoslash silently declined to check anything it should have.

## What is actually true

RSPress's remark plugins run during the render pass, which happens outside
any Effect fiber — `config()` has already returned. `twoslash-access.ts`[^1]
exists because the two runtime-bound alternatives both fail silently:

1. Binding the render pass's accessor to the main `ManagedRuntime` and
   calling `runSync` against it dies with `AsyncFiberError`, because the
   main runtime's layer opens two SQLite databases at construction and is
   therefore asynchronous to build — `runSync` builds the layer first.
2. Moving the service to the small, synchronously-buildable runtime does
   not help either: layer memoization is per-`ManagedRuntime` `MemoMap`,
   not global, so one layer reference across two runtimes builds two
   separate instances. `ConfigService.layer` populates one registry; the
   render pass would read a different, empty one. `transformerFor` then
   returns `null` for every block, and every code block renders
   untype-checked with nothing failing.

Both failure modes are silent at the site-build level; the `0 typechecked`
summary line (or hovers with no type info at all) is the only tell.

## What to do

The render pass must read through `installTwoslashAccess(environments)`[^1],
called from inside a fiber by `plugin.ts`'s Effect program — never bound to
either `ManagedRuntime`. If a build reports `0 typechecked` or hovers carry
no type information, check first whether `installTwoslashAccess` actually
ran before the render pass started, and whether `clearTwoslashAccess()` was
called at the start of the build (it must be, beside `VfsRegistry.clear()`,
so a dev HMR session does not hand the render pass transformers built
against stale declarations).

[^1]: [platforms/rspress/src/twoslash-access.ts](../../platforms/rspress/src/twoslash-access.ts)
