# packages/snapshot/CLAUDE.md

`@tsdoctor/snapshot` (publishable, versioned via changesets) — incremental-build
snapshot tracking: a schema-versioned SQLite store of per-file content hashes
and timestamps, plus the pure SHA-256 content-hashing helpers that feed it.

Extracted from the plugin in phase 2 of the consolidation and rebuilt on
`@effected/store`'s `Store.layerSqlite` (the plugin dropped its direct
`@effect/sql-sqlite-node` dependency and `migrations/` directory).

## Key Facts

- Modules: `SnapshotService.ts` — the `Context.Service` tag (id
  `"@tsdoctor/snapshot/SnapshotService"`), `SnapshotServiceShape`,
  `FileSnapshot`, the `SnapshotDbError` tagged error and the service's own
  layer and test doubles — and `content-hash.ts` (pure
  `hashContent`/`hashFrontmatter`/`normalizeContent`).
- The service owns its layer as a static: `SnapshotService.layer(dbPath)` over
  `Store.layerSqlite({ filename, migrations, checkpointOnClose: true })`.
  Migration 1 is the former `001_create_snapshots` SQL, applied at layer
  construction; `checkpointOnClose: true` registers the WAL checkpoint as a
  scope finalizer inside `@effected/store` itself — no hand-written finalizer
  here. It is a factory: call it once per database path and bind the result to
  a `const`, since layers memoize by reference.
- `SnapshotService.makeTest(overrides)` / `layerTest(overrides)` are the
  in-memory doubles — every lookup misses, every write is accepted and
  discarded, and `cleanupStale` reports nothing stale (a double claiming files
  were stale would have the caller delete them from disk).
- `hashContent` is **not** on `SnapshotServiceShape`; it never had a consumer in
  method form. The standalone `hashContent` export from the package root is
  unchanged and is what callers already used.
- `hashFrontmatter` hashes the frontmatter's `head` key (it used to exclude it
  wholesale, which made every head tag invisible to change detection) and
  strips timestamps **recursively** instead: the top-level fields, the
  `[tagName, attrs]` meta-pair form nested in `head`, and
  `datePublished`/`dateModified`/`uploadDate` inside a parsed JSON-LD script
  body. The walk MUST stay recursive — `head` is an array of pairs, so a
  shallow pass sees nothing — and the stripping MUST stay total, since the
  caller hashes and writes the same frontmatter with different timestamps.
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
  imports `SnapshotService`, `hashContent`, `hashFrontmatter`;
  `layers/AppLayer.ts` composes `SnapshotService.layer(dbPath)` for the
  `<cwd>/.api-docs/snapshot/api-docs.db` path `plugin.ts` resolves and
  `mkdirSync`s.
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
