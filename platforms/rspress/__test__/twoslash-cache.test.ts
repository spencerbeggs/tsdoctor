import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	decodeTwoslashCache,
	encodeTwoslashCache,
	makeTwoslashCache,
	twoslashBlobKey,
	twoslashEntryKey,
	twoslashEnvHash,
} from "../src/twoslash-cache.js";

/** A minimal stand-in for what `twoslasher()` hands back to Shiki. */
function result(code: string, nodes: unknown = [{ type: "hover", start: 0, length: 3, text: "string" }]) {
	return { nodes, code } as never;
}

describe("twoslashEnvHash", () => {
	it("is stable against VFS iteration order", () => {
		const a = new Map([
			["a.d.ts", "declare const a: 1;"],
			["b.d.ts", "declare const b: 2;"],
		]);
		const b = new Map([
			["b.d.ts", "declare const b: 2;"],
			["a.d.ts", "declare const a: 1;"],
		]);

		expect(twoslashEnvHash(a)).toBe(twoslashEnvHash(b));
	});

	it("changes when any declaration changes", () => {
		const before = new Map([["a.d.ts", "declare const a: 1;"]]);
		const after = new Map([["a.d.ts", "declare const a: 2;"]]);

		expect(twoslashEnvHash(after)).not.toBe(twoslashEnvHash(before));
	});

	it("changes when a file is added", () => {
		const one = new Map([["a.d.ts", "x"]]);
		const two = new Map([
			["a.d.ts", "x"],
			["b.d.ts", "y"],
		]);

		expect(twoslashEnvHash(two)).not.toBe(twoslashEnvHash(one));
	});

	it("cannot be fooled by moving the boundary between path and content", () => {
		// Space-delimited hashing would collide these; NUL-delimited must not.
		const a = new Map([["a b", "c"]]);
		const b = new Map([["a", "b c"]]);

		expect(twoslashEnvHash(a)).not.toBe(twoslashEnvHash(b));
	});
});

describe("twoslashEntryKey", () => {
	it("distinguishes different code", () => {
		expect(twoslashEntryKey("const a = 1", "ts")).not.toBe(twoslashEntryKey("const a = 2", "ts"));
	});

	it("distinguishes the same code in different languages", () => {
		expect(twoslashEntryKey("const a = 1", "ts")).not.toBe(twoslashEntryKey("const a = 1", "tsx"));
	});

	it("treats a missing language as typescript", () => {
		expect(twoslashEntryKey("const a = 1", undefined)).toBe(twoslashEntryKey("const a = 1", "ts"));
	});

	it("distinguishes the same code checked under different compiler options", () => {
		expect(twoslashEntryKey("const a = 1", "ts", { strict: true })).not.toBe(
			twoslashEntryKey("const a = 1", "ts", { strict: false }),
		);
	});

	it("is stable against compiler-option key order", () => {
		expect(twoslashEntryKey("c", "ts", { strict: true, target: "ES2020" })).toBe(
			twoslashEntryKey("c", "ts", { target: "ES2020", strict: true }),
		);
	});

	it("treats absent options as an empty configuration", () => {
		expect(twoslashEntryKey("c", "ts")).toBe(twoslashEntryKey("c", "ts", {}));
	});
});

describe("twoslashBlobKey", () => {
	it("namespaces by format version so an older blob is never read back", () => {
		expect(twoslashBlobKey("abc")).toBe("twoslash/v1/abc");
	});
});

describe("makeTwoslashCache", () => {
	it("misses on an empty cache", () => {
		const cache = makeTwoslashCache();

		expect(cache.read("const a = 1", "ts")).toBeNull();
		expect(cache.stats()).toMatchObject({ hits: 0, misses: 1, entries: 0, dirty: false });
	});

	it("serves a written result back", () => {
		const cache = makeTwoslashCache();
		cache.write("const a = 1", result("const a = 1"), "ts");

		expect(cache.read("const a = 1", "ts")).toMatchObject({ code: "const a = 1" });
		expect(cache.stats()).toMatchObject({ hits: 1, misses: 0, entries: 1, dirty: true });
	});

	it("does not serve one block's result for different code", () => {
		const cache = makeTwoslashCache();
		cache.write("const a = 1", result("const a = 1"), "ts");

		expect(cache.read("const a = 2", "ts")).toBeNull();
	});

	it("serves entries restored from a previous build without marking dirty", () => {
		const seeded = makeTwoslashCache();
		seeded.write("const a = 1", result("const a = 1"), "ts");

		const restored = makeTwoslashCache(seeded.entries());

		expect(restored.read("const a = 1", "ts")).toMatchObject({ code: "const a = 1" });
		// Nothing new was type-checked, so there is nothing to persist.
		expect(restored.stats()).toMatchObject({ hits: 1, misses: 0, dirty: false });
	});

	it("does not serve a result across different compiler configurations", () => {
		const cache = makeTwoslashCache();
		cache.write("const a = 1", result("strict"), "ts", { compilerOptions: { strict: true } } as never);

		// Same code, different configuration: the stored types may not apply.
		expect(cache.read("const a = 1", "ts", { compilerOptions: { strict: false } } as never)).toBeNull();
		expect(cache.read("const a = 1", "ts", { compilerOptions: { strict: true } } as never)).toMatchObject({
			code: "strict",
		});
	});

	it("keeps only the fields Shiki consumes", () => {
		const cache = makeTwoslashCache();
		cache.write("code", { nodes: [], code: "code", meta: { extension: "tsx" }, extra: "dropped" } as never, "ts");

		expect([...cache.entries().values()][0]).toEqual({ nodes: [], code: "code", meta: { extension: "tsx" } });
	});

	it("omits meta when the run carried no extension", () => {
		const cache = makeTwoslashCache();
		cache.write("code", result("code"), "ts");

		expect([...cache.entries().values()][0]).not.toHaveProperty("meta");
	});
});

describe("encode/decode round trip", () => {
	it("restores every entry", () => {
		const cache = makeTwoslashCache();
		cache.write("const a = 1", result("const a = 1"), "ts");
		cache.write("const b = 2", result("const b = 2"), "ts");

		const restored = decodeTwoslashCache(encodeTwoslashCache(cache.entries()));

		expect(restored.size).toBe(2);
		expect(restored.get(twoslashEntryKey("const a = 1", "ts"))).toMatchObject({ code: "const a = 1" });
	});

	it("compresses, so a large generation does not bloat the store", () => {
		const cache = makeTwoslashCache();
		for (let i = 0; i < 200; i++) {
			cache.write(`const x${i} = 1`, result(`const x${i} = 1`), "ts");
		}

		const raw = JSON.stringify(Object.fromEntries(cache.entries())).length;
		expect(encodeTwoslashCache(cache.entries()).byteLength).toBeLessThan(raw / 2);
	});

	it("treats a corrupt blob as a cold cache rather than failing the build", () => {
		expect(decodeTwoslashCache(new Uint8Array([1, 2, 3, 4]))).toEqual(new Map());
	});

	it("treats a well-formed but wrongly-shaped blob as cold", () => {
		// Valid gzip, valid JSON, wrong shape: an array where a record is expected.
		expect(decodeTwoslashCache(gzipSync(Buffer.from("[]", "utf-8")))).toEqual(new Map());
	});
});
