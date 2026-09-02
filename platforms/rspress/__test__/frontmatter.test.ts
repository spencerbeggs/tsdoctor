import { parseFrontmatter, stringifyFrontmatter } from "@tsdoctor/model";
import { openGraphTags } from "@tsdoctor/seo";
import { hashContent, hashFrontmatter } from "@tsdoctor/snapshot";
import { describe, expect, it } from "vitest";
import { generateFrontmatter } from "../src/markdown/helpers.js";

/**
 * The adapter's frontmatter EMISSION, as distinct from the parse/stringify
 * contract that moved to `@tsdoctor/model` with the module itself. This half
 * is an integration test: it renders `@tsdoctor/seo` head tags through
 * `generateFrontmatter` and reads the result back.
 */

describe("generateFrontmatter emission parity", () => {
	/**
	 * Each case pins the DATA the old hand-rolled emitter produced when its
	 * output was parsed by gray-matter, plus the resulting frontmatter hash.
	 * The new emitter may produce different bytes, but parsing them must yield
	 * the identical data — that is the hash-stability contract.
	 */
	const cases: {
		name: string;
		emit: () => string;
		data: Record<string, unknown>;
		fmHash: string;
	}[] = [
		{
			name: "simple",
			emit: () => generateFrontmatter("MyClass", "A utility class for parsing things.", "Class", "My Package"),
			data: {
				title: "MyClass | Class | API | My Package",
				description: "A utility class for parsing things.",
			},
			fmHash: "04ed78a28e5ef04b39a2d2a8401bbfec95deb6fae6b7f58f2771ef5a102d7f8b",
		},
		{
			name: "special characters",
			emit: () =>
				generateFrontmatter("Store", 'Desc: with colon "quotes" | pipe @at #hash 。unicode', "Interface", "@scope/pkg"),
			data: {
				title: "Store | Interface | API | @scope/pkg",
				description: 'Desc: with colon "quotes" | pipe @at #hash 。unicode',
			},
			fmHash: "c322a47274b5d84d19a89aa38ac00af920cca47c669eddbf1b979013f6c7ced1",
		},
		{
			name: "no api name",
			emit: () => generateFrontmatter("parse", "Parses input.", "Function"),
			data: { title: "parse | Function | API", description: "Parses input." },
			fmHash: "ceac086617c52608f76b39cd93fa078e4d7c75fe355afdc9ee058029b7b0b6e4",
		},
		{
			name: "multiline description collapses whitespace",
			emit: () => generateFrontmatter("X", "line one\nline two\n\n  line   three", "Class"),
			data: { title: "X | Class | API", description: "line one line two line three" },
			fmHash: "c1438edd7d4a26409e2ab4db5dae4f08f9f5ea2a3314208b1a97fdf92085fcdc",
		},
		{
			name: "numeric-looking description stays a string",
			emit: () => generateFrontmatter("N", "42", "Class"),
			data: { title: "N | Class | API", description: "42" },
			fmHash: "eaad2c5dfbcaeadac3b9d12fb65ae8a309d8cb4ff83bc5019ed86a957d6a0be2",
		},
		{
			name: "yaml-literal description stays a string",
			emit: () => generateFrontmatter("B", "yes", "Class"),
			data: { title: "B | Class | API", description: "yes" },
			fmHash: "9bfce547e7f9f779204b49055862e5de5b58621ca5a91f5f2c8a972d3837dca7",
		},
	];

	for (const c of cases) {
		it(`parses to the pinned gray-matter data and hash: ${c.name}`, () => {
			const { data, content } = parseFrontmatter(`${c.emit()}# Body\n`);
			expect(data).toEqual(c.data);
			expect(hashFrontmatter(data)).toBe(c.fmHash);
			// The block ends with a blank line, so the body starts with "\n".
			expect(content).toBe("\n# Body\n");
			expect(hashContent(content)).toBe("cd6eb7d1fa7bffee0d6c0881301abd0ba728a45edcfcf616ecc2a7030c83a4fa");
		});
	}

	it("parses the full OG head structure to the pinned gray-matter data and hash", () => {
		// The head array now arrives already rendered from @tsdoctor/seo. Feeding
		// the same metadata through `openGraphTags` keeps the pinned hash below
		// a real claim about the emitter, not a restatement of a literal.
		const fm = generateFrontmatter(
			"MyClass",
			"A utility class for parsing things.",
			"Class",
			"My Package",
			openGraphTags({
				siteUrl: "https://example.com",
				pageRoute: "/api/class/myclass",
				ogType: "article",
				description: 'A utility class:\nwith  newlines and "quotes".',
				ogImage: {
					url: "https://example.com/og.png",
					secureUrl: "https://example.com/og.png",
					type: "image/png",
					width: 1200,
					height: 630,
					alt: "MyClass card",
				},
				publishedTime: "2024-01-15T12:00:00.000Z",
				modifiedTime: "2024-01-17T10:30:00.000Z",
				section: "Classes",
				tags: ["typescript", "api"],
			}),
		);
		const { data, content } = parseFrontmatter(`${fm}# Body\n`);
		// Pinned under the old emitter + gray-matter:
		expect(data).toEqual({
			title: "MyClass | Class | API | My Package",
			description: "A utility class for parsing things.",
			head: [
				["meta", { property: "og:url", content: "https://example.com/api/class/myclass" }],
				["meta", { property: "og:type", content: "article" }],
				["meta", { property: "og:description", content: 'A utility class: with newlines and "quotes".' }],
				["meta", { property: "og:image", content: "https://example.com/og.png" }],
				["meta", { property: "og:image:secure_url", content: "https://example.com/og.png" }],
				["meta", { property: "og:image:type", content: "image/png" }],
				["meta", { property: "og:image:width", content: "1200" }],
				["meta", { property: "og:image:height", content: "630" }],
				["meta", { property: "og:image:alt", content: "MyClass card" }],
				["meta", { property: "article:published_time", content: "2024-01-15T12:00:00.000Z" }],
				["meta", { property: "article:modified_time", content: "2024-01-17T10:30:00.000Z" }],
				["meta", { property: "article:section", content: "Classes" }],
				["meta", { property: "article:tag", content: "typescript" }],
				["meta", { property: "article:tag", content: "api" }],
			],
		});
		expect(hashFrontmatter(data)).toBe("7d5730c72526f42ccf509cfebc65082c7c78f6185f6d4e0549b2695cc68e535e");
		expect(hashContent(content)).toBe("cd6eb7d1fa7bffee0d6c0881301abd0ba728a45edcfcf616ecc2a7030c83a4fa");
	});

	it("is stable across an emit → parse → emit → parse cycle", () => {
		const fm = generateFrontmatter("MyClass", "A utility class.", "Class", "Pkg");
		const first = parseFrontmatter(`${fm}# Body\n`);
		const reEmitted = stringifyFrontmatter(first.content, first.data);
		const second = parseFrontmatter(reEmitted);
		expect(second.data).toEqual(first.data);
		expect(hashFrontmatter(second.data)).toBe(hashFrontmatter(first.data));
		expect(hashContent(second.content)).toBe(hashContent(first.content));
	});
});
