# @tsdoctor/snapshot

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
