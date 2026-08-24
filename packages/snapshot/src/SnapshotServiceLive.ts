import type { StoreError, StoreMigration, StoreMigrationError } from "@effected/store";
import { Store } from "@effected/store";
import { Effect, Layer, Option } from "effect";
import { hashContent } from "./content-hash.js";
import type { FileSnapshot } from "./SnapshotService.js";
import { SnapshotDbError, SnapshotService } from "./SnapshotService.js";

function toFileSnapshot(row: { readonly [column: string]: unknown }): FileSnapshot {
	return {
		outputDir: row.output_dir as string,
		filePath: row.file_path as string,
		publishedTime: row.published_time as string,
		modifiedTime: row.modified_time as string,
		contentHash: row.content_hash as string,
		frontmatterHash: row.frontmatter_hash as string,
		buildTime: row.build_time as string,
	};
}

function toSnapshotDbError(error: unknown): SnapshotDbError {
	return new SnapshotDbError({
		operation: "query",
		dbPath: "snapshot-db",
		reason: error instanceof Error ? error.message : String(error),
	});
}

// Migrations are append-only with ascending ids: never edit or reorder an
// existing entry — add the next `{ id: n + 1 }` migration instead. The Store
// ledger records applied ids and applies only the pending tail.
const migrations: ReadonlyArray<StoreMigration> = [
	{
		id: 1,
		name: "001_create_snapshots",
		up: (sql) =>
			Effect.gen(function* () {
				yield* sql`
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
					)
				`;
				yield* sql`CREATE INDEX IF NOT EXISTS idx_output_dir ON file_snapshots(output_dir)`;
				yield* sql`CREATE INDEX IF NOT EXISTS idx_file_path ON file_snapshots(file_path)`;
			}),
	},
];

/**
 * Builds the live {@link SnapshotService} layer over a SQLite database file.
 *
 * @remarks
 * Backed by `@effected/store`'s `Store.layerSqlite`: layer construction opens
 * the database (WAL mode), ensures the migration ledger and applies pending
 * migrations. A WAL checkpoint (`PRAGMA wal_checkpoint(TRUNCATE)`) is
 * registered as a scope finalizer so the sidecar files are folded back into
 * the main database on clean shutdown.
 *
 * This is a parameterized layer factory: call it once per database path and
 * bind the result to a `const` — layers memoize by reference, and a fresh
 * call at each provide site would open the database more than once. The
 * parent directory of `dbPath` must already exist.
 *
 * @param dbPath - Path to the SQLite database file
 * @returns A layer providing {@link SnapshotService}
 * @public
 */
export const SnapshotServiceLive = (dbPath: string): Layer.Layer<SnapshotService, StoreError | StoreMigrationError> => {
	const StoreLive = Store.layerSqlite({ filename: dbPath, migrations });

	const ServiceImpl = Layer.effect(
		SnapshotService,
		Effect.gen(function* () {
			const store = yield* Store;
			const sql = store.client;

			// WAL checkpoint on scope close
			yield* Effect.addFinalizer(() => sql`PRAGMA wal_checkpoint(TRUNCATE)`.pipe(Effect.ignore));

			return {
				hashContent,

				getSnapshot: (outputDir, filePath) =>
					sql`SELECT * FROM file_snapshots WHERE output_dir = ${outputDir} AND file_path = ${filePath}`.pipe(
						Effect.map((rows) => (rows.length > 0 ? Option.some(toFileSnapshot(rows[0])) : Option.none())),
						Effect.mapError(toSnapshotDbError),
					),

				getAllForDirectory: (outputDir) =>
					sql`SELECT * FROM file_snapshots WHERE output_dir = ${outputDir}`.pipe(
						Effect.map((rows) => rows.map(toFileSnapshot)),
						Effect.mapError(toSnapshotDbError),
					),

				getFilePaths: (outputDir) =>
					sql`SELECT file_path FROM file_snapshots WHERE output_dir = ${outputDir}`.pipe(
						Effect.map((rows) => rows.map((r) => r.file_path as string)),
						Effect.mapError(toSnapshotDbError),
					),

				upsert: (snapshot) =>
					sql`INSERT INTO file_snapshots
						(output_dir, file_path, published_time, modified_time,
						 content_hash, frontmatter_hash, build_time)
						VALUES (${snapshot.outputDir}, ${snapshot.filePath},
								${snapshot.publishedTime}, ${snapshot.modifiedTime},
								${snapshot.contentHash}, ${snapshot.frontmatterHash},
								${snapshot.buildTime})
						ON CONFLICT(output_dir, file_path) DO UPDATE SET
							published_time = ${snapshot.publishedTime},
							modified_time = ${snapshot.modifiedTime},
							content_hash = ${snapshot.contentHash},
							frontmatter_hash = ${snapshot.frontmatterHash},
							build_time = ${snapshot.buildTime}
						WHERE published_time != ${snapshot.publishedTime}
						   OR modified_time != ${snapshot.modifiedTime}
						   OR content_hash != ${snapshot.contentHash}
						   OR frontmatter_hash != ${snapshot.frontmatterHash}`.pipe(
						Effect.as(true),
						Effect.mapError(toSnapshotDbError),
					),

				batchUpsert: (snapshots) =>
					(snapshots.length === 0
						? Effect.succeed(0)
						: sql
								.withTransaction(
									Effect.forEach(
										snapshots,
										(s) =>
											sql`INSERT INTO file_snapshots
												(output_dir, file_path, published_time, modified_time,
												 content_hash, frontmatter_hash, build_time)
												VALUES (${s.outputDir}, ${s.filePath},
														${s.publishedTime}, ${s.modifiedTime},
														${s.contentHash}, ${s.frontmatterHash},
														${s.buildTime})
												ON CONFLICT(output_dir, file_path) DO UPDATE SET
													published_time = ${s.publishedTime},
													modified_time = ${s.modifiedTime},
													content_hash = ${s.contentHash},
													frontmatter_hash = ${s.frontmatterHash},
													build_time = ${s.buildTime}
												WHERE published_time != ${s.publishedTime}
												   OR modified_time != ${s.modifiedTime}
												   OR content_hash != ${s.contentHash}
												   OR frontmatter_hash != ${s.frontmatterHash}`,
										{ concurrency: 1 },
									),
								)
								.pipe(Effect.map(() => snapshots.length))
					).pipe(Effect.mapError(toSnapshotDbError)),

				deleteSnapshot: (outputDir, filePath) =>
					sql`DELETE FROM file_snapshots WHERE output_dir = ${outputDir} AND file_path = ${filePath}`.pipe(
						Effect.asVoid,
						Effect.mapError(toSnapshotDbError),
					),

				cleanupStale: (outputDir, currentFiles) =>
					Effect.gen(function* () {
						const rows = yield* sql`SELECT file_path FROM file_snapshots WHERE output_dir = ${outputDir}`;
						const staleFiles: string[] = [];
						for (const row of rows) {
							const fp = row.file_path as string;
							if (!currentFiles.has(fp)) {
								yield* sql`DELETE FROM file_snapshots WHERE output_dir = ${outputDir} AND file_path = ${fp}`;
								staleFiles.push(fp);
							}
						}
						return staleFiles;
					}).pipe(Effect.mapError(toSnapshotDbError)),
			};
		}),
	);

	return Layer.provide(ServiceImpl, StoreLive);
};
