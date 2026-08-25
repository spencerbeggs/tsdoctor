/**
 * `@tsdoctor/snapshot` — incremental-build snapshot tracking: a
 * schema-versioned SQLite store of per-file content hashes and timestamps
 * (built on `@effected/store`), plus the pure SHA-256 content-hashing
 * helpers that feed it.
 *
 * @packageDocumentation
 */

export { hashContent, hashFrontmatter, normalizeContent } from "./content-hash.js";
export type { FileSnapshot, SnapshotServiceShape } from "./SnapshotService.js";
export { SnapshotDbError, SnapshotService } from "./SnapshotService.js";
