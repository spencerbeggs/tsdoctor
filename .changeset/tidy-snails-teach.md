---
"@tsdoctor/snapshot": minor
---

## Features

`@tsdoctor/snapshot` is a new package: incremental-build snapshot tracking, extracted from `rspress-plugin-api-extractor` and rebuilt on `@effected/store`'s `Store.layerSqlite`.

* `SnapshotService` — an Effect `Context.Service` (id `"@tsdoctor/snapshot/SnapshotService"`) with `getSnapshot`, `getAllForDirectory`, `getFilePaths`, `upsert`, `batchUpsert`, `deleteSnapshot` and `cleanupStale`
* `SnapshotServiceLive(dbPath)` — a live layer backed by a schema-versioned SQLite store: migrations apply at layer construction and the WAL is checkpointed on scope close
* `hashContent`, `hashFrontmatter`, `normalizeContent` — pure SHA-256 content-hashing helpers used to detect unchanged files across builds
* `FileSnapshot` and the typed `SnapshotDbError`

```typescript
import { SnapshotService, SnapshotServiceLive } from "@tsdoctor/snapshot";
import { Effect } from "effect";

const program = Effect.gen(function* () {
	const snapshots = yield* SnapshotService;
	const existing = yield* snapshots.getAllForDirectory("/path/to/output");
});

program.pipe(Effect.provide(SnapshotServiceLive("/path/to/api-docs.db")));
```
