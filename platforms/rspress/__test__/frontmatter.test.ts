import { hashContent, hashFrontmatter } from "@tsdoctor/snapshot";
import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../src/frontmatter.js";
import { generateFrontmatter } from "../src/markdown/helpers.js";

/**
 * Characterization tests for the gray-matter → @effected/yaml swap.
 *
 * Every pinned constant below (data JSON, body string, SHA-256 hash) was
 * captured by running the SAME input through gray-matter@4.0.3 +
 * `@tsdoctor/snapshot`'s `hashContent`/`hashFrontmatter` BEFORE the swap.
 * The snapshot system's whole contract is that unchanged pages hash
 * identically across builds, so the new parser must reproduce these values
 * exactly — a mismatch here means a silent mass cache invalidation in
 * consumer sites.
 */

describe("parseFrontmatter (gray-matter parity)", () => {
	it("parses a generated page (quoted title/description) with identical data, body boundary and hashes", () => {
		const input =
			'---\ntitle: "MyClass | Class | API | My Package"\ndescription: "A utility class for parsing things."\n---\n\n# MyClass\n\nBody text.\n';
		const { data, content } = parseFrontmatter(input);
		// Pinned under gray-matter@4.0.3:
		expect(data).toEqual({
			title: "MyClass | Class | API | My Package",
			description: "A utility class for parsing things.",
		});
		expect(content).toBe("\n# MyClass\n\nBody text.\n");
		expect(hashContent(content)).toBe("a7617d731e11694a00dfd49372284be7a0617840e8f527551408c36911cd0bd4");
		expect(hashFrontmatter(data)).toBe("04ed78a28e5ef04b39a2d2a8401bbfec95deb6fae6b7f58f2771ef5a102d7f8b");
	});

	it("parses the head array-of-arrays (OG meta entries) into the identical nested structure", () => {
		const input =
			'---\ntitle: "MyClass | Class | API | My Package"\ndescription: "A utility class for parsing things."\nhead:\n  - - meta\n    - property: "og:url"\n      content: "https://example.com/api/class/myclass"\n  - - meta\n    - property: "article:published_time"\n      content: "2024-01-15T12:00:00.000Z"\n  - - meta\n    - property: "article:modified_time"\n      content: "2024-01-17T10:30:00.000Z"\n---\n\n# MyClass\n\nBody text.\n';
		const { data, content } = parseFrontmatter(input);
		expect(data.head).toEqual([
			["meta", { property: "og:url", content: "https://example.com/api/class/myclass" }],
			["meta", { property: "article:published_time", content: "2024-01-15T12:00:00.000Z" }],
			["meta", { property: "article:modified_time", content: "2024-01-17T10:30:00.000Z" }],
		]);
		// Timestamp values must decode as strings, not Dates.
		const head = data.head as [string, Record<string, unknown>][];
		expect(typeof head[1]?.[1].content).toBe("string");
		// head is excluded from the frontmatter hash, so this hashes identically
		// to the head-less page above (pinned under gray-matter).
		expect(hashFrontmatter(data)).toBe("04ed78a28e5ef04b39a2d2a8401bbfec95deb6fae6b7f58f2771ef5a102d7f8b");
		expect(hashContent(content)).toBe("a7617d731e11694a00dfd49372284be7a0617840e8f527551408c36911cd0bd4");
	});

	it("passes content with no frontmatter block through unchanged", () => {
		const input = "# Just a heading\n\nSome body.\n";
		const { data, content } = parseFrontmatter(input);
		expect(data).toEqual({});
		expect(content).toBe(input);
		expect(hashContent(content)).toBe("49ae898d63bf858b0a49bbf0d0bad7b4daa978abb7e627c3261f07ad03b5ec80");
		// hashFrontmatter({}) — the empty-object JSON hash, pinned.
		expect(hashFrontmatter(data)).toBe("44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a");
	});

	it("parses an empty frontmatter block to {} with the exact body boundary", () => {
		const { data, content } = parseFrontmatter("---\n---\n\n# Heading\n");
		expect(data).toEqual({});
		expect(content).toBe("\n# Heading\n");
		expect(hashContent(content)).toBe("fab9d5d23bffb992592cd2cae9ed8b258e676c6d6bbb28c9b12b5cb99f7a5901");
	});

	it("consumes exactly one newline after the closing delimiter (tight body)", () => {
		const { data, content } = parseFrontmatter("---\ntitle: X\n---\n# Immediately\n");
		expect(data).toEqual({ title: "X" });
		expect(content).toBe("# Immediately\n");
		expect(hashContent(content)).toBe("8d203f0078d1026aa770385d54f28775bf93a8efcc54d0b8bc7d187feba34025");
	});

	it("treats a missing closing delimiter as all-frontmatter with an empty body", () => {
		expect(parseFrontmatter("---\ntitle: X\n")).toEqual({ data: { title: "X" }, content: "" });
		expect(parseFrontmatter("---\ntitle: X\n---")).toEqual({ data: { title: "X" }, content: "" });
	});

	it("handles bare delimiter inputs", () => {
		expect(parseFrontmatter("---")).toEqual({ data: {}, content: "" });
		expect(parseFrontmatter("---\n")).toEqual({ data: {}, content: "" });
	});

	it("closes at the FIRST \\n--- and leaves later --- lines in the body", () => {
		const { data, content } = parseFrontmatter("---\ntitle: X\n---\nBody\n---\nMore\n");
		expect(data).toEqual({ title: "X" });
		expect(content).toBe("Body\n---\nMore\n");
	});

	it("preserves gray-matter's indexOf close semantics for a ---- close line", () => {
		// gray-matter finds `\n---` inside `\n----`; the leftover `-` stays in the body.
		const { data, content } = parseFrontmatter("---\ntitle: X\n----\nBody\n");
		expect(data).toEqual({ title: "X" });
		expect(content).toBe("-\nBody\n");
	});

	it("preserves gray-matter's trailing-space close semantics (no newline stripped)", () => {
		const { content } = parseFrontmatter("---\ntitle: X\n--- \nBody\n");
		expect(content).toBe(" \nBody\n");
	});

	it("does not treat a ---- opening line as frontmatter", () => {
		const input = "----\ntitle: X\n---\nBody\n";
		expect(parseFrontmatter(input)).toEqual({ data: {}, content: input });
	});

	it("handles CRLF delimiters and preserves CRLF bytes in the body", () => {
		const { data, content } = parseFrontmatter("---\r\ntitle: X\r\n---\r\n\r\nBody\r\n");
		expect(data).toEqual({ title: "X" });
		expect(content).toBe("\r\nBody\r\n");
		const tight = parseFrontmatter("---\r\ntitle: X\r\n---\r\nBody\r\n");
		expect(tight.content).toBe("Body\r\n");
	});

	it("strips a leading BOM before delimiter detection", () => {
		const { data, content } = parseFrontmatter("﻿---\ntitle: X\n---\nBody\n");
		expect(data).toEqual({ title: "X" });
		expect(content).toBe("Body\n");
	});

	it("decodes null and numeric scalar values like js-yaml did", () => {
		expect(parseFrontmatter("---\ntitle: ~\n---\nBody\n").data).toEqual({ title: null });
		expect(parseFrontmatter("---\ncount: 42\nratio: 3.14\n---\nBody\n").data).toEqual({ count: 42, ratio: 3.14 });
	});

	it("decodes unquoted yes/no/on as strings, hashing identically to gray-matter", () => {
		// gray-matter@4.0.3 (js-yaml) also yielded strings here — pinned hash.
		const { data } = parseFrontmatter("---\na: yes\nb: no\nc: on\n---\nBody\n");
		expect(data).toEqual({ a: "yes", b: "no", c: "on" });
		expect(hashFrontmatter(data)).toBe("01514b5090c8321f00182a2d9863704cebacebdffbbed44a4827e4b72101f33f");
	});

	it("hashes an unquoted ISO timestamp identically despite the Date-vs-string representation delta", () => {
		// gray-matter decoded `date: 2024-01-15T12:00:00.000Z` to a Date; YAML 1.2
		// yields a string. hashFrontmatter JSON-serializes, and a Date serializes
		// to the same ISO string — pinned hash captured under gray-matter's Date.
		const { data } = parseFrontmatter("---\ndate: 2024-01-15T12:00:00.000Z\n---\nBody\n");
		expect(typeof data.date).toBe("string");
		expect(hashFrontmatter(data)).toBe("f7fe79f9e6267673d171e6834964f45ec48d0f41eeb980cf49cc7f0417c47eba");
	});

	it("passes a scalar frontmatter document through as data (gray-matter parity)", () => {
		const { data, content } = parseFrontmatter("---\nhello\n---\nBody\n");
		expect(data as unknown).toBe("hello");
		expect(content).toBe("Body\n");
	});

	it("throws on invalid YAML like gray-matter did", () => {
		expect(() => parseFrontmatter("---\ntitle: [unclosed\n---\nBody\n")).toThrow();
	});
});

describe("stringifyFrontmatter (matter.stringify parity)", () => {
	it("round-trips data and body through parseFrontmatter with the hashes gray-matter produced", () => {
		const body = "# Body\n\nText.\n";
		const data = {
			title: "MyClass | Class | API | Pkg",
			description: 'Desc: with colon "quotes" and | pipe',
		};
		const out = stringifyFrontmatter(body, data);
		const rt = parseFrontmatter(out);
		expect(rt.data).toEqual(data);
		expect(rt.content).toBe(body);
		// Pinned from matter.stringify(...) → matter(...) under gray-matter@4.0.3:
		expect(hashFrontmatter(rt.data)).toBe("eedd4948adedd1821a2e49e9bc59d0291fe5082f1aa9e686a84437ca02c00793");
		expect(hashContent(rt.content)).toBe("e41e27bb2bf7384ef7872c23245650fbad95e1736607919c48787113f9d2e82f");
	});

	it("returns the body without fences when data is empty (gray-matter parity)", () => {
		expect(stringifyFrontmatter("body\n", {})).toBe("body\n");
		expect(stringifyFrontmatter("body", {})).toBe("body\n");
	});

	it("ensures a trailing newline on the body", () => {
		const out = stringifyFrontmatter("body", { a: "b" });
		expect(out.endsWith("\n")).toBe(true);
		expect(parseFrontmatter(out).content).toBe("body\n");
	});

	it("quotes timestamp strings so a YAML 1.1 consumer (RSPress's js-yaml) reads strings, not Dates", () => {
		const out = stringifyFrontmatter("body\n", { time: "2024-01-15T12:00:00.000Z" });
		expect(out).toContain('"2024-01-15T12:00:00.000Z"');
	});
});

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
		const fm = generateFrontmatter("MyClass", "A utility class for parsing things.", "Class", "My Package", {
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
		});
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
		expect(hashFrontmatter(data)).toBe("04ed78a28e5ef04b39a2d2a8401bbfec95deb6fae6b7f58f2771ef5a102d7f8b");
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
