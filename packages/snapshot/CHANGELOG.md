# @tsdoctor/snapshot

## 0.2.2

### Bug Fixes

#### Use catalog:effected for Peer Dependencies

- Switch to strict versioning of peer dependencies via `@effected/pnpm-plugin-effect` to keep disapline of release cycle.

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.2.1

### Bug Fixes

- `hashFrontmatter` now detects changes to `head` tags. It previously dropped the entire `head` array from the hash to keep build timestamps from marking every page modified on every build, which also made an `og:image`, `og:description` or canonical URL change invisible to change detection — the page was never rewritten.

- Timestamp-valued entries are now stripped recursively instead of dropping the whole `head` array, so everything else in `head` participates in the hash

- Timestamps are recognized in both shapes: a `content` value whose sibling `property`/`name` is `article:published_time` / `article:modified_time`, and the `datePublished` / `dateModified` keys inside a JSON-LD script body

- A JSON-LD script body is parsed before its dates are stripped; a body that does not parse is left intact rather than throwing

- The top-level `publishedTime` / `modifiedTime` / `article:published_time` / `article:modified_time` drops are unchanged

- The first build after upgrading rewrites every page once, then settles byte-identical. [#186][#186]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#186]: https://github.com/spencerbeggs/tsdoctor/pull/186

## 0.2.0

### Breaking Changes

- `SnapshotServiceLive(dbPath)` is removed. Build the layer from the service itself instead:

```typescript
import { SnapshotService } from "@tsdoctor/snapshot";

const layer = SnapshotService.layer(dbPath);
```

- `SnapshotServiceShape.hashContent` is removed from the service interface — it had no consumers of the method form. The standalone `hashContent` export from the package root (`import { hashContent } from "@tsdoctor/snapshot"`) is unchanged and remains the supported way to hash content.

- This is a breaking API change on the pre-1.0 line, released as `minor` per this repo's convention for 0.x breaking changes.

### Features

- Adds in-memory test doubles for consumers that need to provide `SnapshotService` without a real SQLite database:

```typescript
import { SnapshotService } from "@tsdoctor/snapshot";

const layer = SnapshotService.layerTest({
	getSnapshot: () => Effect.succeed(Option.none()),
});
```

- `SnapshotService.makeTest(overrides)` returns the shape directly; `SnapshotService.layerTest(overrides)` wraps it in a `Layer`. Defaults describe a build with no prior snapshot: every lookup misses, every write is accepted and discarded, and `cleanupStale` reports nothing stale. [#183][#183]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#183]: https://github.com/spencerbeggs/tsdoctor/pull/183

## 0.1.1

### Bug Fixes

- The WAL checkpoint on clean shutdown now uses `@effected/store`'s `checkpointOnClose: true` option on `Store.layerSqlite` instead of a hand-written scope finalizer — same `PRAGMA wal_checkpoint(TRUNCATE)` behavior, provably ordered before the connection closes. No API change. [#167][#167]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#167]: https://github.com/spencerbeggs/tsdoctor/pull/167

## 0.1.0

### Features

- `@tsdoctor/snapshot` is a new package: incremental-build snapshot tracking, extracted from `rspress-plugin-api-extractor` and rebuilt on `@effected/store`'s `Store.layerSqlite`.

- `SnapshotService` — an Effect `Context.Service` (id `"@tsdoctor/snapshot/SnapshotService"`) with `getSnapshot`, `getAllForDirectory`, `getFilePaths`, `upsert`, `batchUpsert`, `deleteSnapshot` and `cleanupStale`

- `SnapshotServiceLive(dbPath)` — a live layer backed by a schema-versioned SQLite store: migrations apply at layer construction and the WAL is checkpointed on scope close

- `hashContent`, `hashFrontmatter`, `normalizeContent` — pure SHA-256 content-hashing helpers used to detect unchanged files across builds

- `FileSnapshot` and the typed `SnapshotDbError` [#165][#165]

```typescript
import { SnapshotService, SnapshotServiceLive } from "@tsdoctor/snapshot";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const snapshots = yield* SnapshotService;
	const existing = yield* snapshots.getAllForDirectory("/path/to/output");
});

program.pipe(Effect.provide(SnapshotServiceLive("/path/to/api-docs.db")));
```

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#165]: https://github.com/spencerbeggs/tsdoctor/pull/165
