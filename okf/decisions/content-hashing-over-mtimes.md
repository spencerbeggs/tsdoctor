---
type: Decision
status: draft
title: Content hashing over mtimes
description: The snapshot system compares canonical content hashes, not filesystem mtimes, to decide whether a generated page changed.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: f723b778e1bb5e26830bf2c4b7d6d02e6f723b9319300dbb6e26f62c8b696516
tags: [architecture, performance]
sources:
  - id: content-hash
    resource: ../../packages/snapshot/src/content-hash.ts
  - id: build-stages
    resource: ../../platforms/rspress/src/build-stages.ts
---

# Content hashing over mtimes

## Context

The RSPress adapter's incremental build needs to decide, per generated file, whether the new content differs from what is on disk (or in the snapshot database) so it can skip rewriting unchanged files and preserve the `article:published_time` / `article:modified_time` timestamps a crawler reads as authoritative. Rewriting an unchanged file busts RSPress's own build cache and shows up as a spurious diff in git even when nothing meaningful changed.

## Decision

Compare SHA-256 content hashes, not filesystem mtimes. `hashContent` (`../../packages/snapshot/src/content-hash.ts`) hashes the spacing-normalized page body — `normalizeContent` converts line endings to `\n`, trims, and collapses runs of three or more newlines to one blank line before hashing, so a formatting difference that carries no semantic change does not count as a change. A second hash, `hashFrontmatter`, covers the assembled frontmatter with every timestamp stripped recursively (`packages/snapshot/src/content-hash.ts:64-100` and onward): top-level `publishedTime` / `modifiedTime` / `article:*` fields, the meta-pair form nested in a `head` array, and `datePublished` / `dateModified` / `uploadDate` inside a parsed JSON-LD `<script>` body. Frontmatter is canonicalized through `@effected/jsonc`'s `JsoncFingerprint` (RFC 8785 / JCS) before hashing, not `JSON.stringify`.

When both hashes match what the snapshot (or, absent a snapshot, the file on disk) recorded, the build skips the write entirely and preserves the existing timestamps; when the snapshot is missing — a fresh clone, a deleted database, CI — the stage falls back to reading and hashing the file already on disk before deciding, so a rebuild right after a clean clone modifies nothing. `platforms/rspress/src/build-stages.ts` is where `generateSinglePage` runs this comparison and resolves the timestamp table (new file: build time for both; unchanged: carry both from the snapshot or disk; modified: carry `publishedTime`, bump `modifiedTime` to build time).

## Alternatives rejected

- **Filesystem mtimes.** An mtime changes on every write and on every fresh clone regardless of content, so it cannot distinguish "this file changed" from "this file was merely re-materialized" — exactly the two cases the snapshot system exists to tell apart.
- **`JSON.stringify` for the frontmatter hash.** It drops `undefined` keys, turns `NaN` into `null`, and escapes strings differently across engine versions, so it is not a canonical form: a value it silently altered would be hashed as something the document did not actually say. `JsoncFingerprint`'s RFC 8785 canonicalization is deterministic across those cases and fails loudly on a value it cannot canonicalize instead of guessing.

## Consequences

- Every timestamp must be recursively identified and stripped before hashing, including inside a JSON-LD script body re-serialized after removal — a body that does not parse as JSON is hashed unchanged rather than dropped.
- The disk-fallback path duplicates part of the snapshot comparison (read, normalize, hash, compare) so a clean-clone rebuild is content-driven rather than snapshot-driven, at the cost of one extra file read per page when no snapshot exists.
- Because the frontmatter hash covers the full `head` array, any change to a head tag (an `og:image`, a canonical URL, JSON-LD) moves the hash and forces a rewrite — head-tag construction has to happen before the hash is taken, not after, or the hash silently stops covering what actually changed.
