/**
 * Format an API Extractor `Excerpt` into a clean, line-wrapped type signature
 * string, and optionally inject cross-links driven by canonical references.
 * Pure.
 *
 * @packageDocumentation
 */

import type { Excerpt } from "@microsoft/api-extractor-model";

import { escapeRegExp } from "./internal/text.js";

/**
 * Options for {@link format}.
 *
 * @public
 */
export interface FormatOptions {
	/** Wrap long union/intersection lines beyond this length. Default 80. */
	readonly maxLineLength?: number;
	/** Continuation-line indent. Default two spaces. */
	readonly indent?: string;
}

/**
 * Strip `export` / `declare` modifiers from a declaration text.
 *
 * @public
 */
export function stripExportDeclare(text: string): string {
	let result = text
		.trim()
		.replace(/^export\s+declare\s+/i, "")
		.replace(/^export\s+/i, "")
		.replace(/^declare\s+/i, "");
	result = result
		.replace(/\bexport\s+declare\s+/gi, "")
		.replace(/\bexport\s+/gi, "")
		.replace(/\bdeclare\s+/gi, "");
	return result;
}

function needsSpaceBefore(prevText: string, currentText: string): boolean {
	if (/\s$/.test(prevText)) return false;
	if (/^\s/.test(currentText)) return false;
	if (currentText.trim().startsWith("<")) return false;
	if (currentText.trim().match(/^[,;]/)) return false;
	if (prevText.trim().endsWith(",")) return true;
	if (currentText.trim() === "=" || currentText.trim().startsWith("=")) return true;
	if (prevText.trim().endsWith("=")) return true;
	if (currentText.trim() === "|" || currentText.trim() === "&") return true;
	if (prevText.trim() === "|" || prevText.trim() === "&") return true;
	if (prevText.trim() === "{" && currentText.trim() !== "}") return true;
	if (currentText.trim() === "}" && prevText.trim() !== "{") return true;
	if (prevText.trim().match(/^[[(]$/)) return false;
	if (currentText.trim().match(/^[\])]$/)) return false;
	if (prevText.trim().endsWith(":")) return true;
	if (prevText.trim().endsWith("?:")) return true;
	if (currentText.trim().startsWith(":") && !prevText.trim().match(/[,;:?]$/)) return false;
	if (currentText.trim().startsWith("{") && /[a-zA-Z0-9_>]$/.test(prevText.trim())) return true;
	const prevEndsAlnum = /[a-zA-Z0-9_>]$/.test(prevText.trim());
	const currStartsAlnum = /^[a-zA-Z0-9_<]/.test(currentText.trim());
	return prevEndsAlnum && currStartsAlnum;
}

/**
 * Format an API Extractor `Excerpt` into a clean type signature string,
 * wrapping long top-level unions/intersections.
 *
 * @public
 */
export function format(excerpt: Excerpt, options?: FormatOptions): string {
	const maxLineLength = options?.maxLineLength ?? 80;
	const indent = options?.indent ?? "  ";

	if (!excerpt.spannedTokens || excerpt.spannedTokens.length === 0) {
		return stripExportDeclare(excerpt.text);
	}

	const tokens = excerpt.spannedTokens;
	let currentLine = "";
	const lines: string[] = [];
	let bracketDepth = 0;
	let lastTokenText = "";

	for (let i = 0; i < tokens.length; i++) {
		let tokenText = tokens[i].text;
		if (i === 0) tokenText = stripExportDeclare(tokenText);
		if (tokenText.trim() === "") continue;

		if (tokenText === "{" || tokenText === "[" || tokenText === "(") bracketDepth++;
		else if (tokenText === "}" || tokenText === "]" || tokenText === ")") bracketDepth--;

		const isOperator = tokenText.trim() === "|" || tokenText.trim() === "&";

		if (lastTokenText && needsSpaceBefore(lastTokenText, tokenText)) currentLine += " ";
		currentLine += tokenText;
		lastTokenText = tokenText;

		if (isOperator && bracketDepth === 0 && currentLine.length > maxLineLength && i < tokens.length - 1) {
			lines.push(currentLine.trimEnd());
			currentLine = indent;
		}
	}
	if (currentLine.trim()) lines.push(currentLine.trimEnd());

	// No wrap needed: the first pass already assembled the single line.
	if (lines.length <= 1) return lines.length === 1 ? lines[0].trimStart() : "";

	return stripExportDeclare(lines.join("\n"));
}

/**
 * Inject markdown cross-links into already-formatted signature text. Reference
 * tokens in the excerpt whose canonical reference appears in
 * `routesByCanonicalRef` have their display text wrapped in a markdown link.
 *
 * @public
 */
export function linkReferences(
	text: string,
	excerpt: Excerpt,
	routesByCanonicalRef: ReadonlyMap<string, string>,
): string {
	if (!excerpt.spannedTokens || routesByCanonicalRef.size === 0) {
		return text;
	}

	const typeReferences = new Map<string, string>();
	for (const token of excerpt.spannedTokens) {
		if (token.kind === "Reference" && token.canonicalReference) {
			const canonicalRef = token.canonicalReference.toString();
			const route = routesByCanonicalRef.get(canonicalRef);
			if (route && token.text) {
				typeReferences.set(token.text.trim(), route);
			}
		}
	}

	let result = text;
	for (const [typeName, route] of typeReferences.entries()) {
		const regex = new RegExp(`\\b${escapeRegExp(typeName)}\\b`, "g");
		result = result.replace(regex, `[${typeName}](${route})`);
	}
	return result;
}
