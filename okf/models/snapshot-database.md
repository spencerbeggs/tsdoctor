---
type: DataModel
title: Snapshot database
description: The SQLite store of per-file content hashes and timestamps that drives incremental doc builds.
resource: ../../packages/snapshot/src/SnapshotService.ts
tags: [architecture, performance]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 73f62fc38c7f025e7984499c4c9b90906bc984b79f0e7881d9af6a1be73b47aa
sources:
  - id: snapshot-service-src
    resource: ../../packages/snapshot/src/SnapshotService.ts
  - id: content-hash-src
    resource: ../../packages/snapshot/src/content-hash.ts
status: stable
---

# Snapshot database

`SnapshotService.layer(dbPath)` opens a SQLite database at
`<cwd>/.api-docs/snapshot/api-docs.db` (WAL mode, `checkpointOnClose: true`)
through `@effected/store`'s `Store.layerSqlite`, applying migration `001`
at layer construction.[^snapshot-service-src] This is the maintainer's-side
record of one entry: what it contains, what a build derives from it, and
what a wrong entry breaks.

## Schema

One `file_snapshots` row per generated file, unique on
`(output_dir, file_path)`:[^snapshot-service-src]

```sql
CREATE TABLE IF NOT EXISTS file_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  output_dir TEXT NOT NULL,
  file_path TEXT NOT NULL,
  published_time TEXT NOT NULL,
  modified_time TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  frontmatter_hash TEXT NOT NULL,
  build_time TEXT NOT NULL,
  UNIQUE(output_dir, file_path)
)
```

Migrations are append-only with ascending `id`s — never edit or reorder an
existing entry, only add the next one. Migration `001` is
`CREATE TABLE IF NOT EXISTS`, so a pre-existing database built under an
earlier, non-Store migration ledger re-applies it harmlessly on its first
run under the new ledger.[^snapshot-service-src]

## What an entry contains

- `contentHash` — SHA-256 of the file body, computed by `hashContent` after
  `normalizeContent` (CRLF/CR to `\n`, trimmed, runs of 3+ blank lines
  collapsed to one).[^content-hash-src]
- `frontmatterHash` — SHA-256 of the page's frontmatter, computed by
  `hashFrontmatter`, with the top-level `publishedTime` / `modifiedTime` /
  `article:published_time` / `article:modified_time` fields dropped and
  every remaining value recursively stripped of nested timestamps in three
  shapes: the top-level fields, the `[tagName, attrs]` meta-pair form
  nested in `head` (matched by a sibling `property`/`name` naming a
  timestamp key), and `datePublished` / `dateModified` / `uploadDate`
  inside a JSON-LD `<script>` body (parsed, stripped, re-serialized; a body
  that fails to parse is hashed unchanged). The walk is recursive because
  `head` is an array of pairs — a shallow pass sees nothing. The remaining
  object is canonicalized via `@effected/jsonc`'s `JsoncFingerprint`
  (RFC 8785 / JCS) before hashing, not `JSON.stringify` — `JSON.stringify`
  drops `undefined` and coerces `NaN` to `null` silently, so a value it
  altered would be hashed as something the document did not say. A value
  that cannot be canonicalized throws rather than hashing a lie.[^content-hash-src]
- `publishedTime` / `modifiedTime` — ISO timestamps a build resolves and
  preserves across incremental runs, and `buildTime` — the ISO timestamp
  of the build that last wrote the row.[^snapshot-service-src]

`_meta.json` files are compared the same way: the existing file is
re-serialized with `JSON.stringify(data, null, "\t")` before hashing, so a
formatting-only difference from a prior writer does not register as a
change.

## What derives from an entry

- **Write-or-skip decisions.** A page whose freshly computed `contentHash`
  and `frontmatterHash` both match the stored row is unchanged and its
  write is skipped; a mismatch on either hash is a modification.
- **`article:published_time` / `article:modified_time`.** An unchanged
  file preserves both timestamps from its snapshot (or, with no snapshot,
  from disk); a modified file preserves `publishedTime` and bumps
  `modifiedTime` to the current build time; a new file gets both set to
  the build time.
- **Stale and orphan deletion.** `cleanupStale(outputDir, currentFiles)`
  deletes every row for `outputDir` whose `file_path` is absent from
  `currentFiles`, and returns those paths so the caller deletes the
  corresponding files from disk.[^snapshot-service-src]
- **`files.*` build metrics** — total/new/modified/unchanged counters read
  from these write-or-skip decisions.

## What breaks if an entry is wrong

- **A stale row deletes a live file.** `cleanupStale` is trusted to name
  exactly the files no longer generated this build; the in-memory test
  double (`SnapshotService.makeTest`) therefore defaults `cleanupStale` to
  reporting **nothing** stale rather than echoing its input — a double that
  claimed files were stale would have the caller delete them from
  disk.[^snapshot-service-src]
- **A wrong `contentHash` or `frontmatterHash`** either rewrites every page
  on every build (a hash that never matches, e.g. from an unstable
  serialization) or, worse, silently treats a genuinely changed page as
  unchanged and never advances its `modifiedTime` — a crawler then reads a
  stale-but-confident timestamp as authoritative.
- **`upsert` and `batchUpsert` only write when at least one hash or
  timestamp column differs** (`WHERE published_time != … OR modified_time
  != … OR content_hash != … OR frontmatter_hash != …`), so an upsert with
  every field identical to the stored row is a no-op — this is what keeps
  a repeat build over unchanged content from touching the row's own
  `rowid` or write-ahead log.[^snapshot-service-src]

## Persistence and gitignore posture

This repo gitignores the whole `.api-docs/` directory. A consumer site that
wants cross-run idempotency instead commits `.api-docs/snapshot/` and
gitignores `.api-docs/build/` plus the `*.db-wal` / `*.db-shm` SQLite
sidecars — after a clean production shutdown (`checkpointOnClose: true`
folds the WAL back into the main file) the committed directory settles to
just `api-docs.db`.

[^snapshot-service-src]: `packages/snapshot/src/SnapshotService.ts`
[^content-hash-src]: `packages/snapshot/src/content-hash.ts`

See also [tsdoctor-snapshot module](../modules/tsdoctor-snapshot.md),
[content-hashing-over-mtimes decision](../decisions/content-hashing-over-mtimes.md)
and [head-tags-built-in-generate-stage decision](../decisions/head-tags-built-in-generate-stage.md).
