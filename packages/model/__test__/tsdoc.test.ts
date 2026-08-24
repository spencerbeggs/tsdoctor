import { describe, expect, it } from "vitest";

import { Tsdoc } from "../src/index.js";
import { findItem } from "./utils/kitchensink.js";

// Tsdoc.plainText walks any node exposing { kind, getChildNodes } or leaf text.
const plain = (text: string) => ({ kind: "PlainText", text });
const code = (c: string) => ({ kind: "CodeSpan", code: c });
const section = (children: unknown[]) => ({
	kind: "Section",
	getChildNodes: () => children,
});

describe("Tsdoc.plainText", () => {
	it("renders plain text leaves", () => {
		expect(Tsdoc.plainText(plain("hello") as never)).toBe("hello");
	});

	it("wraps code spans in backticks", () => {
		expect(Tsdoc.plainText(code("Foo") as never)).toBe("`Foo`");
	});

	it("concatenates children of a section node", () => {
		const node = section([plain("a "), code("B"), plain(" c")]);
		expect(Tsdoc.plainText(node as never)).toBe("a `B` c");
	});

	it("renders a soft break as a single space", () => {
		expect(Tsdoc.plainText({ kind: "SoftBreak" } as never)).toBe(" ");
	});
});

describe("Tsdoc.toMarkdown", () => {
	it("maps a paragraph of inline nodes to a Paragraph with preserved code spans", () => {
		const node = { kind: "Paragraph", getChildNodes: () => [plain("use "), code("Foo"), plain(" now")] };
		const out = Tsdoc.toMarkdown(node as never);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			type: "paragraph",
			children: [
				{ type: "text", value: "use " },
				{ type: "inlineCode", value: "Foo" },
				{ type: "text", value: " now" },
			],
		});
	});

	it("maps fenced code to a Code node with its language", () => {
		const out = Tsdoc.toMarkdown({ kind: "FencedCode", code: "const x = 1;\n", language: "ts" } as never);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ type: "code", value: "const x = 1;", lang: "ts" });
	});

	it("maps a url {@link} to a Link node", () => {
		const node = { kind: "LinkTag", urlDestination: "https://example.com", linkText: "Example" };
		const out = Tsdoc.toMarkdown(node as never);
		expect(out[0]).toMatchObject({
			type: "link",
			url: "https://example.com",
			children: [{ type: "text", value: "Example" }],
		});
	});

	it("flattens a code-destination {@link} to display text", () => {
		const node = {
			kind: "LinkTag",
			codeDestination: { memberReferences: [{ memberIdentifier: { identifier: "Pipeline" } }] },
		};
		const out = Tsdoc.toMarkdown(node as never);
		expect(out[0]).toMatchObject({ type: "text", value: "Pipeline" });
	});

	it("recurses through container nodes", () => {
		const node = section([{ kind: "Paragraph", getChildNodes: () => [plain("a")] }]);
		const out = Tsdoc.toMarkdown(node as never);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({ type: "paragraph" });
	});
});

describe("Tsdoc.summary", () => {
	it("extracts a cleaned single-line summary from a documented item", () => {
		const summary = Tsdoc.summary(findItem("createPipeline"));
		expect(summary).toContain("Creates a new Pipeline connecting a data source");
		expect(summary).not.toContain("\n");
	});

	it("returns an empty string for an item with no tsdoc", () => {
		expect(Tsdoc.summary({} as never)).toBe("");
	});
});

describe("Tsdoc.params", () => {
	it("merges @param descriptions with their declared types", () => {
		const params = Tsdoc.params(findItem("createPipeline"));
		expect(params.map((p) => p.name)).toEqual(["source", "transform", "options"]);
		for (const p of params) {
			expect(p.type).toBeTruthy();
			expect(p.description).toBeTruthy();
		}
		expect(params).toMatchSnapshot();
	});
});

describe("Tsdoc.returns", () => {
	it("returns null for an item with no tsdoc", () => {
		expect(Tsdoc.returns({} as never)).toBeNull();
	});

	it("extracts the @returns description, preserving code spans", () => {
		const returns = Tsdoc.returns(findItem("createPipeline"));
		expect(returns).not.toBeNull();
		expect(returns?.description).toContain("`Pipeline<I, O>`");
	});
});

describe("Tsdoc.examples", () => {
	it("extracts @example fenced-code blocks with their language", () => {
		const examples = Tsdoc.examples(findItem("createPipeline"));
		expect(examples).toHaveLength(1);
		expect(examples[0].language).toBe("typescript");
		expect(examples[0].code).toContain("createPipeline(");
	});

	it("returns an empty array for a plain object", () => {
		expect(Tsdoc.examples({} as never)).toEqual([]);
	});
});

describe("Tsdoc.deprecation", () => {
	it("reads the @deprecated message when present", () => {
		const deprecation = Tsdoc.deprecation(findItem("CSV"));
		expect(deprecation).not.toBeNull();
		expect(deprecation?.message.length).toBeGreaterThan(0);
	});

	it("returns null for a non-deprecated item", () => {
		expect(Tsdoc.deprecation(findItem("createPipeline"))).toBeNull();
	});
});

describe("Tsdoc.releaseTag", () => {
	it("returns the item's release tag", () => {
		expect(Tsdoc.releaseTag(findItem("createPipeline"))).toBe("Public");
	});

	it("defaults to Public for an item without a release-tag mixin", () => {
		expect(Tsdoc.releaseTag({} as never)).toBe("Public");
	});
});

describe("Tsdoc.hasModifier", () => {
	it("detects a modifier tag carried by the item", () => {
		expect(Tsdoc.hasModifier(findItem("JsonSource"), "sealed")).toBe(true);
	});

	it("returns false for a modifier tag the item does not carry", () => {
		expect(Tsdoc.hasModifier(findItem("JsonSource"), "virtual")).toBe(false);
	});

	it("returns false for a plain object", () => {
		expect(Tsdoc.hasModifier({} as never, "sealed")).toBe(false);
	});
});
