/**
 * Pure TSDoc + API-model documentation extraction. Each function reads
 * documentation off an `ApiItem` (or a raw TSDoc `DocNode`) and returns plain
 * data — no rendering, no I/O, no error channel: absence is `null` or empty,
 * never an error.
 *
 * @packageDocumentation
 */

import type { MarkdownNode, PhrasingContent } from "@effected/markdown";
import { Code, InlineCode, Link, Paragraph, Text } from "@effected/markdown";
import type { ApiItem } from "@microsoft/api-extractor-model";
import { ApiDocumentedItem, ApiReleaseTagMixin, ReleaseTag } from "@microsoft/api-extractor-model";
import type { DocNode } from "@microsoft/tsdoc";

/**
 * One documented parameter: the `@param` block merged with the declared type.
 *
 * @public
 */
export interface DocParam {
	readonly name: string;
	readonly type?: string;
	readonly description: string;
}

/**
 * One `@example` block's code (language defaults to `typescript`).
 *
 * @public
 */
export interface DocExample {
	readonly language: string;
	readonly code: string;
}

/**
 * TSDoc release tag names, with `"Public"` as the absent-tag default.
 *
 * @public
 */
export type ReleaseTagName = "Public" | "Beta" | "Alpha" | "Internal";

/**
 * Recursively flatten a TSDoc DocNode tree to plain text (code spans →
 * backticks, `{@link}` → display text, code fences dropped).
 *
 * @public
 */
export function plainText(node: DocNode): string {
	// biome-ignore lint/suspicious/noExplicitAny: TSDoc node internals require dynamic access
	const nodeAny = node as any;

	if (node.kind === "PlainText") return nodeAny.text || "";
	if (node.kind === "SoftBreak") return " ";
	if (node.kind === "CodeSpan") return `\`${nodeAny.code || ""}\``;
	if (node.kind === "LinkTag") {
		if (nodeAny.linkText) return plainText(nodeAny.linkText);
		const ref = nodeAny.codeDestination?.memberReferences?.[0]?.memberIdentifier;
		return ref?.identifier || "";
	}

	const parts: string[] = [];
	if (typeof nodeAny.getChildNodes === "function") {
		for (const child of nodeAny.getChildNodes() as DocNode[]) {
			const childText = plainText(child);
			if (childText) parts.push(childText);
		}
	}
	return parts.join("");
}

/**
 * Convert a TSDoc DocNode tree to markdown nodes, preserving structure the
 * plain-text flattener drops: code spans become {@link InlineCode}, url
 * `{@link}` tags become {@link Link} nodes, fenced code becomes {@link Code}
 * blocks. Code-destination `{@link}` tags (declaration references) flatten to
 * their display text — resolving them to URLs is the caller's cross-linking
 * concern, not this layer's.
 *
 * @public
 */
export function toMarkdown(node: DocNode): ReadonlyArray<MarkdownNode> {
	// biome-ignore lint/suspicious/noExplicitAny: TSDoc node internals require dynamic access
	const nodeAny = node as any;

	switch (node.kind) {
		case "Paragraph": {
			const children = inlineNodes(node);
			return children.length > 0 ? [new Paragraph({ children })] : [];
		}
		case "FencedCode":
			return [
				new Code({ value: String(nodeAny.code ?? "").replace(/\n$/, ""), lang: nodeAny.language || "typescript" }),
			];
		case "PlainText":
		case "SoftBreak":
		case "CodeSpan":
		case "LinkTag":
			return inlineNodes(node);
		default: {
			const out: MarkdownNode[] = [];
			if (typeof nodeAny.getChildNodes === "function") {
				for (const child of nodeAny.getChildNodes() as DocNode[]) {
					out.push(...toMarkdown(child));
				}
			}
			return out;
		}
	}
}

/** Map a TSDoc inline node (or container of inline nodes) to phrasing content. */
function inlineNodes(node: DocNode): PhrasingContent[] {
	// biome-ignore lint/suspicious/noExplicitAny: TSDoc node internals require dynamic access
	const nodeAny = node as any;

	if (node.kind === "PlainText") {
		const text: string = nodeAny.text || "";
		return text ? [new Text({ value: text })] : [];
	}
	if (node.kind === "SoftBreak") return [new Text({ value: " " })];
	if (node.kind === "CodeSpan") {
		const code: string = nodeAny.code || "";
		return code ? [new InlineCode({ value: code })] : [];
	}
	if (node.kind === "LinkTag") {
		const linkText: string = nodeAny.linkText ?? "";
		if (nodeAny.urlDestination) {
			const url: string = nodeAny.urlDestination;
			return [new Link({ url, children: [new Text({ value: linkText || url })] })];
		}
		const ref = nodeAny.codeDestination?.memberReferences?.[0]?.memberIdentifier;
		const display: string = linkText || ref?.identifier || "";
		return display ? [new Text({ value: display })] : [];
	}

	const out: PhrasingContent[] = [];
	if (typeof nodeAny.getChildNodes === "function") {
		for (const child of nodeAny.getChildNodes() as DocNode[]) {
			out.push(...inlineNodes(child));
		}
	}
	return out;
}

/**
 * The TSDoc summary section as a single cleaned line.
 *
 * @public
 */
export function summary(item: ApiItem): string {
	if (item instanceof ApiDocumentedItem) {
		const tsdoc = item.tsdocComment;
		if (tsdoc?.summarySection) {
			return plainText(tsdoc.summarySection).replace(/\s+/g, " ").trim();
		}
	}
	return "";
}

/**
 * `@param` blocks merged with parameter types from the declaration excerpt.
 *
 * @public
 */
export function params(item: ApiItem): ReadonlyArray<DocParam> {
	const out: DocParam[] = [];
	const paramTypes = new Map<string, string>();
	// biome-ignore lint/suspicious/noExplicitAny: API Extractor types require dynamic access
	const parameters = (item as any).parameters;
	if (Array.isArray(parameters)) {
		for (const param of parameters) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic access
			const excerpt = (param as any).parameterTypeExcerpt;
			// biome-ignore lint/suspicious/noExplicitAny: dynamic access
			const name = (param as any).name || "";
			if (excerpt?.text) paramTypes.set(name, String(excerpt.text).trim());
		}
	}

	if (item instanceof ApiDocumentedItem) {
		const tsdoc = item.tsdocComment;
		if (tsdoc?.params) {
			for (const block of tsdoc.params.blocks) {
				// biome-ignore lint/suspicious/noExplicitAny: dynamic access
				const blockAny = block as any;
				const name = blockAny.parameterName || "";
				const description = plainText(blockAny.content).replace(/\s+/g, " ").trim();
				const type = paramTypes.get(name);
				out.push({ name, ...(type != null ? { type } : {}), description });
			}
			return out;
		}
	}

	for (const [name, type] of paramTypes.entries()) out.push({ name, type, description: "" });
	return out;
}

/**
 * The `@returns` block description, if present.
 *
 * @public
 */
export function returns(item: ApiItem): { readonly description: string } | null {
	if (item instanceof ApiDocumentedItem) {
		const tsdoc = item.tsdocComment;
		if (tsdoc?.returnsBlock) {
			// biome-ignore lint/suspicious/noExplicitAny: TSDoc returns block internals need dynamic access
			const description = plainText((tsdoc.returnsBlock as any).content)
				.replace(/\s+/g, " ")
				.trim();
			return description.length > 0 ? { description } : null;
		}
	}
	return null;
}

/**
 * All `@example` fenced-code blocks (falls back to plain text).
 *
 * @public
 */
export function examples(item: ApiItem): ReadonlyArray<DocExample> {
	const out: DocExample[] = [];
	if (!(item instanceof ApiDocumentedItem)) return out;
	const tsdoc = item.tsdocComment;
	// biome-ignore lint/suspicious/noExplicitAny: dynamic access
	for (const block of ((tsdoc?.customBlocks as any) || []) as any[]) {
		if (block.blockTag?.tagNameWithUpperCase !== "@EXAMPLE") continue;
		const content = block.content;
		let found = false;
		for (const node of (content?.nodes || []) as Array<{ kind: string; language?: string; code?: string }>) {
			if (node.kind === "FencedCode") {
				out.push({ language: node.language || "typescript", code: node.code || "" });
				found = true;
			}
		}
		if (!found) {
			const text = plainText(content).trim();
			if (text) out.push({ language: "typescript", code: text });
		}
	}
	return out;
}

/**
 * The deprecation-block message, if one is present.
 *
 * @public
 */
export function deprecation(item: ApiItem): { readonly message: string } | null {
	if (item instanceof ApiDocumentedItem) {
		const tsdoc = item.tsdocComment;
		if (tsdoc?.deprecatedBlock) {
			// biome-ignore lint/suspicious/noExplicitAny: dynamic access
			const message = plainText((tsdoc.deprecatedBlock as any).content)
				.replace(/\s+/g, " ")
				.trim();
			return { message };
		}
	}
	return null;
}

/**
 * The release tag (Public/Beta/Alpha/Internal), `"Public"` when absent.
 *
 * @public
 */
export function releaseTag(item: ApiItem): ReleaseTagName {
	if (ApiReleaseTagMixin.isBaseClassOf(item)) {
		switch (item.releaseTag) {
			case ReleaseTag.Beta:
				return "Beta";
			case ReleaseTag.Alpha:
				return "Alpha";
			case ReleaseTag.Internal:
				return "Internal";
			default:
				return "Public";
		}
	}
	return "Public";
}

/**
 * True when the item carries the given TSDoc modifier tag (without the `@`).
 *
 * @public
 */
export function hasModifier(item: ApiItem, tagName: string): boolean {
	if (item instanceof ApiDocumentedItem) {
		const tsdoc = item.tsdocComment;
		// biome-ignore lint/suspicious/noExplicitAny: TSDoc modifier set requires dynamic access
		const nodes = (tsdoc?.modifierTagSet as any)?.nodes || [];
		// biome-ignore lint/suspicious/noExplicitAny: dynamic access
		return nodes.some((t: any) => t.tagName === `@${tagName}`);
	}
	return false;
}

/**
 * `@see` block contents, flattened to prose (whitespace-normalized).
 *
 * @public
 */
export function seeReferences(item: ApiItem): ReadonlyArray<{ readonly text: string }> {
	if (item instanceof ApiDocumentedItem) {
		const tsdoc = item.tsdocComment;
		const references: Array<{ text: string }> = [];

		// biome-ignore lint/suspicious/noExplicitAny: TSDoc see blocks require dynamic property access
		for (const seeBlock of (tsdoc?.seeBlocks as any) || []) {
			// biome-ignore lint/suspicious/noExplicitAny: TSDoc content requires dynamic property access
			const text = plainText((seeBlock as any).content);
			if (text.trim()) {
				references.push({ text: text.replace(/\s+/g, " ").trim() });
			}
		}
		return references;
	}
	return [];
}
