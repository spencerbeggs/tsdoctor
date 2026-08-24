import { describe, expect, it } from "vitest";

import { Signature } from "../src/index.js";

// Minimal Excerpt-shaped fixture: { text, spannedTokens: [{ text }] }.
const excerpt = (tokens: string[]) => ({
	text: tokens.join(""),
	spannedTokens: tokens.map((t) => ({ text: t })),
});

describe("Signature.format", () => {
	it("strips export/declare from the leading token", () => {
		expect(Signature.format(excerpt(["export declare function ", "foo", "(): ", "void"]) as never)).toBe(
			"function foo(): void",
		);
	});

	it("falls back to stripped text when there are no spanned tokens", () => {
		expect(Signature.format({ text: "export declare const x: number", spannedTokens: [] } as never)).toBe(
			"const x: number",
		);
	});

	it("wraps a long union type across lines after a | operator", () => {
		const tokens = [
			"export declare type ",
			"LongName",
			" = ",
			"VeryLongTypeName",
			" | ",
			"AnotherVeryLongTypeName",
			" | ",
			"YetAnotherLongTypeName",
		];
		const result = Signature.format(excerpt(tokens) as never, { maxLineLength: 30 });
		expect(result).toContain("\n");
		expect(result).toMatch(/^\s+/m); // continuation line is indented
	});
});

describe("Signature.stripExportDeclare", () => {
	it("removes leading and embedded export/declare modifiers", () => {
		expect(Signature.stripExportDeclare("export declare class Foo")).toBe("class Foo");
		expect(Signature.stripExportDeclare("declare const x: number")).toBe("const x: number");
	});
});

describe("Signature.linkReferences", () => {
	const refExcerpt = {
		text: "Promise<Config>",
		spannedTokens: [
			{ kind: "Content", text: "Promise<" },
			{ kind: "Reference", text: "Config", canonicalReference: { toString: () => "pkg!Config:interface" } },
			{ kind: "Content", text: ">" },
		],
	};

	it("links reference tokens whose canonical reference has a route", () => {
		const routes = new Map([["pkg!Config:interface", "/api/interface/config"]]);
		expect(Signature.linkReferences("Promise<Config>", refExcerpt as never, routes)).toBe(
			"Promise<[Config](/api/interface/config)>",
		);
	});

	it("returns the text unchanged when no routes match", () => {
		expect(Signature.linkReferences("Promise<Config>", refExcerpt as never, new Map())).toBe("Promise<Config>");
	});
});
