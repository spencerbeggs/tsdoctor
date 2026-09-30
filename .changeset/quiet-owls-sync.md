---
"@tsdoctor/snapshot": minor
---

## Features

### In-memory SnapshotService layer

Added `SnapshotService.layerMemory()`, the real SQL implementation running over an in-memory (`:memory:`) SQLite database. It uses the same queries, migrations and upsert semantics as `SnapshotService.layer(dbPath)`, so tests can exercise the actual snapshot store without a temp directory. Unlike `SnapshotService.layerTest`, nothing is stubbed.

```ts
const SnapshotLive = SnapshotService.layerMemory();
```

Each call mints a fresh, empty database, so bind the result to a `const` and provide it once when several steps of a test must see each other's rows. File-backed behavior (WAL mode, checkpoint on close, persistence across a reopen) is not covered.
