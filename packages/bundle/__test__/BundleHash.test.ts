import { NodeCrypto } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import { JsoncFingerprint } from "@effected/jsonc";
import { Effect, Result } from "effect";
import {
	fingerprintResolvedBundle,
	hashJsonValue,
	hashLayerText,
	hashText,
	normalizeText,
	resolveBundle,
} from "../src/index.js";

const CryptoLive = NodeCrypto.layer;

describe("canonicalization (via @effected/jsonc JsoncFingerprint)", () => {
	it("sorts object keys recursively", () => {
		const result = JsoncFingerprint.canonicalizeResult({ b: 1, a: { d: 2, c: 3 } });
		assert.isTrue(Result.isSuccess(result));
		assert.strictEqual(Result.getOrThrow(result), '{"a":{"c":3,"d":2},"b":1}');
	});

	it("an undefined-valued member fails typed instead of being silently dropped", () => {
		const result = JsoncFingerprint.canonicalizeResult({ b: undefined, a: [3, 1, 2] });
		assert.isTrue(Result.isFailure(result));
	});
});

describe("hashing determinism", () => {
	it.effect("key order does not change the JSON hash", () =>
		Effect.gen(function* () {
			const a = yield* hashJsonValue({ a: 1, b: 2 });
			const b = yield* hashJsonValue({ b: 2, a: 1 });
			assert.strictEqual(a, b);
		}).pipe(Effect.provide(CryptoLive)),
	);

	it.effect("line endings do not change the text hash", () =>
		Effect.gen(function* () {
			const a = yield* hashText("a\r\nb\r\nc\n");
			const b = yield* hashText("a\nb\nc");
			assert.strictEqual(a, b);
			assert.strictEqual(normalizeText("a\rb\r\nc  \n"), "a\nb\nc");
		}).pipe(Effect.provide(CryptoLive)),
	);

	it.effect("different content produces a different hash", () =>
		Effect.gen(function* () {
			assert.notStrictEqual(yield* hashText("a"), yield* hashText("b"));
			assert.notStrictEqual(yield* hashJsonValue({ a: 1 }), yield* hashJsonValue({ a: 2 }));
		}).pipe(Effect.provide(CryptoLive)),
	);

	it.effect("hashes are lowercase 64-hex SHA-256 digests", () =>
		Effect.gen(function* () {
			const digest = yield* hashText("known input");
			assert.match(digest, /^[0-9a-f]{64}$/);
		}).pipe(Effect.provide(CryptoLive)),
	);
});

describe("hashLayerText", () => {
	it.effect("JSON formatting and key-order churn does not read as change", () =>
		Effect.gen(function* () {
			const a = yield* hashLayerText('{\n  "b": 1,\n  "a": 2\n}');
			const b = yield* hashLayerText('{"a":2,"b":1}');
			assert.strictEqual(a, b);
		}).pipe(Effect.provide(CryptoLive)),
	);

	it.effect("non-JSON text still hashes, via text normalization", () =>
		Effect.gen(function* () {
			const layer = yield* hashLayerText("not json\r\n");
			const text = yield* hashText("not json");
			assert.strictEqual(layer, text);
		}).pipe(Effect.provide(CryptoLive)),
	);
});

describe("fingerprintResolvedBundle", () => {
	const apiModel = { name: "pkg" };

	it.effect("fingerprints every present field and omits absent ones", () =>
		Effect.gen(function* () {
			const fingerprints = yield* fingerprintResolvedBundle(resolveBundle({ apiModel }));
			assert.deepStrictEqual(Object.keys(fingerprints), ["name"]);
		}).pipe(Effect.provide(CryptoLive)),
	);

	it.effect("is deterministic for an identical resolution", () =>
		Effect.gen(function* () {
			const a = yield* fingerprintResolvedBundle(resolveBundle({ apiModel, platform: { tagline: "t" } }));
			const b = yield* fingerprintResolvedBundle(resolveBundle({ apiModel, platform: { tagline: "t" } }));
			assert.deepStrictEqual(a, b);
		}).pipe(Effect.provide(CryptoLive)),
	);

	it.effect("a provenance flip with an unchanged value still changes the fingerprint", () =>
		Effect.gen(function* () {
			// Same tagline value supplied by two different tiers: the {value, source}
			// pair is what gets hashed, so the override flip is a visible diff.
			const fromPlatform = yield* fingerprintResolvedBundle(resolveBundle({ apiModel, platform: { tagline: "same" } }));
			const inferredEquivalent = {
				name: { value: "pkg", source: "apiModel" },
				tagline: { value: "same", source: "manifest.leaf" },
			} as const;
			const flipped = yield* fingerprintResolvedBundle(inferredEquivalent);
			assert.strictEqual(fromPlatform.name, flipped.name);
			assert.notStrictEqual(fromPlatform.tagline, flipped.tagline);
		}).pipe(Effect.provide(CryptoLive)),
	);
});
