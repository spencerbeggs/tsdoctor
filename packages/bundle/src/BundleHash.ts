import type { JsoncCanonicalizeError } from "@effected/jsonc";
import { JsoncFingerprint } from "@effected/jsonc";
import type { Crypto, PlatformError } from "effect";
import { Effect } from "effect";
import type { ResolvedBundle } from "./BundleResolver.js";

/**
 * Normalize text for hashing: CRLF/CR line endings become LF and trailing
 * whitespace at the end of the content is trimmed.
 *
 * @remarks
 * The same file checked out with different line-ending settings must hash
 * identically — coarse layer-hash comparison otherwise reports every file
 * changed on the first cross-platform build. Line-ending normalization is
 * `@effected/jsonc`'s `JsoncFingerprint.normalizeEol`; the trailing trim is
 * this package's own policy on top.
 *
 * @public
 */
export function normalizeText(text: string): string {
	return JsoncFingerprint.normalizeEol(text).trimEnd();
}

/**
 * Hash text content: {@link normalizeText} then SHA-256 (lowercase hex).
 *
 * @remarks
 * Digesting runs through core's `Crypto` service (`JsoncFingerprint`), so
 * consumers provide a backend — `@effect/platform-node`'s
 * `NodeCrypto.layer` — at the edge, the same posture as this package's
 * `FileSystem | Path` requirements.
 *
 * @public
 */
export function hashText(text: string): Effect.Effect<string, PlatformError.PlatformError, Crypto.Crypto> {
	return JsoncFingerprint.hashText(normalizeText(text));
}

/**
 * Hash a JSON-shaped value: RFC 8785 (JCS) canonicalization then SHA-256.
 *
 * @remarks
 * Delegates to `@effected/jsonc`'s `JsoncFingerprint.hash`. Canonicalization
 * is strict by design: an `undefined`-valued member, a `Date`, or any other
 * non-plain object fails typed (`JsoncCanonicalizeError`) rather than being
 * silently dropped or coerced — a fingerprint of a silently altered document
 * lies. Schema-encode class instances to plain JSON before hashing.
 *
 * @public
 */
export function hashJsonValue(
	value: unknown,
): Effect.Effect<string, JsoncCanonicalizeError | PlatformError.PlatformError, Crypto.Crypto> {
	return JsoncFingerprint.hash(value);
}

/**
 * Hash one bundle layer file's raw text — the COARSE half of change
 * detection (all layer hashes match → skip resolution entirely).
 *
 * @remarks
 * Total in the error sense that matters here: text that parses as JSON
 * hashes canonically (key order and formatting churn do not read as
 * change); text that does not parse falls back to {@link hashText}, so a
 * broken file still gets a stable hash rather than an error — hashing is
 * bookkeeping, not validation. `JSON.parse` output is always plain
 * JSON-shaped, so a canonicalization failure on the parsed branch is a
 * defect, not a recoverable error.
 *
 * @public
 */
export function hashLayerText(text: string): Effect.Effect<string, PlatformError.PlatformError, Crypto.Crypto> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(text);
	} catch {
		return hashText(text);
	}
	return JsoncFingerprint.hash(parsed).pipe(Effect.catchTag("JsoncCanonicalizeError", (error) => Effect.die(error)));
}

/**
 * Fingerprint every present field of a {@link ResolvedBundle} — the FINE
 * half of change detection, hashing each field's `{ value, source }` pair.
 *
 * @remarks
 * The source participates deliberately: an override flip (a field moving
 * from `inferred` to an authored tier without changing value) is a
 * semantically meaningful change and must read as one. Absent fields carry
 * no fingerprint — their appearance or disappearance is itself the diff.
 * The consuming store maps each key to its invalidation scope (version →
 * version-embedding surfaces, tsconfig → all code blocks, …).
 *
 * Resolver output is plain JSON-shaped by construction (every value comes
 * from a `Schema.Struct` decode or a primitive derivation), so a
 * canonicalization failure here is a defect, not a recoverable error.
 *
 * @public
 */
export function fingerprintResolvedBundle(
	resolved: ResolvedBundle,
): Effect.Effect<Readonly<Record<string, string>>, PlatformError.PlatformError, Crypto.Crypto> {
	const fields: Readonly<Record<string, unknown>> = { ...resolved };
	const present = Object.keys(fields)
		.sort()
		.filter((key) => fields[key] !== undefined);
	return Effect.forEach(
		present,
		(key) =>
			JsoncFingerprint.hash(fields[key]).pipe(
				Effect.catchTag("JsoncCanonicalizeError", (error) => Effect.die(error)),
				Effect.map((hash) => [key, hash] as const),
			),
		{ concurrency: 1 },
	).pipe(Effect.map((entries) => Object.fromEntries(entries)));
}
