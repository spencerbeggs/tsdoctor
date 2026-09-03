/**
 * Frontmatter assembly for generated pages: the structured title and the
 * rendering of neutral `@tsdoctor/seo` head tags into RSPress `head` pairs.
 *
 * @remarks
 * This stays adapter-side on purpose. The snapshot frontmatter hash is
 * taken over the FINAL assembled block in the generate stage, and the
 * `children` spelling for a JSON-LD script body is RSPress's — the IR
 * carries facts and a `HeadTag[]`, not a frontmatter block.
 *
 * @packageDocumentation
 */

import { emitFrontmatterBlock } from "@tsdoctor/model";
import type { HeadTag } from "@tsdoctor/seo";

/**
 * Collapse newlines and runs of whitespace to single spaces, and trim.
 *
 * @remarks
 * Applied to every frontmatter scalar before emission. This is NOT quoting —
 * `@effected/yaml` owns that — it is whitespace normalization, and it is
 * load-bearing: the snapshot system hashes the PARSED frontmatter, so a value
 * that folds differently between builds would churn the hash. Survives the
 * removal of `escapeYamlString`, which was its other caller.
 */
function cleanYamlValue(value: string): string {
	return value
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Build a structured page title for API documentation.
 *
 * Creates a title in the format: `{entityName} | {singularName} | API | {apiName}`
 *
 * @param entityName - The specific entity name (e.g., "MyClass")
 * @param singularName - The category singular name (e.g., "Class")
 * @param apiName - Optional API/package display name
 * @returns Formatted page title
 *
 * @example
 * ```ts
 * buildPageTitle("MyClass", "Class", "My Package");
 * // Returns: "MyClass | Class | API | My Package"
 * ```
 */
function buildPageTitle(entityName: string, singularName: string, apiName?: string): string {
	const parts = [entityName, singularName, "API"];
	if (apiName) {
		parts.push(apiName);
	}
	return parts.join(" | ");
}

/**
 * Generate markdown frontmatter with optional Open Graph metadata.
 *
 * Creates YAML frontmatter for MDX files including title, description,
 * and comprehensive Open Graph meta tags for social sharing.
 *
 * @param entityName - The specific entity name (e.g., "MyClass")
 * @param description - Page description for SEO
 * @param singularName - The category singular name (e.g., "Class")
 * @param apiName - Optional API/package display name
 * @param tags - Optional neutral head tags to render into the `head` array
 * @returns YAML frontmatter string
 *
 * @example
 * ```ts
 * const frontmatter = generateFrontmatter(
 *   "MyClass",
 *   "A utility class for...",
 *   "Class",
 *   "My Package"
 * );
 * // Returns:
 * // ---
 * // title: "MyClass | Class | API | My Package"
 * // description: "A utility class for..."
 * // ---
 * ```
 */
export function generateFrontmatter(
	entityName: string,
	description: string,
	singularName: string,
	apiName?: string,
	tags?: ReadonlyArray<HeadTag>,
): string {
	const title = buildPageTitle(entityName, singularName, apiName);

	// Every value is whitespace-normalized exactly as the previous hand-rolled
	// emitter did (via cleanYamlValue), so the PARSED data — and therefore
	// the snapshot frontmatter hash — is unchanged for tags that already
	// existed. Quoting/escaping is the emitter's job (@effected/yaml with all
	// string values double-quoted; see frontmatter.ts).
	//
	// `children` is the attribute name unhead maps onto innerHTML for a
	// <script> element, which is how a JSON-LD body reaches the page. RSPress
	// renders a head entry as React.createElement(tag, attrs); any other
	// spelling emits an empty <script> and fails silently in the browser
	// rather than in the build.
	const headEntries: [string, Record<string, string>][] = (tags ?? []).map((tag) => {
		const attrs: Record<string, string> = {};
		for (const [key, value] of Object.entries(tag.attrs)) {
			attrs[key] = cleanYamlValue(value);
		}
		if (tag.body != null) {
			attrs.children = cleanYamlValue(tag.body);
		}
		return [tag.tag, attrs];
	});

	const data: Record<string, unknown> = {
		title: cleanYamlValue(title),
		description: cleanYamlValue(description),
	};
	if (headEntries.length > 0) {
		data.head = headEntries;
	}

	return emitFrontmatterBlock(data);
}
