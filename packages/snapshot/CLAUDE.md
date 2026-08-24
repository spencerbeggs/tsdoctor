# packages/snapshot/CLAUDE.md

`@tsdoctor/snapshot` (publishable, versioned via changesets) — incremental-build
snapshot tracking: a schema-versioned SQLite store of per-file content hashes
and timestamps, plus the pure SHA-256 content-hashing helpers that feed it.

Extracted from the plugin in phase 2 of the consolidation and rebuilt on
`@effected/store`'s `Store.layerSqlite` (the plugin dropped its direct
`@effect/sql-sqlite-node` dependency and `migrations/` directory).

## Key Facts

- Modules: `SnapshotService.ts` (the `Context.Service` tag — id
  `"@tsdoctor/snapshot/SnapshotService"` — plus `SnapshotServiceShape`,
  `FileSnapshot` and the `SnapshotDbError` tagged error),
  `SnapshotServiceLive.ts` (`SnapshotServiceLive(dbPath)` on
  `Store.layerSqlite({ filename, migrations })`; migration 1 is the former
  `001_create_snapshots` SQL, applied at layer construction; WAL checkpoint
  registered as a scope finalizer via `store.client`), `content-hash.ts`
  (pure `hashContent`/`hashFrontmatter`/`normalizeContent`).
- Peers only: `effect` (`catalog:effect:peers`) and `@effected/store`
  (`catalog:effected:peers`) — never hand-pin `@effected` ranges.
- All queries and the transactional batch upsert run through `store.client`
  (the full `effect/unstable/sql` `SqlClient`). Layer errors carry Store's
  typed `StoreError | StoreMigrationError`.
- Migration-ledger caveat: Store's `_store_migrations` ledger differs from
  the old Migrator's, so a pre-existing `api-docs.db` re-applies migration 1
  on first run — harmless (`CREATE TABLE IF NOT EXISTS`). The bundle
  fingerprints table (`bundle-spec.md`) is planned as migration 2.
- Primary consumer is `platforms/rspress/` (`workspace:*`): `build-stages.ts`
  imports `SnapshotService`, `hashContent`, `hashFrontmatter`; `plugin.ts`
  composes `SnapshotServiceLive(<cwd>/.api-docs/snapshot/api-docs.db)`.
- Builds with `defineBuild()` (`savvy.build.ts`, `@savvy-web/bundler`);
  tsconfig extends `@savvy-web/bundler/tsconfig/ecma.json`. Source
  `package.json` stays `"private": true`; `publishConfig` drives publishing.

## Commands

```bash
pnpm --filter @tsdoctor/snapshot run build:dev
pnpm vitest run packages/snapshot/
```

## Design Docs

- @../../.claude/design/rspress-plugin-api-extractor/snapshot-tracking-system.md
- @../../.claude/design/rspress-plugin-api-extractor/tsdoctor-package-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/bundle-spec.md
