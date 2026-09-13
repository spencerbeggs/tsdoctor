---
type: Decision
status: draft
title: Head tags are built in the generate stage
description: Head tags are assembled before the frontmatter hash is taken, not in the later write stage, so a head-tag change is visible to change detection.
tags: [architecture, testing]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 4d7f0ac3aa37b732354b40ffe730fb6798f0439e24ab5ec48800d5ad7ac245a1
---

# Head tags are built in the generate stage

## Context

The Stream pipeline that turns an `ApiItem` into a written MDX file
(`platforms/rspress/src/build-stages.ts`) computes a content hash of the page
body and a separate hash of the assembled frontmatter, and compares both
against the snapshot database to decide whether a file needs writing at all
(`@tsdoctor/snapshot`'s `hashContent` / `hashFrontmatter`,
`packages/snapshot/src/content-hash.ts`). The `<head>` block — canonical
link, Open Graph, Twitter card, JSON-LD — used to be assembled one stage
later, in the write stage, after the frontmatter hash had already been
taken. That meant a change to any head tag (a new Open Graph field, a
changed JSON-LD shape) was invisible to change detection: the hash covered
frontmatter without heads, the file was judged unchanged, and the stale
head tags were written back to disk unchanged forever.

## Decision

Build head tags inside `generateSinglePage`
(`platforms/rspress/src/build-stages.ts`), before the frontmatter hash is
taken, not in the later write stage. The stage resolves the Open Graph
image through `OgService`, derives the JSON-LD script body through
`@tsdoctor/seo`, and assembles the final frontmatter from them — then
hashes that assembled frontmatter with `hashFrontmatter`
(`packages/snapshot/src/content-hash.ts:166`). A local closure,
`finalFrontmatter(published, modified)` (`build-stages.ts:398`), is called
twice from the same stage: once with the build's current time to produce
the value that gets hashed, and once with the resolved published/modified
timestamps to produce the value that gets written. Calling it twice is
sound only because `hashFrontmatter` strips every timestamp recursively
before hashing — the top-level `publishedTime` / `modifiedTime` fields, any
`content` value in a `head` meta-pair whose sibling `property` or `name`
names a timestamp, and `datePublished` / `dateModified` / `uploadDate`
inside a parsed JSON-LD `<script>` body (`content-hash.ts:66-132`). Without
that stripping, the two calls would hash to different values purely
because one used the build time and the other the resolved time, and every
page would look "changed" on every build.

## Alternatives rejected

- **Leave head-tag assembly in the write stage and hash only the body.**
  This is what shipped originally and is the defect being fixed: it made
  every head-tag change invisible to the snapshot system, so a schema.org
  or Open Graph fix would never actually reach a previously-generated
  page on an incremental rebuild.
- **Hash frontmatter and head tags separately, comparing each
  independently.** Rejected because the write decision is binary — a page
  is either rewritten or it is not — and a second, parallel change-detection
  path doubles the surface for the two paths to disagree about whether a
  page changed.

## Consequences

- The frontmatter hash now genuinely covers what gets written, so a head-tag
  change is visible to the snapshot system on the very next build.
- `finalFrontmatter`'s double call depends on `hashFrontmatter`'s recursive
  timestamp stripping remaining correct; a regression there would silently
  reintroduce full rebuilds on every run (every page's hash would move) or
  the original defect (no page would ever pick up a head change), and
  neither failure mode produces an error — only a wrong rebuild count.
- The acceptance evidence for this class of fix is a rebuild count over the
  real pipeline, not a unit assertion: a unit test can pass forever on an
  input no caller produces. Both directions — a head-tag change moves the
  hash, and the build time alone does not — are pinned in
  `platforms/rspress/__test__/build-stages.test.ts`.
