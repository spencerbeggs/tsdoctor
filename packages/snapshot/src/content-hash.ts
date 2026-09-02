import { createHash } from "node:crypto";
import { JsoncFingerprint } from "@effected/jsonc";
import { Result } from "effect";

/**
 * Normalizes content string for consistent hashing.
 *
 * @remarks
 * Applies the following transformations:
 * - Converts all line endings to Unix-style (`\n`)
 * - Trims leading and trailing whitespace
 * - Collapses multiple consecutive blank lines to a single blank line
 *
 * @param content - The content string to normalize
 * @returns Normalized content string
 *
 * @example
 * ```typescript
 * import { normalizeContent } from "@tsdoctor/snapshot";
 *
 * const normalized = normalizeContent("line1\r\n\r\n\r\nline2  ");
 * // => "line1\n\nline2"
 * ```
 *
 * @public
 */
export function normalizeContent(content: string): string {
	return (
		content
			// Normalize line endings to \n
			.replaceAll("\r\n", "\n")
			.replaceAll("\r", "\n")
			// Trim leading and trailing whitespace
			.trim()
			// Collapse multiple consecutive blank lines to single blank line
			.replaceAll(/\n{3,}/g, "\n\n")
	);
}

/**
 * Generates a SHA-256 hash of normalized markdown content.
 *
 * @remarks
 * The content is normalized before hashing to ensure consistent results
 * regardless of line ending differences or trailing whitespace.
 *
 * @param content - The markdown content to hash (excluding frontmatter)
 * @returns Hexadecimal SHA-256 hash string
 *
 * @example
 * ```typescript
 * import { hashContent } from "@tsdoctor/snapshot";
 *
 * const hash = hashContent("# My Title\n\nContent here");
 * ```
 *
 * @public
 */
export function hashContent(content: string): string {
	const normalized = normalizeContent(content);
	return createHash("sha256").update(normalized).digest("hex");
}

const TIMESTAMP_KEYS = new Set(["publishedTime", "modifiedTime", "article:published_time", "article:modified_time"]);

const JSON_LD_DATE_KEYS = new Set(["datePublished", "dateModified", "uploadDate"]);

const JSON_LD_BODY_KEYS = new Set(["children", "innerHTML", "textContent"]);

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Strips a JSON-LD script body of its date fields.
 *
 * @remarks
 * The body arrives as a string, so it must be parsed before its dates can be
 * removed. A body that does not parse as JSON is returned unchanged rather
 * than throwing — an unparseable body is still content worth hashing.
 */
function stripJsonLdBody(body: string): string {
	let parsed: unknown;
	try {
		parsed = JSON.parse(body);
	} catch {
		return body;
	}
	return JSON.stringify(stripTimestamps(parsed));
}

/**
 * Recursively removes timestamp-valued entries from a frontmatter value.
 *
 * @remarks
 * Timestamps appear in two shapes. In the meta-pair form the value lives in a
 * `content` field whose sibling `property`/`name` names a timestamp
 * (`article:published_time`, `article:modified_time`). In the JSON-LD form it
 * is an object key (`datePublished`, `dateModified`) inside a script body.
 * Both are stripped; everything else survives so that an `og:image`,
 * `og:description`, canonical `href` or JSON-LD version change is visible to
 * change detection.
 *
 * The walk must be recursive: `head` is an array of `[tagName, attrs]` pairs,
 * so a shallow pass would see nothing.
 */
function stripTimestamps(value: unknown): unknown {
	if (Array.isArray(value)) {
		return value.map(stripTimestamps);
	}
	if (!isRecord(value)) {
		return value;
	}

	const property = value["property"] ?? value["name"];
	const isTimestampTag = typeof property === "string" && TIMESTAMP_KEYS.has(property);
	const isJsonLd = value["type"] === "application/ld+json";

	const result: Record<string, unknown> = {};
	for (const key of Object.keys(value).sort()) {
		if (JSON_LD_DATE_KEYS.has(key)) {
			continue;
		}
		if (isTimestampTag && key === "content") {
			continue;
		}
		const entry = value[key];
		if (isJsonLd && JSON_LD_BODY_KEYS.has(key) && typeof entry === "string") {
			result[key] = stripJsonLdBody(entry);
			continue;
		}
		result[key] = stripTimestamps(entry);
	}
	return result;
}

/**
 * Generates a SHA-256 hash of frontmatter fields.
 *
 * @remarks
 * Excludes the top-level timestamp fields (`publishedTime`, `modifiedTime`,
 * `article:published_time`, `article:modified_time`) to prevent circular
 * dependencies in change detection, and strips timestamp-valued entries
 * recursively from every remaining value — including the `head` array's meta
 * pairs and the date fields inside a JSON-LD script body. Everything else in
 * `head` participates in the hash, so an `og:image`, `og:description` or
 * canonical URL change marks the page modified. Keys are sorted
 * alphabetically before hashing to ensure consistent results regardless of
 * object key order.
 *
 * @param frontmatter - The frontmatter object to hash
 * @returns Hexadecimal SHA-256 hash string
 *
 * @example
 * ```typescript
 * import { hashFrontmatter } from "@tsdoctor/snapshot";
 *
 * const hash = hashFrontmatter({
 *   title: "My Page",
 *   description: "Page description"
 * });
 * ```
 *
 * @public
 */
export function hashFrontmatter(frontmatter: Record<string, unknown>): string {
	// Create a copy without the top-level timestamp fields, with every
	// surviving value stripped of nested timestamps.
	const filtered: Record<string, unknown> = {};

	for (const key of Object.keys(frontmatter).sort()) {
		if (TIMESTAMP_KEYS.has(key)) {
			continue;
		}
		filtered[key] = stripTimestamps(frontmatter[key]);
	}

	// RFC 8785 (JCS) canonicalization, the same spelling `@tsdoctor/bundle`
	// fingerprints through. `JSON.stringify` is not a canonical form: it drops
	// `undefined` and turns `NaN` into `null` silently, and its number and
	// string escaping are not JCS's. A fingerprint of a silently altered
	// document is a lie, so a value that cannot be canonicalized fails loudly
	// here rather than hashing something the document did not say.
	const canonical = JsoncFingerprint.canonicalizeResult(filtered);
	if (Result.isFailure(canonical)) {
		throw new Error(`Frontmatter cannot be canonicalized for hashing: ${canonical.failure.message}`);
	}
	return createHash("sha256").update(canonical.success).digest("hex");
}
