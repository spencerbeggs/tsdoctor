---
"@tsdoctor/snapshot": patch
---

## Bug Fixes

* The WAL checkpoint on clean shutdown now uses `@effected/store`'s `checkpointOnClose: true` option on `Store.layerSqlite` instead of a hand-written scope finalizer — same `PRAGMA wal_checkpoint(TRUNCATE)` behavior, provably ordered before the connection closes. No API change.
