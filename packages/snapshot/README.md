# @tsdoctor/snapshot

[![npm](https://img.shields.io/npm/v/@tsdoctor%2Fsnapshot?label=npm&color=cb3837)](https://www.npmjs.com/package/@tsdoctor/snapshot)
[![License: MIT](https://img.shields.io/badge/License-MIT-4caf50.svg)](https://opensource.org/licenses/MIT)
[![Node.js %3E%3D24.11.0](https://img.shields.io/badge/Node.js-%3E%3D24.11.0-5fa04e.svg)](https://nodejs.org/)
[![TypeScript 6.0](https://img.shields.io/badge/TypeScript-6.0-3178c6.svg)](https://www.typescriptlang.org/)

Incremental-build snapshot tracking for static documentation pipelines. The package stores per-file content hashes and timestamps in a schema-versioned SQLite database (built on `@effected/store`'s `Store`), so a build can skip writes for unchanged files, preserve SEO-critical publication timestamps, and clean up files that fell out of the source model.

## What you get

- **`SnapshotService`** — an Effect service tag with typed operations: single and bulk lookup, transactional batch upsert (with a conditional `ON CONFLICT ... DO UPDATE ... WHERE` that avoids rewriting unchanged rows), deletion and stale-entry cleanup.
- **`SnapshotService.layer(dbPath)`** — the live layer over a SQLite file. Layer construction applies migrations through `@effected/store`'s ledger; a WAL checkpoint runs as a scope finalizer on clean shutdown. It is a factory: call it once per database path and bind the result to a `const`, since layers memoize by reference.
- **`SnapshotService.makeTest(overrides)` / `SnapshotService.layerTest(overrides)`** — an in-memory double describing a build with no prior snapshot: every lookup misses, every write is accepted and discarded, and nothing is reported stale.
- **`hashContent` / `hashFrontmatter` / `normalizeContent`** — pure SHA-256 helpers that normalize markdown bodies and frontmatter (excluding timestamp fields) into stable change-detection hashes.
- **`FileSnapshot`** / **`SnapshotDbError`** — the tracked-file record and the typed error every operation can fail with.

## Install

```bash
npm install @tsdoctor/snapshot
# or
pnpm add @tsdoctor/snapshot
```

This is an ESM-only package. `effect` (v4) and `@effected/store` are peer dependencies.

## Quick start

```ts
import { SnapshotService, hashContent } from "@tsdoctor/snapshot";
import { Effect } from "effect";

const layer = SnapshotService.layer(".api-docs/snapshot/api-docs.db");

const program = Effect.gen(function* () {
  const snapshots = yield* SnapshotService;
  const existing = yield* snapshots.getAllForDirectory("docs/api");
  // ... compare hashContent(body) against existing entries, then:
  yield* snapshots.batchUpsert(changed);
  yield* snapshots.cleanupStale("docs/api", generatedFiles);
});

await Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(layer))));
```

The parent directory of the database path must exist before the layer is built; path policy (where the database lives) is the caller's concern.

## Provenance

Extracted in phase 2 of the tsdoctor consolidation from the snapshot tracking system inside `rspress-plugin-api-extractor`, rebuilt on `@effected/store` with the same SQL schema and query semantics.

## License

[MIT](LICENSE)
