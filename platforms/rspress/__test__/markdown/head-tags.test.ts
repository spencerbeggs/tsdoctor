/**
 * Rendering a neutral `HeadTag` array into RSPress frontmatter.
 *
 * @remarks
 * RSPress renders a frontmatter `head` entry as
 * `React.createElement(tagName, { ...attrs })`, and `@unhead/react` maps a
 * `<script>` element's `children` prop onto `innerHTML`. That attribute name
 * is load-bearing: spelling it anything else emits an empty `<script>` with
 * no error anywhere in the build, failing only in a browser.
 *
 * The re-parse assertions matter for the same class of reason. A JSON-LD body
 * is full of double quotes, so the YAML emitter's quoting is what stands
 * between a correct graph and a frontmatter block that will not parse.
 */

import { parseFrontmatter } from "@tsdoctor/model";
import type { HeadTag } from "@tsdoctor/seo";
import { describe, expect, it } from "vitest";
import { generateFrontmatter } from "../../src/markdown/helpers.js";

type HeadEntry = [string, Record<string, string>];

function headOf(source: string): HeadEntry[] {
	const { data } = parseFrontmatter(source);
	return (data.head ?? []) as HeadEntry[];
}

describe("generateFrontmatter over a HeadTag array", () => {
	it("maps a script tag's body onto the children attribute", () => {
		const body = '{"@context":"https://schema.org","@type":"TechArticle"}';
		const tags: ReadonlyArray<HeadTag> = [{ tag: "script", attrs: { type: "application/ld+json" }, body }];

		expect(headOf(generateFrontmatter("MyClass", "A class", "Class", "My Package", tags))).toEqual([
			["script", { type: "application/ld+json", children: body }],
		]);
	});

	it("omits children entirely for a tag with no body", () => {
		const tags: ReadonlyArray<HeadTag> = [{ tag: "meta", attrs: { property: "og:type", content: "article" } }];
		const [entry] = headOf(generateFrontmatter("MyClass", "A class", "Class", undefined, tags));

		expect(entry).toEqual(["meta", { property: "og:type", content: "article" }]);
		expect(entry?.[1]).not.toHaveProperty("children");
	});

	it("round-trips a link tag", () => {
		const tags: ReadonlyArray<HeadTag> = [
			{ tag: "link", attrs: { rel: "canonical", href: "https://example.com/api/class/myclass" } },
		];

		expect(headOf(generateFrontmatter("MyClass", "A class", "Class", undefined, tags))).toEqual([
			["link", { rel: "canonical", href: "https://example.com/api/class/myclass" }],
		]);
	});

	it("re-parses a mixed array to exactly the structure it was given", () => {
		const body = '{"@type":"APIReference","name":"MyClass","url":"https://example.com/api/class/myclass"}';
		const tags: ReadonlyArray<HeadTag> = [
			{ tag: "link", attrs: { rel: "canonical", href: "https://example.com/api/class/myclass" } },
			{ tag: "meta", attrs: { property: "og:description", content: 'A "quoted" summary' } },
			{ tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
			{ tag: "script", attrs: { type: "application/ld+json" }, body },
		];

		const source = generateFrontmatter("MyClass", "A class", "Class", "My Package", tags);

		expect(headOf(source)).toEqual([
			["link", { rel: "canonical", href: "https://example.com/api/class/myclass" }],
			["meta", { property: "og:description", content: 'A "quoted" summary' }],
			["meta", { name: "twitter:card", content: "summary_large_image" }],
			["script", { type: "application/ld+json", children: body }],
		]);
		expect(JSON.parse(body)).toEqual({
			"@type": "APIReference",
			name: "MyClass",
			url: "https://example.com/api/class/myclass",
		});
	});

	it("emits no head key at all when given no tags", () => {
		const { data } = parseFrontmatter(generateFrontmatter("MyClass", "A class", "Class"));

		expect(data).not.toHaveProperty("head");
	});
});
