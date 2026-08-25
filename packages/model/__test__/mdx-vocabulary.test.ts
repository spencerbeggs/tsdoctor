import {
	Markdown,
	MdxJsxAttribute,
	MdxJsxAttributeValueExpression,
	MdxJsxFlowElement,
	Paragraph,
	Root,
	Text,
} from "@effected/markdown";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

/**
 * Proof consumer for `@effected/markdown`'s MDX node vocabulary — the seam
 * the phase-5 `Render.tree` MDX emission (the page generators' `<ApiSignature
 * code={...} />` shape) will build on. Pins the headline construction path:
 * a JSX flow element whose attribute value is an expression carrying
 * `JSON.stringify`-ed props, serialized to valid MDX.
 */
describe("MDX vocabulary (proof consumer)", () => {
	it("builds and serializes a JSX flow element with a JSON.stringify value expression", () => {
		const code = "declare function greet(name: string): string;";
		const element = MdxJsxFlowElement.make({
			name: "ApiSignature",
			attributes: [
				MdxJsxAttribute.make({
					name: "code",
					value: MdxJsxAttributeValueExpression.make({ value: JSON.stringify(code) }),
				}),
			],
			children: [],
		});
		const root = Root.make({ children: [element] });
		const mdx = Result.getOrThrow(Markdown.stringifyResult(root));
		expect(mdx).toBe(`<ApiSignature code={${JSON.stringify(code)}} />\n`);
	});

	it("serializes string attributes with MDX quoting and nests flow children with indent", () => {
		const element = MdxJsxFlowElement.make({
			name: "ParametersTable",
			attributes: [MdxJsxAttribute.make({ name: "title", value: 'Say "hi"' })],
			children: [Paragraph.make({ children: [Text.make({ value: "body" })] })],
		});
		const root = Root.make({ children: [element] });
		const mdx = Result.getOrThrow(Markdown.stringifyResult(root));
		expect(mdx).toContain('title="Say &#x22;hi&#x22;"');
		expect(mdx).toContain("  body");
	});

	it("a non-MDX tree serializes byte-identically to the pre-MDX vocabulary", () => {
		const root = Root.make({
			children: [Paragraph.make({ children: [Text.make({ value: "plain {braces} stay literal" })] })],
		});
		const mdx = Result.getOrThrow(Markdown.stringifyResult(root));
		expect(mdx).toBe("plain {braces} stay literal\n");
	});

	it("escapes { in text when an MDX node is present in the tree", () => {
		const root = Root.make({
			children: [
				MdxJsxFlowElement.make({ name: "A", attributes: [], children: [] }),
				Paragraph.make({ children: [Text.make({ value: "uses {braces}" })] }),
			],
		});
		const mdx = Result.getOrThrow(Markdown.stringifyResult(root));
		expect(mdx).toContain("\\{braces");
	});
});
