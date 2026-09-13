---
type: Decision
status: draft
title: Extract the page IR only once two adapters exist
description: "@tsdoctor/pages was lifted from the RSPress generators with the VitePress adapter as its second live consumer, validated by a byte-identity gate rather than designed up front."
tags: [architecture, testing]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: eddb91cb3b8dbe56df8856a2c428fe51adb81c1f34b0dc5a7d8191e950bd4102
---

# Extract the page IR only once two adapters exist

## Context

What a generated API documentation page contains — its blocks, its
navigation entry, its head-tag facts — used to be decided entirely inside
the RSPress adapter's own page generator classes. Extracting that
knowledge into a framework-neutral package before a second framework
adapter existed to consume it would have meant designing the shape
against a hypothetical consumer, which tends to calcify decisions that
turn out wrong the moment a real second consumer arrives.

## Decision

`@tsdoctor/pages` was extracted with two live consumers rather than
designed up front: the RSPress adapter's existing generator behavior, and
the new `platforms/vitepress/` adapter being built at the same time. A
page is a set of facts, an ordered list of typed doc blocks and a
navigation entry; each adapter is an emitter that spends the IR in its own
framework's dialect (RSPress: MDX with JSX components; VitePress: plain
markdown with Twoslash-annotated fences).

The RSPress switch from its own generator classes to consuming the IR ran
behind a byte-identity gate: byte-identical generated output for every
fixture site, captured before the switch and diffed after, plus a
snapshot rebuild count — a rebuild over the IR had to report every file
unchanged, and a subsequent no-change rebuild had to stay byte-identical[^1].
The captured golden files were a one-time comparison, never committed to
the repository, because pinning hundreds of MDX files per fixture site as
a permanent corpus is not something anyone would maintain; the durable
coverage that survives is the emitter's own test suite
(`platforms/rspress/__test__/emit/`) plus the snapshot rebuild check.

The gate held with exactly one labelled deviation, and that deviation was
a real bug the lift fixed rather than a parity failure: the old generators
linked prose through a module-level `CrossLinker` holder swapped per API
while `generateApiDocs` ran concurrently across APIs, so a multi-API build
could link one API's prose against another API's route map. The IR
builder instead takes the `CrossLinker` per API through the pipeline
context as a value, making the linking deterministic under concurrency.

Prettier formatting for example code lives inside `@tsdoctor/pages`
itself, not in either adapter, because it is CPU-bound and I/O-free and
both adapters must format examples identically or the llms.txt output
they each produce would diverge between frameworks[^2].

Any capability gap the IR needs from its markdown substrate is closed by
expanding `@effected/markdown`, the kit both `@tsdoctor/pages` and the
model's TSDoc extraction build on — never by writing a local mdast helper
inside the pages package or either adapter.

## Alternatives rejected

- **Design the IR up front, before the VitePress adapter existed.**
  Rejected: an abstraction designed for one real consumer and one
  hypothetical one is shaped by the real consumer's accidents, which is
  the same outcome as not extracting at all — the extraction only earns
  its cost once a second real consumer exists to pressure-test the shape.
- **Validate the RSPress switch by unit tests over the IR alone.**
  Rejected as sufficient on its own: a unit test can pass forever on an
  input no caller actually produces. The byte-identity diff plus the
  snapshot rebuild count were required because they exercise the real
  pipeline, which is what caught the concurrent-API prose-linking bug a
  unit-level comparison would not have exposed.
- **Commit the captured golden MDX files as a permanent fixture corpus.**
  Rejected: two hundred MDX files per fixture site to pin one refactor is
  a corpus nobody would keep current; the emitter tests and the rebuild
  check are the durable substitute.
- **Format examples separately in each adapter.** Rejected: two Prettier
  call sites are two chances for the RSPress and VitePress llms.txt output
  of the same example to differ byte for byte.

## Consequences

- A future third adapter inherits `@tsdoctor/pages` as a proven boundary
  rather than a speculative one, since it was pressure-tested by a real
  second consumer before this decision was recorded.
- Any change to `@tsdoctor/pages`'s block vocabulary or builders is
  expected to be checked against both adapters' emitter test suites, not
  just one.
- The concurrent-API prose-linking fix means neither adapter may
  reintroduce a module-level "current linker" holder; the `CrossLinker`
  must keep arriving as a per-API value through the pipeline context.

[^1]: [platforms/rspress/**test**/emit](../../platforms/rspress/__test__/emit)
[^2]: [packages/pages/package.json](../../packages/pages/package.json)
