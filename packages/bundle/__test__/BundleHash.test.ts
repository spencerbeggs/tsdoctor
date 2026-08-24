import { assert, describe, it } from "@effect/vitest";
import {
	canonicalJson,
	fingerprintResolvedBundle,
	hashJsonValue,
	hashLayerText,
	hashText,
	normalizeText,
	resolveBundle,
	sha256Hex,
} from "../src/index.js";

describe("canonicalJson", () => {
	it("sorts object keys recursively", () => {
		assert.strictEqual(canonicalJson({ b: 1, a: { d: 2, c: 3 } }), '{"a":{"c":3,"d":2},"b":1}');
	});

	it("drops undefined-valued keys and preserves array order", () => {
		assert.strictEqual(canonicalJson({ b: undefined, a: [3, 1, 2] }), '{"a":[3,1,2]}');
	});

	it("serializes undefined array items as null, matching JSON.stringify", () => {
		assert.strictEqual(canonicalJson([1, undefined, 2]), "[1,null,2]");
	});
});

describe("hashing determinism", () => {
	it("key order does not change the JSON hash", () => {
		assert.strictEqual(hashJsonValue({ a: 1, b: 2 }), hashJsonValue({ b: 2, a: 1 }));
	});

	it("line endings do not change the text hash", () => {
		assert.strictEqual(hashText("a\r\nb\r\nc\n"), hashText("a\nb\nc"));
		assert.strictEqual(normalizeText("a\rb\r\nc  \n"), "a\nb\nc");
	});

	it("different content produces a different hash", () => {
		assert.notStrictEqual(hashText("a"), hashText("b"));
		assert.notStrictEqual(hashJsonValue({ a: 1 }), hashJsonValue({ a: 2 }));
	});

	it("sha256Hex is the plain SHA-256 of the input", () => {
		// Known vector: sha256("") — guards against accidental double-normalization.
		assert.strictEqual(sha256Hex(""), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
	});
});

describe("hashLayerText", () => {
	it("JSON formatting and key-order churn does not read as change", () => {
		assert.strictEqual(hashLayerText('{\n  "b": 1,\n  "a": 2\n}'), hashLayerText('{"a":2,"b":1}'));
	});

	it("non-JSON text still hashes, via text normalization", () => {
		assert.strictEqual(hashLayerText("not json\r\n"), hashText("not json"));
	});
});

describe("fingerprintResolvedBundle", () => {
	const apiModel = { name: "pkg" };

	it("fingerprints every present field and omits absent ones", () => {
		const fingerprints = fingerprintResolvedBundle(resolveBundle({ apiModel }));
		assert.deepStrictEqual(Object.keys(fingerprints), ["name"]);
	});

	it("is deterministic for an identical resolution", () => {
		const a = fingerprintResolvedBundle(resolveBundle({ apiModel, platform: { tagline: "t" } }));
		const b = fingerprintResolvedBundle(resolveBundle({ apiModel, platform: { tagline: "t" } }));
		assert.deepStrictEqual(a, b);
	});

	it("a provenance flip with an unchanged value still changes the fingerprint", () => {
		// Same tagline value supplied by two different tiers: the {value, source}
		// pair is what gets hashed, so the override flip is a visible diff.
		const fromPlatform = fingerprintResolvedBundle(resolveBundle({ apiModel, platform: { tagline: "same" } }));
		const inferredEquivalent = {
			name: { value: "pkg", source: "apiModel" },
			tagline: { value: "same", source: "manifest.leaf" },
		} as const;
		const flipped = fingerprintResolvedBundle(inferredEquivalent);
		assert.strictEqual(fromPlatform["name"], flipped["name"]);
		assert.notStrictEqual(fromPlatform["tagline"], flipped["tagline"]);
	});
});
