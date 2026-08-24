import type { Effect, Option } from "effect";
import { Context, Data } from "effect";

/**
 * A tracked snapshot of one generated file: its content/frontmatter hashes
 * and the timestamps preserved across incremental builds.
 *
 * @public
 */
export interface FileSnapshot {
	/** Output directory the file was generated into. */
	readonly outputDir: string;
	/** File path relative to `outputDir`. */
	readonly filePath: string;
	/** ISO timestamp of first publication, preserved for unchanged files. */
	readonly publishedTime: string;
	/** ISO timestamp of last content change. */
	readonly modifiedTime: string;
	/** SHA-256 hash of the normalized file body. */
	readonly contentHash: string;
	/** SHA-256 hash of the frontmatter (timestamp fields excluded). */
	readonly frontmatterHash: string;
	/** ISO timestamp of the build that last wrote this snapshot. */
	readonly buildTime: string;
}

/**
 * Raised when a snapshot database operation fails.
 *
 * @public
 */
export class SnapshotDbError extends Data.TaggedError("SnapshotDbError")<{
	/** The database operation that failed (e.g. `"query"`). */
	readonly operation: string;
	/** Path or label of the database the operation ran against. */
	readonly dbPath: string;
	/** Human-readable failure reason. */
	readonly reason: string;
}> {
	/** Formatted failure message combining operation, path and reason. */
	get message(): string {
		return `Snapshot DB error during '${this.operation}' at '${this.dbPath}': ${this.reason}`;
	}
}

/**
 * The operations {@link SnapshotService} provides for tracking generated
 * files across incremental builds.
 *
 * @public
 */
export interface SnapshotServiceShape {
	/** Hash normalized content with SHA-256 (pure, synchronous). */
	readonly hashContent: (content: string) => string;

	/** Look up a single snapshot by output directory and file path. */
	readonly getSnapshot: (
		outputDir: string,
		filePath: string,
	) => Effect.Effect<Option.Option<FileSnapshot>, SnapshotDbError>;

	/** Load every snapshot recorded for an output directory. */
	readonly getAllForDirectory: (outputDir: string) => Effect.Effect<ReadonlyArray<FileSnapshot>, SnapshotDbError>;

	/** List the tracked file paths for an output directory. */
	readonly getFilePaths: (outputDir: string) => Effect.Effect<ReadonlyArray<string>, SnapshotDbError>;

	/** Insert or update a single snapshot. */
	readonly upsert: (snapshot: FileSnapshot) => Effect.Effect<boolean, SnapshotDbError>;

	/** Insert or update many snapshots in one transaction; returns the count. */
	readonly batchUpsert: (snapshots: ReadonlyArray<FileSnapshot>) => Effect.Effect<number, SnapshotDbError>;

	/** Remove a single snapshot row. */
	readonly deleteSnapshot: (outputDir: string, filePath: string) => Effect.Effect<void, SnapshotDbError>;

	/**
	 * Delete rows for files no longer generated; returns the stale file paths.
	 */
	readonly cleanupStale: (
		outputDir: string,
		currentFiles: ReadonlySet<string>,
	) => Effect.Effect<ReadonlyArray<string>, SnapshotDbError>;
}

/**
 * Effect service tag for the snapshot tracking store.
 *
 * @remarks
 * Provided by {@link SnapshotServiceLive}, which backs it with a
 * schema-versioned SQLite database via `@effected/store`.
 *
 * @public
 */
export class SnapshotService extends Context.Service<SnapshotService, SnapshotServiceShape>()(
	"@tsdoctor/snapshot/SnapshotService",
) {}
