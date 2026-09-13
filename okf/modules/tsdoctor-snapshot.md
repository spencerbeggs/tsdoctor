---
type: Module
kind: package
title: "@tsdoctor/snapshot"
description: Incremental-build snapshot store and content-hashing helpers for static documentation pipelines.
resource: ../../packages/snapshot
layer: L2
generated:
  by: "okfit/claude-code"
  at: 2026-09-13T14:07:05Z
  body_sha256: febb0b8790e6c5566a7a4f09c1b3717e1ccda9fe7bf045c321fd10f2a02f6e83
tags:
  - architecture
  - observability
  - performance
---

# @tsdoctor/snapshot

## Boundary and purpose

`@tsdoctor/snapshot` is the incremental-build snapshot store for static
documentation pipelines: a schema-versioned SQLite store of per-file content
hashes and timestamps, plus the pure SHA-256 content-hashing helpers that feed
it. It decides, for a generated file, whether the bytes actually changed since
the last build, and it is what lets `article:published_time` /
`article:modified_time` survive across builds instead of being reset to "now"
on every run.

The package owns the database and the hashing; it does not decide what to
write or when — that orchestration lives in the consuming adapter's pipeline
stages. See [rspress-plugin-api-extractor](rspress-plugin-api-extractor.md)
§Page pipeline for the only current caller.

## Dependencies

- `effect` (peer, `catalog:effect`)
- `@effected/store` (peer, `catalog:effected`) — `Store.layerSqlite`, the
  `Cache` primitive family
- `@effected/jsonc` (peer, `catalog:effected:peers`) — `JsoncFingerprint`
  (RFC 8785 / JCS canonicalization) for `hashFrontmatter`

No framework dependency, no filesystem beyond what `Store.layerSqlite` opens
directly. `packages/snapshot/package.json` declares no `dependencies` at all —
only `devDependencies` and `peerDependencies` — so nothing reaches this
package that is not also declared by the consumer.

## Public surface

`src/index.ts` re-exports two modules:

- `src/SnapshotService.ts` — `SnapshotService`, a `Context.Service` tag (id
  `"@tsdoctor/snapshot/SnapshotService"`), its shape
  (`SnapshotServiceShape`), the `FileSnapshot` record, the `SnapshotDbError`
  tagged error, `SnapshotService.layer(dbPath)`, and the in-memory test
  doubles `SnapshotService.makeTest(overrides)` / `layerTest(overrides)`.
- `src/content-hash.ts` — the pure functions `hashContent`, `hashFrontmatter`,
  `normalizeContent`.

`hashContent` is a standalone export, not a method on `SnapshotServiceShape`:
it never had a consumer in method form, and a caller that already imports the
service tag still imports the hasher from the same barrel.

## Mechanisms

### Service and layer

`SnapshotService.layer(dbPath)` builds on `@effected/store`'s
`Store.layerSqlite({ filename, migrations, checkpointOnClose: true })`.
Migration 1 is the former hand-written `001_create_snapshots` SQL statement,
applied once at layer construction, before the service is available to any
caller. `checkpointOnClose: true` registers the WAL checkpoint as a scope
finalizer inside `@effected/store` itself — there is no hand-written
finalizer in this package. The layer is a parameterized factory: call it once
per database path and bind the result to a `const`, since layers memoize by
reference and a second call opens a second connection to the same file.

Every query and the transactional batch upsert runs through `store.client`,
the full `effect/unstable/sql` `SqlClient`, not a hand-rolled query builder.
The layer's error channel carries Store's typed `StoreError |
StoreMigrationError` — a snapshot database that cannot be opened or migrated
fails the layer construction rather than degrading silently. A consumer
that wants a cache to degrade instead (an unreachable Twoslash result cache,
for instance) makes that choice in its own layer; this package does not
offer a degrading mode, because a silently regenerated snapshot corrupts the
timestamps a crawler reads as authoritative.

### Test doubles

`SnapshotService.makeTest(overrides)` / `layerTest(overrides)` describe a
build with no prior snapshot: every lookup misses, every write is accepted
and discarded, and `cleanupStale` reports nothing stale by default — a double
that claimed files were stale would have the caller delete them from disk. A
test overrides only the member it exercises.

### Content hashing

`hashContent` takes the normalized body through SHA-256. `normalizeContent`
collapses line endings to `\n`, trims, and collapses runs of three or more
blank lines, so a formatting difference that carries no semantic change does
not register as a content change.

`hashFrontmatter` hashes the full assembled frontmatter object — including
the `head` key — after stripping every timestamp recursively: top-level
`publishedTime` / `modifiedTime` / `article:*` fields; the `[tagName,
attrs]` meta-pair form nested inside `head` (a `content` value whose sibling
`property` or `name` names a timestamp key); and `datePublished` /
`dateModified` / `uploadDate` inside a parsed JSON-LD `<script>` body,
re-serialized after removal. The walk must stay recursive because `head` is
an array of pairs — a shallow pass sees nothing — and the stripping must stay
total, because the caller hashes the same frontmatter object twice with
different timestamps: once to compare against the stored hash, once to
write. Hashing `head` at all is a correction: it used to be excluded
wholesale, which made every Open Graph image, canonical link and JSON-LD
change invisible to change detection.

Canonicalization runs through `@effected/jsonc`'s `JsoncFingerprint`
(RFC 8785 / JCS), the same spelling `@tsdoctor/bundle` fingerprints through
— never `JSON.stringify` plus a hand-rolled key sort. `JSON.stringify` is not
a canonical form: it silently drops `undefined`, turns `NaN` into `null`,
and escapes differently, so a value it altered would be hashed as something
the document did not actually say. A value that cannot be canonicalized
throws rather than hashing a lie.

### Migration-ledger caveat

`@effected/store`'s migration ledger differs from the one an earlier
hand-wired `effect/unstable/sql` Migrator kept, so a database committed
before the Store-backed layer re-applies migration 1 on its first run under
the new layer. This is harmless because the migration's SQL is `CREATE TABLE
IF NOT EXISTS`; there is no migration 2 defined in this package today.

## Invariants

- `SnapshotService.layer(dbPath)` must be called exactly once per database
  path per process and the result bound to a `const` — calling it twice mints
  two layers against the same file.
- `hashFrontmatter`'s timestamp stripping must stay recursive and total: the
  frontmatter object passed to hash and the frontmatter object written to
  disk differ only in their timestamp values, and the hash must agree on both
  calls for change detection to mean anything.
- The layer's `StoreError | StoreMigrationError` channel must not be caught
  and discarded by a consumer — a corrupt or unreachable snapshot database is
  meant to stop the build loudly, not fall back to regenerating everything
  unnoticed.
- `hashContent` / `hashFrontmatter` / `normalizeContent` are pure and
  synchronous; nothing in `content-hash.ts` performs I/O.

## Links

- [caches-degrade-snapshot-store-fails](../decisions/caches-degrade-snapshot-store-fails.md)
- [content-hashing-over-mtimes](../decisions/content-hashing-over-mtimes.md)
- [snapshot-database](../models/snapshot-database.md) — table shape, the
  change-detection decision table and the build-end cleanup flow
- [effected-is-the-foundation](../conventions/effected-is-the-foundation.md)
- [services-own-their-layers](../conventions/services-own-their-layers.md)
