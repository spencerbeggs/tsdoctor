---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 92
related:
  - rspress-plugin-api-extractor/effect-service-layer.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
  - rspress-plugin-api-extractor/build-progress-and-issues.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
---

# Snapshot tracking system

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Service and layer](#service-and-layer)
- [Data flow](#data-flow)
- [Change detection](#change-detection)
- [Timestamp management](#timestamp-management)
- [Hash calculation](#hash-calculation)
- [Disk fallback](#disk-fallback)
- [Stale and orphan cleanup](#stale-and-orphan-cleanup)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

The snapshot system gives the RSPress adapter incremental builds by tracking file state across builds in a SQLite database. It decides which generated files are new, modified or unchanged, skips writes for unchanged files to preserve RSPress's cache and avoid spurious git changes, and preserves the `article:published_time` / `article:modified_time` timestamps that feed the Open Graph tags. It lives in the framework-neutral package `@tsdoctor/snapshot` (`packages/snapshot`), consumed by the adapter via `workspace:*`; the VitePress adapter does not wire it yet.

## Current state

| Concern | Where it lives |
| --- | --- |
| Tag, shape, `SnapshotService.layer(dbPath)`, `makeTest` / `layerTest` | `packages/snapshot/src/SnapshotService.ts` |
| Content and frontmatter hashing | `packages/snapshot/src/content-hash.ts` |
| Change detection and timestamps | `platforms/rspress/src/build-stages.ts` (`generateSinglePage`, `writeMetadata`) |
| Snapshot loading and cleanup orchestration | `platforms/rspress/src/build-program.ts`, `build-stages.ts` (`cleanupAndCommit`) |
| The database path and directory | `platforms/rspress/src/plugin.ts` (`<cwd>/.api-docs/snapshot/api-docs.db`) |

## Service and layer

`SnapshotService` is a `Context.Service` whose shape covers single and bulk lookup, upsert, batch upsert, delete and stale cleanup — see the shape in `SnapshotService.ts`. The standalone `hashContent` export is what the build stages import; it is not on the shape because it is non-effectful and would force every double to supply it.

`SnapshotService.layer(dbPath)` is built on `@effected/store`'s `Store.layerSqlite` with `checkpointOnClose: true`: layer construction opens the database (WAL on by default) and applies the migration list before the service is available, and the WAL checkpoint is registered as a scope finalizer inside `@effected/store`. Queries and the transactional batch upsert run through `store.client`, the full `effect/unstable/sql` tagged-template client. The layer is a parameterized factory — call it once per database path and bind the result to a `const`, since layers memoize by reference. The parent directory of `dbPath` must exist; `plugin.ts` creates it before building the stack.

The error channel stays `StoreError | StoreMigrationError` all the way out to the application layer, deliberately: a snapshot database that cannot be opened or migrated stops the build loudly rather than silently regenerating every page. The adapter's cache-backed layers degrade; this one does not (`effect-service-layer.md`).

`makeTest` / `layerTest` describe a build with no prior snapshot — every lookup misses, every write is accepted and discarded — which is the state a first build or a fresh clone is in. `cleanupStale` defaults to reporting nothing stale rather than echoing its input, because a double that claimed files were stale would have the caller delete them from disk.

Store's migration ledger differs from the one an earlier `effect/unstable/sql` Migrator kept, so a database committed before the Store-backed layer gets migration 1 re-applied on its first run. That is harmless — the SQL is `CREATE TABLE IF NOT EXISTS` — and there is no migration 2 yet.

An inert plugin never opens the database: SQLite opens the file only when the `ManagedRuntime` is built, and the inert path never builds it. `plugin.ts` still creates the empty `snapshot/` directory, because a stray sync emitter can force the runtime to build after all.

## Data flow

```text
plugin.ts
  +-> SnapshotService.layer(dbPath) in the CoreLayer tier (makeAppLayers)
  +-> ManagedRuntime.make(appLayers.app)   -- opens the DB, applies migrations

build-program.ts
  +-> snapshotSvc.getAllForDirectory(outputDir) -> Map for O(1) lookup
  +-> Stream pipeline (build-stages.ts)
  |     generateSinglePage: compare hashes against the Map (disk fallback on miss)
  |     writeSingleFile:    skip unchanged, track metrics
  +-> writeMetadata:        snapshot-tracked _meta.json and index writes
  +-> cleanupAndCommit:     batchUpsert changed snapshots, cleanupStale,
                            orphan deletion, empty-directory sweep
```

## Change detection

`generateSinglePage` builds the page, parses the frontmatter off the body, spacing-normalizes and hashes the body, then builds the page's head tags, assembles the final frontmatter and hashes that (`page-generation-system.md`). The decision:

| Snapshot exists? | Hashes match? | Result |
| --- | --- | --- |
| Yes | Yes | Unchanged — preserve timestamps, skip the write |
| Yes | No | Modified — preserve `publishedTime`, update `modifiedTime` |
| No | — | Disk fallback |

`_meta.json` files use the same hash-based detection, with the existing file re-serialized through `JSON.stringify(data, null, "\t")` before comparison so a formatting difference does not count as a change.

## Timestamp management

| Scenario | published_time | modified_time |
| --- | --- | --- |
| New file | build time | build time |
| Unchanged | from snapshot or disk | from snapshot or disk |
| Modified | from snapshot or disk | build time |

Navigation metadata files use a fixed timestamp since they have no semantic publication date.

## Hash calculation

`content-hash.ts` exports `normalizeContent` (line endings to `\n`, trimmed, triple-plus blank lines collapsed), `hashContent` (SHA-256 of the normalized body) and `hashFrontmatter`.

`hashFrontmatter` strips every timestamp and canonicalizes the rest through `@effected/jsonc`'s `JsoncFingerprint` (RFC 8785 / JCS) — the same spelling `@tsdoctor/bundle` fingerprints through. `JSON.stringify` is not a canonical form: it drops `undefined`, turns `NaN` into `null` and escapes differently, so a value it silently altered would have been hashed as something the document did not say. A value that cannot be canonicalized fails loudly.

Timestamps are stripped recursively, in three shapes: the top-level `publishedTime` / `modifiedTime` / `article:*` fields; the meta-pair form nested in `head` (a `content` value whose sibling `property` or `name` names a timestamp key); and the `datePublished` / `dateModified` / `uploadDate` keys inside a parsed JSON-LD `<script>` body, re-serialized after removal. A body that does not parse is hashed unchanged. The walk must be recursive because `head` is an array of `[tagName, attrs]` pairs, so a shallow pass sees nothing.

If timestamps were hashed, every build would produce a different hash because `modifiedTime` would be the current build time. The recursive stripping is also what makes the generate stage's two calls to `finalFrontmatter` — one with the build time to hash, one with the resolved timestamps to write — hash identically. `head` is hashed in full; it used to be excluded wholesale, which made every `og:image`, canonical and JSON-LD change invisible to change detection until head-tag construction moved into the generate stage (`structured-data-and-og.md`). The acceptance evidence for that fix was a rebuild count, not a unit assertion: a unit test can pass forever on an input no caller produces. Both directions are pinned in `platforms/rspress/__test__/build-stages.test.ts` — a head-tag change must move the hash and the build time must not.

## Disk fallback

When no snapshot exists for a file (first clone, DB deleted, CI), the stage reads the existing file through the core `effect` FileSystem, parses and normalizes it the same way and compares both hashes. On a match the existing file's timestamps are preserved and the file is treated as unchanged, so a build after a fresh clone does not modify unchanged files and SEO timestamps survive across environments. See the fallback block in `generateSinglePage`.

## Stale and orphan cleanup

`cleanupAndCommit` first batch-upserts the snapshots whose status is not `unchanged`, in one transaction (the SQL's conditional `ON CONFLICT … DO UPDATE … WHERE` avoids rewriting unchanged rows even within the batch). It then removes stale files — tracked in the database but not generated this build — from both the database and disk, and orphan files — `.mdx` or `_meta.json` on disk that no snapshot tracks. Finally it sweeps directories left empty: seeded from both deletion lists (stale files are deleted before the orphan scan reads the tree, so a sweep seeded only from orphan parents never saw them), collecting the full ancestor chain of each removed file, never touching the output root, deepest first, each candidate verified empty via `readDirectory` and removed with `{ recursive: true }` because a plain `remove` fails on directories. Each removal emits `EmptyDirRemoved` at `trace` level.

File statistics are Effect Metrics counters (`files.total`, `files.new`, `files.modified`, `files.unchanged`), read at build end by `logBuildSummary` (`performance-observability.md`).

## Rationale

- **Why a separate package on `@effected/store`:** the snapshot DB is the durable per-page metadata store every adapter will need and no adapter should own; `Store.layerSqlite` supplies the same SQLite client the hand-wired stack used, plus migrations, rollback and typed errors, and a build-end commit can upsert snapshots and any future fingerprint table in one transaction.
- **Why content hashing rather than mtimes:** mtimes change on every write and every clone; content hashes let a fresh clone recognise unchanged output.
- **Why the store is fatal and the caches are not:** a cache miss costs time; a silently regenerated snapshot corrupts the timestamps a crawler reads as authoritative.

## Related documentation

- **Service layer and the fatal-versus-degrading posture:** `effect-service-layer.md`
- **The pipeline stages that consume snapshots:** `page-generation-system.md`
- **The head tags the frontmatter hash covers:** `structured-data-and-og.md`
- **The `.api-docs/` directory and the gitignore story:** `build-progress-and-issues.md`
- **The `@effected/store` adoption decision:** `tsdoctor-package-architecture.md`
