import { gzipSync } from "node:zlib";
import { assert, describe, it } from "@effect/vitest";
import {
	decodeTwoslashCache,
	encodeTwoslashCache,
	makeTwoslashCache,
	twoslashBlobKey,
	twoslashEntryKey,
	twoslashEnvHash,
} from "../src/TwoslashCache.js";

/** A fixed toolchain fingerprint, so VFS-driven tests vary only the VFS. */
const TS = "typescript@5.9.0";

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

		assert.strictEqual(twoslashEnvHash(a, TS), twoslashEnvHash(b, TS));
	});

	it("changes when any declaration changes", () => {
		const before = new Map([["a.d.ts", "declare const a: 1;"]]);
		const after = new Map([["a.d.ts", "declare const a: 2;"]]);

		assert.notStrictEqual(twoslashEnvHash(after, TS), twoslashEnvHash(before, TS));
	});

	it("changes when a file is added", () => {
		const one = new Map([["a.d.ts", "x"]]);
		const two = new Map([
			["a.d.ts", "x"],
			["b.d.ts", "y"],
		]);

		assert.notStrictEqual(twoslashEnvHash(two, TS), twoslashEnvHash(one, TS));
	});

	it("changes when the TypeScript version changes", () => {
		// lib.d.ts ships with the compiler and inference changes between releases,
		// so the same declarations checked by a different compiler are a different
		// environment. Without this in the key, a warm cache would serve hovers
		// computed by the previous TypeScript until the declarations happened to
		// change on their own.
		const vfs = new Map([["a.d.ts", "declare const a: 1;"]]);

		assert.notStrictEqual(twoslashEnvHash(vfs, "typescript@5.9.0"), twoslashEnvHash(vfs, "typescript@6.0.3"));
	});

	it("is stable for the same VFS and toolchain", () => {
		const vfs = new Map([["a.d.ts", "declare const a: 1;"]]);

		assert.strictEqual(twoslashEnvHash(vfs, TS), twoslashEnvHash(vfs, TS));
	});

	it("cannot be fooled by moving the boundary between path and content", () => {
		// Space-delimited hashing would collide these; NUL-delimited must not.
		const a = new Map([["a b", "c"]]);
		const b = new Map([["a", "b c"]]);

		assert.notStrictEqual(twoslashEnvHash(a, TS), twoslashEnvHash(b, TS));
	});
});

describe("twoslashEntryKey", () => {
	it("distinguishes different code", () => {
		assert.notStrictEqual(twoslashEntryKey("const a = 1", "ts"), twoslashEntryKey("const a = 2", "ts"));
	});

	it("distinguishes the same code in different languages", () => {
		assert.notStrictEqual(twoslashEntryKey("const a = 1", "ts"), twoslashEntryKey("const a = 1", "tsx"));
	});

	it("treats a missing language as typescript", () => {
		assert.strictEqual(twoslashEntryKey("const a = 1", undefined), twoslashEntryKey("const a = 1", "ts"));
	});

	it("distinguishes the same code checked under different compiler options", () => {
		assert.notStrictEqual(
			twoslashEntryKey("const a = 1", "ts", { strict: true }),
			twoslashEntryKey("const a = 1", "ts", { strict: false }),
		);
	});

	it("is stable against compiler-option key order", () => {
		assert.strictEqual(
			twoslashEntryKey("c", "ts", { strict: true, target: "ES2020" }),
			twoslashEntryKey("c", "ts", { target: "ES2020", strict: true }),
		);
	});

	it("treats absent options as an empty configuration", () => {
		assert.strictEqual(twoslashEntryKey("c", "ts"), twoslashEntryKey("c", "ts", {}));
	});
});

describe("twoslashBlobKey", () => {
	it("namespaces by format version so an older blob is never read back", () => {
		assert.strictEqual(twoslashBlobKey("abc"), "twoslash/v1/abc");
	});
});

describe("makeTwoslashCache", () => {
	it("misses on an empty cache", () => {
		const cache = makeTwoslashCache();

		assert.isNull(cache.read("const a = 1", "ts"));
		assert.deepInclude(cache.stats(), { hits: 0, misses: 1, entries: 0, dirty: false });
	});

	it("serves a written result back", () => {
		const cache = makeTwoslashCache();
		cache.write("const a = 1", result("const a = 1"), "ts");

		assert.deepInclude(cache.read("const a = 1", "ts"), { code: "const a = 1" });
		assert.deepInclude(cache.stats(), { hits: 1, misses: 0, entries: 1, dirty: true });
	});

	it("does not serve one block's result for different code", () => {
		const cache = makeTwoslashCache();
		cache.write("const a = 1", result("const a = 1"), "ts");

		assert.isNull(cache.read("const a = 2", "ts"));
	});

	it("serves entries restored from a previous build without marking dirty", () => {
		const seeded = makeTwoslashCache();
		seeded.write("const a = 1", result("const a = 1"), "ts");

		const restored = makeTwoslashCache(seeded.entries());

		assert.deepInclude(restored.read("const a = 1", "ts"), { code: "const a = 1" });
		// Nothing new was type-checked, so there is nothing to persist.
		assert.deepInclude(restored.stats(), { hits: 1, misses: 0, dirty: false });
	});

	it("does not serve a result across different compiler configurations", () => {
		const cache = makeTwoslashCache();
		cache.write("const a = 1", result("strict"), "ts", { compilerOptions: { strict: true } } as never);

		// Same code, different configuration: the stored types may not apply.
		assert.isNull(cache.read("const a = 1", "ts", { compilerOptions: { strict: false } } as never));
		assert.deepInclude(cache.read("const a = 1", "ts", { compilerOptions: { strict: true } } as never), {
			code: "strict",
		});
	});

	it("keeps only the fields Shiki consumes", () => {
		const cache = makeTwoslashCache();
		cache.write("code", { nodes: [], code: "code", meta: { extension: "tsx" }, extra: "dropped" } as never, "ts");

		assert.deepStrictEqual([...cache.entries().values()][0], { nodes: [], code: "code", meta: { extension: "tsx" } });
	});

	it("omits meta when the run carried no extension", () => {
		const cache = makeTwoslashCache();
		cache.write("code", result("code"), "ts");

		assert.notProperty([...cache.entries().values()][0], "meta");
	});
});

describe("encode/decode round trip", () => {
	it("restores every entry", () => {
		const cache = makeTwoslashCache();
		cache.write("const a = 1", result("const a = 1"), "ts");
		cache.write("const b = 2", result("const b = 2"), "ts");

		const restored = decodeTwoslashCache(encodeTwoslashCache(cache.entries()));

		assert.strictEqual(restored.size, 2);
		assert.deepInclude(restored.get(twoslashEntryKey("const a = 1", "ts")), { code: "const a = 1" });
	});

	it("compresses, so a large generation does not bloat the store", () => {
		const cache = makeTwoslashCache();
		for (let i = 0; i < 200; i++) {
			cache.write(`const x${i} = 1`, result(`const x${i} = 1`), "ts");
		}

		const raw = JSON.stringify(Object.fromEntries(cache.entries())).length;
		assert.isBelow(encodeTwoslashCache(cache.entries()).byteLength, raw / 2);
	});

	it("treats a corrupt blob as a cold cache rather than failing the build", () => {
		assert.deepStrictEqual(decodeTwoslashCache(new Uint8Array([1, 2, 3, 4])), new Map());
	});

	it("treats a well-formed but wrongly-shaped blob as cold", () => {
		// Valid gzip, valid JSON, wrong shape: an array where a record is expected.
		assert.deepStrictEqual(decodeTwoslashCache(gzipSync(Buffer.from("[]", "utf-8"))), new Map());
	});
});
