/**
 * Helper utilities for generating markdown API documentation.
 *
 * This module provides shared utility functions used by the page generators
 * for common tasks like preparing Twoslash examples, generating frontmatter,
 * escaping special characters, and sanitizing IDs.
 *
 * @packageDocumentation
 */

import type { HeadTag } from "@tsdoctor/seo";
import { emitFrontmatterBlock } from "../frontmatter.js";
import { formatCode } from "../prettier-formatter.js";
import { classifyCutDirective, isTwoslashDirective } from "../twoslash-patterns.js";
import type { ImportStatement } from "../type-reference-extractor.js";
import { TypeReferenceExtractor } from "../type-reference-extractor.js";

/**
 * Generate an "Available from" line for items exported from multiple entry points.
 * Returns empty string if only one entry point or none provided.
 */
export function generateAvailableFrom(packageName: string, availableFrom?: string[]): string {
	if (!availableFrom || availableFrom.length <= 1) {
		return "";
	}
	const paths = availableFrom
		.map((ep) => (ep === "default" ? `\`${packageName}\`` : `\`${packageName}/${ep}\``))
		.join(", ");
	return `Available from: ${paths}\n\n`;
}

/**
 * Prepare example code for Twoslash rendering.
 *
 * Prepares the code with imports and error directives but does NOT render HTML.
 * Use this for raw markdown output or as input to pre-rendering.
 *
 * @param example - The example with language and code
 * @param apiItemName - The name of the API item being documented
 * @param packageName - The package name for imports
 * @param suppressErrors - Whether to suppress all TypeScript errors (default: true)
 * @returns Object with prepared code and whether it's TypeScript
 */
export function prepareExampleCode(
	example: { language: string; code: string },
	apiItemName: string,
	packageName: string,
	suppressErrors: boolean = true,
): { code: string; isTypeScript: boolean; language: string } {
	const { language, code } = example;

	// Only process TypeScript/JavaScript examples with VFS support
	const isTypeScript = language === "typescript" || language === "ts" || language === "javascript" || language === "js";

	if (!isTypeScript) {
		return { code, isTypeScript: false, language };
	}

	// Add import line for the package at the top if not already present
	// Check for both single and double quotes since TSDoc examples may use either
	const importLine = `import { ${apiItemName} } from "${packageName}";`;
	const hasImport = code.includes(`from "${packageName}"`) || code.includes(`from '${packageName}'`);
	const finalCode = hasImport ? code : `${importLine}\n${code}`;

	// Add @noErrors directive if error suppression is enabled
	const errorDirective = suppressErrors ? "// @noErrors\n" : "";

	return { code: `${errorDirective}${finalCode}`, isTypeScript: true, language: "typescript" };
}

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
 * Escape generic type parameters in MDX by wrapping them in backticks.
 *
 * Prevents MDX from interpreting `<T>`, `<TEnv>`, etc. as JSX tags by
 * wrapping them in inline code backticks.
 *
 * @param text - The text containing generic type parameters
 * @returns Text with generics wrapped in backticks
 *
 * @example
 * ```ts
 * escapeMdxGenerics("Returns Promise<T>");        // "Returns Promise`<T>`"
 * escapeMdxGenerics("Map<K, V> extends...");      // "Map`<K, V>` extends..."
 * escapeMdxGenerics("`Pipeline<I, O>`");           // "`Pipeline<I, O>`" (unchanged)
 * ```
 */
export function escapeMdxGenerics(text: string): string {
	// Split on backtick code spans so we only escape generics in plain text
	const parts = text.split(/(`[^`]+`)/g);
	return parts
		.map((part) => {
			// Parts matching the capture group are code spans — leave them alone
			if (part.startsWith("`") && part.endsWith("`")) {
				return part;
			}
			return part.replace(
				/<([A-Z][A-Za-z0-9_]*(?:\s+extends\s+[^>]+)?(?:,\s*[A-Z][A-Za-z0-9_]*(?:\s+extends\s+[^>]+)?)*)>/g,
				"`<$1>`",
			);
		})
		.join("");
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

/**
 * Strip Twoslash directives from code for display purposes.
 *
 * Removes Twoslash directive comments like `// @noErrors`, `// @errors: 2304`,
 * `// @filename: ...`, etc. from code so users see clean output and don't
 * copy directives when using the copy button.
 *
 * Also handles cut directives:
 * - `// ---cut---` - Removes this line and all lines before it
 * - `// ---cut-before---` - Same as ---cut---
 * - `// ---cut-after---` - Removes this line and all lines after it
 *
 * @param code - The code containing Twoslash directives
 * @returns Code with Twoslash directives removed
 *
 * @example
 * ```ts
 * const display = stripTwoslashDirectives("// @noErrors\nconst x = 1;");
 * // Returns: "const x = 1;"
 * ```
 */
export function stripTwoslashDirectives(code: string): string {
	const lines = code.split("\n");

	// Find cut directive indices using upstream-compatible regex patterns.
	// Handles both spaced (`// ---cut---`) and unspaced (`//---cut---`) variants,
	// as well as cut-start/cut-end range markers.
	let cutBeforeIndex = -1;
	let cutAfterIndex = -1;
	const cutRanges: Array<[start: number, end: number]> = [];
	const cutStartStack: number[] = [];

	for (let i = 0; i < lines.length; i++) {
		const trimmed = lines[i].trim();
		const cutType = classifyCutDirective(trimmed);
		if (cutType === "cut-before") {
			cutBeforeIndex = i;
		} else if (cutType === "cut-after") {
			cutAfterIndex = i;
		} else if (cutType === "cut-start") {
			cutStartStack.push(i);
		} else if (cutType === "cut-end") {
			const startIdx = cutStartStack.pop();
			if (startIdx !== undefined) {
				cutRanges.push([startIdx, i]);
			}
		}
	}

	// Apply cut-before: remove everything up to and including the cut line
	let filteredLines = lines;
	if (cutBeforeIndex >= 0) {
		filteredLines = filteredLines.slice(cutBeforeIndex + 1);
		// Adjust subsequent indices
		if (cutAfterIndex >= 0) {
			cutAfterIndex = cutAfterIndex - cutBeforeIndex - 1;
		}
		for (const range of cutRanges) {
			range[0] -= cutBeforeIndex + 1;
			range[1] -= cutBeforeIndex + 1;
		}
	}

	// Apply cut-after: remove everything from the cut line onwards
	if (cutAfterIndex >= 0) {
		filteredLines = filteredLines.slice(0, cutAfterIndex);
	}

	// Build a set of line indices to exclude from cut-start/cut-end ranges
	const excludedLines = new Set<number>();
	for (const [start, end] of cutRanges) {
		for (let i = start; i <= end; i++) {
			if (i >= 0 && i < filteredLines.length) {
				excludedLines.add(i);
			}
		}
	}

	// Filter out cut-start/cut-end ranges and remaining directive lines.
	// Uses the shared isTwoslashDirective() which covers:
	// - Config: // @noErrors, //@strict, // @errors: 2304, // @filename: foo.ts
	// - Annotations: // ^?, //   ^?, // ^|, // ^^^, // ^^^^ description
	// - Cut: // ---cut---, //---cut-before---, etc.
	return filteredLines
		.filter((line, i) => {
			if (excludedLines.has(i)) return false;
			const trimmed = line.trim();
			if (isTwoslashDirective(trimmed)) return false;
			return true;
		})
		.join("\n")
		.trim();
}

/**
 * Format import statements with cut directive for hidden imports.
 *
 * Prepends import statements followed by `// ---cut---` so Twoslash can
 * resolve the types but the imports are hidden from rendered output.
 *
 * @param imports - Import statements to format
 * @returns Formatted import block with cut directive, or empty string if no imports
 *
 * @example
 * ```ts
 * const imports = [{ packageName: "zod", symbols: new Set(["ZodType"]), typeOnly: true }];
 * const block = formatImportsWithCut(imports);
 * // Returns:
 * // import type { ZodType } from "zod";
 * // // ---cut---
 * ```
 */
function formatImportsWithCut(imports: ImportStatement[]): string {
	if (imports.length === 0) {
		return "";
	}
	const formatted = TypeReferenceExtractor.formatImports(imports);
	return `${formatted.join("\n")}\n// ---cut---\n`;
}

/**
 * Prepend hidden imports to code using the Twoslash cut directive.
 *
 * This enables type resolution for external types while hiding the import
 * statements from rendered output. The existing `stripTwoslashDirectives()`
 * function handles removing the cut block for clipboard copying.
 *
 * @param code - The code to prepend imports to
 * @param imports - Import statements to add
 * @returns Code with imports prepended (if any), or original code if no imports
 *
 * @example
 * ```ts
 * const code = "function foo(): RsbuildPlugin";
 * const imports = [{ packageName: "@rsbuild/core", symbols: new Set(["RsbuildPlugin"]), typeOnly: true }];
 * const result = prependHiddenImports(code, imports);
 * // Returns:
 * // import type { RsbuildPlugin } from "@rsbuild/core";
 * // // ---cut---
 * // function foo(): RsbuildPlugin
 * ```
 */
export function prependHiddenImports(code: string, imports: ImportStatement[]): string {
	const importBlock = formatImportsWithCut(imports);
	return importBlock ? importBlock + code : code;
}

/**
 * Format example code using Prettier for consistent styling.
 *
 * Wraps the Prettier formatter with error handling and context tracking.
 * If formatting fails, returns the original code (fallthrough behavior).
 *
 * @param code - The code to format
 * @param language - The code fence language (e.g., "typescript", "ts")
 * @param _context - Optional context (reserved for future use)
 * @returns The formatted code (or original if formatting fails)
 */
export async function formatExampleCode(
	code: string,
	language: string,
	_context?: { file?: string; api?: string; blockType?: string },
): Promise<string> {
	const result = await formatCode(code, language);

	return result.code;
}
