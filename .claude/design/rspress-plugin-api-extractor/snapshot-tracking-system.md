---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-08-26
last-synced: 2026-08-26
completeness: 92
related:
  - rspress-plugin-api-extractor/build-architecture.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/performance-observability.md
  - rspress-plugin-api-extractor/bundle-spec.md
  - rspress-plugin-api-extractor/tsdoctor-package-architecture.md
  - rspress-plugin-api-extractor/structured-data-and-og.md
dependencies: []
---

# Snapshot Tracking System Design

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Database Schema](#database-schema)
- [Change Detection Algorithm](#change-detection-algorithm)
- [Timestamp Management](#timestamp-management)
- [Hash Calculation](#hash-calculation)
  - [Head Tags and the Frontmatter Hash](#head-tags-and-the-frontmatter-hash)
- [Disk Fallback Logic](#disk-fallback-logic)
- [Stale and Orphan Cleanup](#stale-and-orphan-cleanup)
- [Performance Considerations](#performance-considerations)

---

## Overview

The snapshot tracking system provides incremental build optimization for
the `rspress-plugin-api-extractor` by tracking file state across builds.
It detects which files are new, unchanged, or modified, skipping writes
for unchanged files to preserve RSPress's cache and avoid unnecessary
git changes.

As of phase 2 the system lives in its own framework-neutral package,
**`@tsdoctor/snapshot`** (`packages/snapshot`), consumed by the plugin via
`workspace:*`. The extraction carried over `SnapshotService`, its live layer, `content-hash.ts` and `SnapshotDbError`; the plugin dropped its direct `@effect/sql-sqlite-node` dependency and its `migrations/` directory. The live layer is rebuilt on `@effected/store`'s `Store.layerSqlite` (the adoption decision recorded in `tsdoctor-package-architecture.md`, taken against `@effected/store@0.4.0`;
`0.5.0` is the installed version as of 2026-08-25 and nothing in the port
changed with it).

### Key Features

- **Content-based change detection** using SHA-256 hashing
- **Timestamp preservation** for unchanged files (SEO-critical Open Graph
  meta tags)
- **Disk fallback** when snapshot database is missing (e.g., first clone)
- **Stale file cleanup** to remove files no longer in the API model
- **Orphan file cleanup** to remove untracked files from output directory
- **Effect service architecture** backed by `@effected/store`'s
  schema-versioned SQLite `Store` (`Store.layerSqlite`), with migrations
  applied at layer construction
- **Batch upserts** within transactions for write efficiency
- **Pre-loaded snapshot map** for O(1) lookup during build

---

## Architecture

### Effect Service Layer

The snapshot system uses Effect's service pattern, with the tag, the shape and the live layer co-located:

Both live in `packages/snapshot/src/SnapshotService.ts`: the tag is `class SnapshotService extends Context.Service<SnapshotService, SnapshotServiceShape>()("@tsdoctor/snapshot/SnapshotService")`, and the live layer is a static on it, `SnapshotService.layer(dbPath)`. The separate `SnapshotServiceLive.ts` module is deleted — the package now follows the same co-location the adapter's services do.

The `SnapshotServiceShape` defines methods:

- `getSnapshot(outputDir, filePath)` -- single snapshot lookup
- `getAllForDirectory(outputDir)` -- pre-load all snapshots
- `getFilePaths(outputDir)` -- list tracked paths
- `upsert(snapshot)` -- insert or update single snapshot
- `batchUpsert(snapshots)` -- transactional batch update
- `deleteSnapshot(outputDir, filePath)` -- remove single snapshot
- `cleanupStale(outputDir, currentFiles)` -- remove stale entries

`hashContent` is **not** on the shape. It had zero consumers in the method form, and being non-effectful it forced every test double to supply it; the standalone `hashContent` export from `@tsdoctor/snapshot` is unchanged and is what `build-stages.ts` imports.

`SnapshotService.layer(dbPath)` is built on `@effected/store`'s `Store.layerSqlite({ filename: dbPath, migrations, checkpointOnClose: true })`: layer construction opens the SQLite database (via the same `@effect/sql-sqlite-node` `SqliteClient` under the hood, WAL on by default) and applies the `StoreMigration` list before the service is available. Migration 1 is the former `001_create_snapshots` SQL, carried over verbatim. All queries and the transactional batch upsert run through `store.client` — the full `effect/unstable/sql` tagged-template `SqlClient`. The `checkpointOnClose: true` option registers the WAL checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`) as a scope finalizer **inside** `@effected/store` itself; the package's own hand-written `Effect.addFinalizer` for this was deleted once the option shipped (a dogfood expansion adopted from the effected round-1 kit wave — see `tsdoctor-package-architecture.md`). The layer's error channel carries Store's typed `StoreError | StoreMigrationError`. The hand-wired
`@effect/sql-sqlite-node` + `Migrator` stack this replaces is gone; in
exchange the package gains Store's `migrate`/`rollback(toId)`/`status`
surface.

`SnapshotService.layer` is a **parameterized factory** — call it once per database path and bind the result to a `const`, since layers memoize by reference and a fresh call at each provide site would open the database more than once. The parent directory of `dbPath` must already exist; `plugin.ts` `mkdirSync`s it before building the stack.

Its error channel stays `StoreError | StoreMigrationError` all the way out to `AppLayers.app`, deliberately. The adapter's two cache-backed layers degrade on a construction failure; this one does not — a snapshot database that cannot be opened or migrated should stop the build loudly rather than silently regenerate every page.

`SnapshotService.makeTest(overrides)` / `layerTest(overrides)` are the in-memory doubles. Defaults describe a build with **no prior snapshot** — every lookup misses, every write is accepted and discarded — which is the state a first build or a fresh clone is in and the state the disk-fallback path is written against. `cleanupStale` defaults to reporting nothing stale rather than echoing its input: a double that claimed files were stale would have the caller delete them from disk.

### Data Flow

```text
Plugin initialization (plugin.ts)
    |
    +-> SnapshotService.layer(dbPath)   [from @tsdoctor/snapshot]
    |   +-> Store.layerSqlite({ filename: dbPath, migrations })
    |   +-> migration 1 (former 001_create_snapshots) applied at construction
    |   +-> WAL checkpoint registered as scope finalizer (checkpointOnClose: true)
    |
    +-> Composed into the CoreLayer tier by makeAppLayers (layers/AppLayer.ts)
    +-> ManagedRuntime.make(appLayers.app)

Build execution (build-program.ts)
    |
    +-> yield* snapshotSvc.getAllForDirectory(resolvedOutputDir)
    |   -> Pre-loads ALL snapshots into Map for O(1) lookup
    |
    +-> Stream pipeline (build-stages.ts):
    |   +-> generateSinglePage: compare hashes against Map
    |   +-> writeSingleFile: skip write for unchanged, track metrics
    |
    +-> writeMetadata: snapshot-tracked writes for _meta.json
    |
    +-> cleanupAndCommit:
        +-> batchUpsert: changed snapshots in single transaction
        +-> cleanupStale: delete DB rows for files not in build
        +-> orphan cleanup: delete disk files not in generatedFiles
```

### File Locations

| File | Purpose |
| --- | --- |
| `packages/snapshot/src/SnapshotService.ts` | Tag, interface, `SnapshotService.layer(dbPath)` (`Store.layerSqlite`, migrations inline) and the `makeTest`/`layerTest` doubles |
| `packages/snapshot/src/content-hash.ts` | SHA-256 hashing functions (pure, standalone) |
| `platforms/rspress/src/build-stages.ts` | Change detection in `generateSinglePage` (imports `SnapshotService`, `hashContent`, `hashFrontmatter` from `@tsdoctor/snapshot`) |
| `platforms/rspress/src/build-program.ts` | Orchestrates snapshot loading and cleanup |

---

## Database Schema

### Migration: 001_create_snapshots

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
);

CREATE INDEX IF NOT EXISTS idx_output_dir
    ON file_snapshots(output_dir);
CREATE INDEX IF NOT EXISTS idx_file_path
    ON file_snapshots(file_path);
```

Migrations are `StoreMigration` entries applied by `@effected/store` at
layer construction:

```typescript
const migrations: ReadonlyArray<StoreMigration> = [
  { id: 1, /* the former 001_create_snapshots SQL, verbatim */ },
];
const StoreLive = Store.layerSqlite({ filename: dbPath, migrations });
```

**Migration-ledger caveat:** Store's ledger table (`_store_migrations`)
differs from the ledger the previous `effect/unstable/sql` `Migrator` kept,
so a pre-existing committed `api-docs.db` gets migration 1 re-applied on
its first Store-backed run. This is harmless — the SQL is
`CREATE TABLE IF NOT EXISTS` — and the switch happened at the phase-2
boundary, before any migration 2 exists, which is the safe window.

### WAL Lifecycle

The SQLite connection uses WAL mode (Store's SQLite backing has WAL on by
default). `SnapshotService.layer` passes `checkpointOnClose: true` to
`Store.layerSqlite`, which registers the WAL-checkpoint scope finalizer
(`PRAGMA wal_checkpoint(TRUNCATE)`) **inside `@effected/store`** on close —
the package no longer hand-writes this finalizer itself. `(c)` (passing
through `SqliteClient.layer` options) and `(d)` (a `checkpointOnClose`
option) were dogfood-expansion candidates raised against `@effected/store`
during phase 2 (see `tsdoctor-package-architecture.md`); both shipped
upstream and this package adopted `checkpointOnClose: true` as soon as the
released kit wave carried them.

In production builds, the runtime is disposed in `afterBuild`, triggering
the checkpoint. In dev mode, the runtime stays alive for HMR rebuilds.

### Inert builds never open the database

`SnapshotService.layer(dbPath)` is composed into the layer stack unconditionally, but SQLite only opens the file when the `ManagedRuntime` is actually built. An inert plugin (`api: null`, `apis: null` or `apis: []` — see the inert configuration section of `build-architecture.md`) never runs the doc generation program, so no runtime is built and no `api-docs.db` appears. `plugin.ts` still creates the empty `<cwd>/.api-docs/snapshot/` directory on that path, deliberately: a stray sync emitter (a deprecation warning, a user-authored `with-api` code block) can force the runtime to build after all, and SQLite's eager open would fail without the parent directory.

---

## Change Detection Algorithm

### Pre-Loading Snapshots

All snapshots for the output directory are loaded at build start:

```typescript
const allSnapshots = yield* snapshotSvc
  .getAllForDirectory(resolvedOutputDir).pipe(Effect.orDie);
const existingSnapshots = new Map(
  allSnapshots.map((s) => [s.filePath, s])
);
```

This reduces database round-trips from N (one per file) to 1.

### MDX File Change Detection

In `generateSinglePage` (build-stages.ts):

1. Generate page content via the appropriate page generator
2. Parse with `parseFrontmatter` (`platforms/rspress/src/frontmatter.ts`, a
   gray-matter-parity split over `@effected/yaml` — see
   `page-generation-system.md`) to separate frontmatter and body
3. Normalize markdown spacing (`normalizeMarkdownSpacing`)
4. Hash body: `hashContent(bodyContent)`
5. **Build the page's SEO head tags** — resolve the OG image, derive the
   JSON-LD, call `@tsdoctor/seo`'s `headTags` — and assemble the FINAL
   frontmatter from them
6. Hash frontmatter: `hashFrontmatter(finalFrontmatterData)`
7. Look up snapshot: `existingSnapshots.get(relativePathWithExt)`

Step 5 lives in the generate stage precisely so step 6 can see it; it used to
live in `writeSingleFile`, which made every head tag invisible to change
detection. See [Head Tags and the Frontmatter Hash](#head-tags-and-the-frontmatter-hash).

**Decision tree:**

| Snapshot exists? | Hashes match? | Result |
| --- | --- | --- |
| Yes | Yes | UNCHANGED -- preserve timestamps, skip write |
| Yes | No | MODIFIED -- preserve publishedTime, update modifiedTime |
| No | (disk fallback) | See [Disk Fallback Logic](#disk-fallback-logic) |

### _meta.json Change Detection

In `writeMetadata`, navigation metadata files use the same hash-based
detection with JSON normalization for disk fallback:

```typescript
const existingData = JSON.parse(existingContent);
const normalizedExisting = JSON.stringify(existingData, null, "\t");
if (normalizedExisting === content) { /* unchanged */ }
```

---

## Timestamp Management

### Open Graph Meta Tags

Each generated MDX file includes timestamps as Open Graph meta tags:

```yaml
head:
  - - meta
    - property: "article:published_time"
      content: "2024-01-15T12:00:00.000Z"
  - - meta
    - property: "article:modified_time"
      content: "2024-01-15T12:00:00.000Z"
```

### Preservation Rules

| Scenario | published_time | modified_time |
| --- | --- | --- |
| **New file** | Current build time | Current build time |
| **Unchanged** | From snapshot/disk | From snapshot/disk |
| **Modified** | From snapshot/disk | Current build time |

### _meta.json Fixed Timestamps

Navigation metadata files use a fixed timestamp
(`"2024-01-01T00:00:00.000Z"`) since they have no semantic publication
date.

---

## Hash Calculation

### Location: `packages/snapshot/src/content-hash.ts`

Pure standalone functions, exported from `@tsdoctor/snapshot`:

**`normalizeContent(content)`** -- Prepare content for consistent hashing:

- Convert line endings to `\n`
- Trim leading/trailing whitespace
- Collapse triple+ blank lines to single blank line

**`hashContent(content)`** -- SHA-256 of normalized markdown body.

**`hashFrontmatter(frontmatter)`** -- SHA-256 of frontmatter with every
timestamp stripped and everything else retained. Keys are sorted
alphabetically for deterministic output.

Timestamps are stripped in two shapes, **recursively**:

- Top-level fields: `publishedTime`, `modifiedTime`, `article:published_time`,
  `article:modified_time`.
- Nested in `head`, in the meta-pair form — a `content` value whose sibling
  `property`/`name` names one of those timestamp keys.
- Nested inside a JSON-LD `<script>` body — the body is parsed as JSON and its
  `datePublished` / `dateModified` / `uploadDate` keys removed, then
  re-serialized. A body that does not parse is hashed unchanged, since an
  unparseable body is still content worth hashing.

The walk MUST be recursive: `head` is an array of `[tagName, attrs]` pairs, so
a shallow pass would see nothing.

`head` itself is **no longer excluded wholesale**. It used to be, which is what
made head tags invisible to change detection.

### Why Exclude Timestamps from Frontmatter Hash?

If timestamps were included in the hash, every build would produce a
different hash (because `modifiedTime` would be the current build time),
marking all files as modified on every build. Excluding timestamps breaks
this circular dependency.

### Head Tags and the Frontmatter Hash

Head tags — `og:image`, the canonical URL, the JSON-LD graph — were invisible
to change detection since the frontmatter hash was written. Two things caused
it, and the first fix landed on a path nothing took.

**Cause 1: `head` was excluded from the hash.** Fixed by hashing `head` with
timestamps stripped recursively, as described above.

**Cause 2: nothing ever passed `hashFrontmatter` a frontmatter containing
`head`.** The hash was taken in `generateSinglePage` over the page generator's
own frontmatter, which carries no `head` at all; head tags were built one
stage later, in `writeSingleFile`. So the fix for cause 1 was correct and
unreachable — and its unit test passed the whole time, because it called
`hashFrontmatter` directly with a `head` array no caller ever produced.

**The fix.** Head-tag construction moved from `writeSingleFile` into
`generateSinglePage`, so the frontmatter hash covers the final frontmatter.
`writeSingleFile` now writes `result.content` directly. See
`page-generation-system.md` for the resulting stage responsibilities.

This is only sound because the timestamp stripping is total. The adapter builds
a local `finalFrontmatter(published, modified)` and calls it **twice**: once
with the build time, to hash, and once with the resolved timestamps, to write.
The two hash identically. Without the stripping, the hash would depend on the
timestamps the hash itself decides.

**Measured** on `sites/basic` (the one fixture site with `siteOrigin` set):

| Check | Before | After |
| --- | --- | --- |
| Bump only the fixture package's `version`, rebuild | **0 of 46 rewritten** | **37 of 46 rewritten** |
| Rebuild with no changes | all unchanged | all unchanged, `diff -r` byte-identical |

The 9 that stay unchanged are `_meta.json` and index pages, which carry no
JSON-LD. Both directions are pinned in
`platforms/rspress/__test__/build-stages.test.ts`: a head-tag change must move
the hash, and the build time must not.

**The transferable rule:** a fix can be correct and land on a path nothing
takes, with a passing unit test the whole time, because the test called the
function with an input no caller produces. Strengthening the unit test would
not have helped. The acceptance evidence for a change-detection fix is a
rebuild count, not a unit assertion.

---

## Disk Fallback Logic

When the snapshot database is missing (first clone, DB deleted, CI
environment), the system falls back to comparing generated content against
existing files on disk using the core `effect` FileSystem service:

```typescript
const fileExists = yield* fileSystem.exists(absolutePath)
  .pipe(Effect.orElseSucceed(() => false));

if (fileExists) {
  const existingContent = yield* fileSystem
    .readFileString(absolutePath)
    .pipe(Effect.orElseSucceed(() => null));

  if (existingContent !== null) {
    const { data: existingFrontmatter, content: existingBody } =
      parseFrontmatter(existingContent);
    const normalizedExistingBody =
      normalizeMarkdownSpacing(existingBody);
    const existingContentHash = hashContent(normalizedExistingBody);
    const existingFrontmatterHash =
      hashFrontmatter(existingFrontmatter);

    if (existingContentHash === contentHash &&
        existingFrontmatterHash === frontmatterHash) {
      // Preserve timestamps from existing file
      publishedTime = existingFrontmatter[
        "article:published_time"] || buildTime;
      modifiedTime = existingFrontmatter[
        "article:modified_time"] || buildTime;
      isUnchanged = true;
    }
  }
}
```

This ensures:

- Running a build after a fresh clone does not modify unchanged files
- SEO timestamps are preserved across environments
- No spurious git changes after database loss

---

## Stale and Orphan Cleanup

### Stale File Cleanup

Files tracked in the snapshot database but not generated in the current
build are removed from both the database and disk:

```typescript
const staleFiles = yield* snapshotSvc
  .cleanupStale(resolvedOutputDir, generatedFiles);

yield* Effect.forEach(staleFiles, (staleFile) =>
  Effect.gen(function* () {
    yield* fileSystem.remove(
      path.join(resolvedOutputDir, staleFile)
    ).pipe(Effect.ignore);
  }),
  { concurrency: "unbounded" },
);
```

### Orphan File Cleanup

Files on disk that are not in the `generatedFiles` set are also cleaned
up. This handles files that exist on disk but have no snapshot entry
(e.g., manually created files, leftover from a previous build):

```typescript
const allFiles = yield* fileSystem
  .readDirectory(resolvedOutputDir, { recursive: true });

for (const entry of allFiles) {
  if (!relPath.endsWith(".mdx") &&
      !relPath.endsWith("_meta.json")) continue;
  if (!generatedFiles.has(normalizedRelPath)) {
    orphanedFiles.push(normalizedRelPath);
  }
}
```

### Empty-Directory Sweep

After stale and orphan deletion, `cleanupAndCommit` (`build-stages.ts`) sweeps directories left empty. The sweep feeds on BOTH deletion lists — stale files are deleted before the orphan scan reads the tree, so a sweep seeded only from orphan parents would never see directories emptied by stale deletion (a former bug). For each removed file the full ancestor chain is collected (removing a child directory can empty its parent), the output root itself is never touched, and candidates are processed deepest-first. Each candidate is verified empty via `readDirectory` before removal, and removal uses `FileSystem.remove` with `{ recursive: true }` — a plain `remove` fails on directories even when empty, and the earlier `Effect.ignore`-swallowed failure meant nothing was ever actually deleted. Each removal emits an `EmptyDirRemoved` event at `trace` level.

### Batch Upsert

Only changed snapshots are committed, in a single transaction:

```typescript
const snapshotsToUpdate = fileResults
  .filter((r) => r.status !== "unchanged")
  .map((r) => r.snapshot);

yield* snapshotSvc.batchUpsert(snapshotsToUpdate);
```

The SQL uses conditional `ON CONFLICT ... DO UPDATE ... WHERE` to avoid
writing unchanged rows even within the batch.

---

## Performance Considerations

### Pre-loaded Snapshot Map

A single query loads all snapshots into a `Map` for O(1) per-file lookup,
reducing database round-trips from one-per-file to one-per-build.

### Batch Transaction

Single transaction for all snapshot updates avoids per-file overhead.

### File Write Avoidance

Unchanged files are never written to disk, preserving RSPress cache and
file system timestamps.

### Build Metrics

File statistics tracked via Effect Metrics (counters):

- `files.total`, `files.new`, `files.modified`, `files.unchanged`

Read at build end by `logBuildSummary` in `layers/observability.ts`.

---

## Related Documentation

- **Build Architecture:**
  `build-architecture.md` -- Plugin structure and service layer
- **Page Generation System:**
  `page-generation-system.md` -- Stream pipeline using snapshots
- **Performance Observability:**
  `performance-observability.md` -- Effect Metrics system
- **Structured Data and Head Metadata:**
  `structured-data-and-og.md` -- the `@tsdoctor/seo` head tags this hash now
  covers
- **Bundle Spec:**
  `bundle-spec.md` -- the bundle-fingerprints table planned as migration 2
  in this store
- **Package Architecture:**
  `tsdoctor-package-architecture.md` -- the resolved `@effected/store`
  adoption decision behind the Store-backed rebuild
