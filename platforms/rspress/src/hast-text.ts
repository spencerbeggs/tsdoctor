import type { Nodes } from "hast";

/**
 * Concatenate every text node under a HAST node, in document order.
 *
 * Text node values hold decoded characters, so this recovers the source text of
 * a highlighted code block without serializing it to HTML and stripping the
 * tags back out — a round trip that left `hast-util-to-html`'s `&#x3C;` and
 * `&#x26;` references in the output.
 */
export function hastText(node: Nodes): string {
	if (node.type === "text") return node.value;
	if ("children" in node) return node.children.map((child) => hastText(child)).join("");
	return "";
}
