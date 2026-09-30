---
"rspress-plugin-api-extractor": patch
---

## Bug Fixes

* Bundle discovery under `fromDir` / `fromParentDir` now reports filesystem errors with full errno fidelity: `EISDIR`, `ENOTDIR` and `ELOOP` surface as `BadResource` instead of `Unknown`, matching `@effect/platform-node`

## Refactoring

* Replaced the hand-rolled synchronous Node filesystem with `NodeSyncFileSystem.layer` from `@effected/memfs/node-sync`

## Dependencies

`@effected/memfs` is now a runtime dependency, as the plugin uses it directly.

| Dependency      | Type       | Action  | From            | To              |
| :-------------- | :--------- | :------ | :-------------- | :-------------- |
| @effected/memfs | dependency | added   | —               | ^0.13.0         |
