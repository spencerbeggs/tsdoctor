import { describe, expect, it } from "vitest";
import { SnapshotDbError } from "../src/SnapshotService.js";

describe("SnapshotDbError", () => {
	it("has correct tag, fields, and message", () => {
		const err = new SnapshotDbError({
			operation: "upsert",
			dbPath: "/path/to/db",
			reason: "SQLITE_BUSY",
		});
		expect(err._tag).toBe("SnapshotDbError");
		expect(err.operation).toBe("upsert");
		expect(err.dbPath).toBe("/path/to/db");
		expect(err.reason).toBe("SQLITE_BUSY");
		expect(err.message).toBe("Snapshot DB error during 'upsert' at '/path/to/db': SQLITE_BUSY");
	});
});
