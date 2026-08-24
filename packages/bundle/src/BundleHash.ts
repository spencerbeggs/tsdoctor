import { createHash } from "node:crypto";
import type { ResolvedBundle } from "./BundleResolver.js";

/**
 * Serialize a JSON-shaped value canonically: object keys sorted recursively,
 * `undefined`-valued keys dropped, arrays in declared order, no whitespace.
 *
 * @remarks
 * The normalization half of the change-detection discipline: two values that
 * differ only in key order or optional-key presence-as-`undefined` serialize
 * identically, so their hashes match. Non-JSON leaves (functions, symbols)
 * serialize as `null`, matching `JSON.stringify` semantics inside arrays.
 *
 * @public
 */
export function canonicalJson(value: unknown): string {
	if (value === null || typeof value === "boolean" || typeof value === "number" || typeof value === "string") {
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map((item) => canonicalJson(item === undefined ? null : item)).join(",")}]`;
	}
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const keys = Object.keys(record)
			.filter((key) => record[key] !== undefined)
			.sort();
		return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
	}
	return "null";
}

/**
 * Normalize text for hashing: CRLF/CR line endings become LF and trailing
 * whitespace at the end of the content is trimmed.
 *
 * @remarks
 * The same file checked out with different line-ending settings must hash
 * identically — coarse layer-hash comparison otherwise reports every file
 * changed on the first cross-platform build.
 *
 * @public
 */
export function normalizeText(text: string): string {
	return text.replace(/\r\n?/g, "\n").trimEnd();
}

/**
 * The lowercase hex SHA-256 of a string, UTF-8 encoded.
 *
 * @public
 */
export function sha256Hex(text: string): string {
	return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Hash text content: {@link normalizeText} then {@link sha256Hex}.
 *
 * @public
 */
export function hashText(text: string): string {
	return sha256Hex(normalizeText(text));
}

/**
 * Hash a JSON-shaped value: {@link canonicalJson} then {@link sha256Hex}.
 *
 * @public
 */
export function hashJsonValue(value: unknown): string {
	return sha256Hex(canonicalJson(value));
}

/**
 * Hash one bundle layer file's raw text — the COARSE half of change
 * detection (all layer hashes match → skip resolution entirely).
 *
 * @remarks
 * Total: text that parses as JSON hashes canonically (key order and
 * formatting churn do not read as change); text that does not parse falls
 * back to {@link hashText}, so a broken file still gets a stable hash
 * rather than an error — hashing is bookkeeping, not validation.
 *
 * @public
 */
export function hashLayerText(text: string): string {
	try {
		return hashJsonValue(JSON.parse(text));
	} catch {
		return hashText(text);
	}
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
 * @public
 */
export function fingerprintResolvedBundle(resolved: ResolvedBundle): Readonly<Record<string, string>> {
	const fingerprints: Record<string, string> = {};
	const fields: Readonly<Record<string, unknown>> = { ...resolved };
	for (const key of Object.keys(fields).sort()) {
		const field = fields[key];
		if (field !== undefined) {
			fingerprints[key] = hashJsonValue(field);
		}
	}
	return fingerprints;
}
