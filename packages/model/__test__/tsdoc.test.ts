import { describe, expect, it } from "vitest";

import {
	extractPlainText,
	getDeprecation,
	getExamples,
	getParams,
	getReleaseTag,
	getReturns,
	getSummary,
	hasModifierTag,
} from "../src/tsdoc.js";
import { findItem } from "./utils/kitchensink.js";

// extractPlainText walks any node exposing { kind, getChildNodes } or leaf text.
const plain = (text: string) => ({ kind: "PlainText", text });
const code = (c: string) => ({ kind: "CodeSpan", code: c });
const section = (children: unknown[]) => ({
	kind: "Section",
	getChildNodes: () => children,
});

describe("extractPlainText", () => {
	it("renders plain text leaves", () => {
		expect(extractPlainText(plain("hello") as never)).toBe("hello");
	});

	it("wraps code spans in backticks", () => {
		expect(extractPlainText(code("Foo") as never)).toBe("`Foo`");
	});

	it("concatenates children of a section node", () => {
		const node = section([plain("a "), code("B"), plain(" c")]);
		expect(extractPlainText(node as never)).toBe("a `B` c");
	});

	it("renders a soft break as a single space", () => {
		expect(extractPlainText({ kind: "SoftBreak" } as never)).toBe(" ");
	});
});

describe("getSummary", () => {
	it("extracts a cleaned single-line summary from a documented item", () => {
		const summary = getSummary(findItem("createPipeline"));
		expect(summary).toContain("Creates a new Pipeline connecting a data source");
		expect(summary).not.toContain("\n");
	});

	it("returns an empty string for an item with no tsdoc", () => {
		expect(getSummary({} as never)).toBe("");
	});
});

describe("getParams", () => {
	it("merges @param descriptions with their declared types", () => {
		const params = getParams(findItem("createPipeline"));
		expect(params.map((p) => p.name)).toEqual(["source", "transform", "options"]);
		for (const p of params) {
			expect(p.type).toBeTruthy();
			expect(p.description).toBeTruthy();
		}
		expect(params).toMatchSnapshot();
	});
});

describe("getReturns", () => {
	it("returns null for an item with no tsdoc", () => {
		expect(getReturns({} as never)).toBeNull();
	});

	it("extracts the @returns description, preserving code spans", () => {
		const returns = getReturns(findItem("createPipeline"));
		expect(returns).not.toBeNull();
		expect(returns?.description).toContain("`Pipeline<I, O>`");
	});
});

describe("getExamples", () => {
	it("extracts @example fenced-code blocks with their language", () => {
		const examples = getExamples(findItem("createPipeline"));
		expect(examples).toHaveLength(1);
		expect(examples[0].language).toBe("typescript");
		expect(examples[0].code).toContain("createPipeline(");
	});

	it("returns an empty array for a plain object", () => {
		expect(getExamples({} as never)).toEqual([]);
	});
});

describe("getDeprecation", () => {
	it("reads the @deprecated message when present", () => {
		const deprecation = getDeprecation(findItem("CSV"));
		expect(deprecation).not.toBeNull();
		expect(deprecation?.message.length).toBeGreaterThan(0);
	});

	it("returns null for a non-deprecated item", () => {
		expect(getDeprecation(findItem("createPipeline"))).toBeNull();
	});
});

describe("getReleaseTag", () => {
	it("returns the item's release tag", () => {
		expect(getReleaseTag(findItem("createPipeline"))).toBe("Public");
	});

	it("defaults to Public for an item without a release-tag mixin", () => {
		expect(getReleaseTag({} as never)).toBe("Public");
	});
});

describe("hasModifierTag", () => {
	it("detects a modifier tag carried by the item", () => {
		expect(hasModifierTag(findItem("JsonSource"), "sealed")).toBe(true);
	});

	it("returns false for a modifier tag the item does not carry", () => {
		expect(hasModifierTag(findItem("JsonSource"), "virtual")).toBe(false);
	});

	it("returns false for a plain object", () => {
		expect(hasModifierTag({} as never, "sealed")).toBe(false);
	});
});
