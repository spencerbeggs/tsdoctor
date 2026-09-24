---
type: Gotcha
title: A green hashing unit test can pin a shape the real pipeline never produces
description: A change-detection unit test for hashFrontmatter passed the whole time it was fixing the wrong stage, because it called the hasher with an input built by hand rather than the input the pipeline actually hands it.
resource: ../../platforms/rspress/__test__/build-stages.test.ts
tags: [testing]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 856e59aed87f7829ec9b621757843fdff405cfce45b8ad297e146ddbb5848499
status: stable
---

# A green hashing unit test can pin a shape the real pipeline never produces

## What you see

A unit test for content-hash change detection passes. `hashFrontmatter`
is called with a frontmatter object, asserted to strip timestamps
correctly, and the assertion is green before and after a fix lands.

## What you will wrongly conclude

That a passing hash unit test is evidence the change-detection fix works
against the real pipeline — that head-tag changes now move the snapshot
hash the way they should.

## What is actually true

Two things were wrong at once, and a green unit test hid both. First,
`head` was excluded from the hash outright. The fix for that landed on a
code path nothing in the real pipeline took: the hash was computed one
pipeline stage BEFORE head tags were built, so the hasher's input — the
frontmatter the test constructed by hand — was not a frontmatter object
any real page generation ever produces at that point in the pipeline. The
unit test stayed green through the entire episode because it called
`hashFrontmatter` directly with a hand-built object that happened to
already contain `head`, which no caller in the actual build did at the
time the hash ran.

`platforms/rspress/__test__/build-stages.test.ts`[^1] records the fix and
its verification: the acceptance evidence was not another unit assertion
but a REBUILD COUNT over the real pipeline — bump one input (a head-tag
value), count how many files the snapshot system actually rewrote. Both
directions are pinned there: a head-tag change must move the hash, and a
build timestamp alone must not.

## What to do

When fixing or extending change detection (or any hashing/snapshot logic),
do not trust a unit test that constructs its own input to the hasher in
isolation — it can pass forever on a shape no caller in the real pipeline
produces. Verify with a rebuild count over the actual generation stages:
change one real input, run the pipeline, and count what got rewritten.
Keep both directions pinned — the thing that should move the hash, and
the thing (a build timestamp) that must not.

[^1]: [platforms/rspress/__test__/build-stages.test.ts](../../platforms/rspress/__test__/build-stages.test.ts)
