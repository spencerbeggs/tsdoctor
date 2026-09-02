import { hashContent, hashFrontmatter } from "@tsdoctor/snapshot";
import { describe, expect, it } from "vitest";
import { parseFrontmatter, stringifyFrontmatter } from "../src/index.js";

/**
 * Characterization tests for the frontmatter contract.
 *
 * Every pinned constant below (data JSON, body string, SHA-256 hash) was
 * captured by running the SAME input through gray-matter@4.0.3 +
 * `@tsdoctor/snapshot`'s `hashContent`/`hashFrontmatter` BEFORE this module
 * moved off gray-matter. The snapshot system's whole contract is that
 * unchanged pages hash identically across builds, so the parser must
 * reproduce these values exactly — a mismatch here means a silent mass cache
 * invalidation in consumer sites.
 *
 * The four boundary cases where the grammar deliberately diverges from
 * gray-matter are marked where they appear; each is a malformed input that
 * this repository's emitters cannot produce.
 */

describe("parseFrontmatter (FrontmatterSource grammar)", () => {
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
		// `head` participates in the frontmatter hash since the recursive
		// timestamp strip, so this no longer collides with the head-less page
		// above. The two article:*_time entries keep their `property` and lose
		// only their `content`; `og:url` survives whole — which is what makes a
		// canonical or og:* change detectable while a rebuild stays stable.
		expect(hashFrontmatter(data)).toBe("01f802353920d6564dac66490da11ddadf4094a4dde102b48dc78654e99de18d");
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

	// The four cases below changed when this module adopted
	// `@effected/markdown`'s `FrontmatterSource.split`. They previously pinned
	// gray-matter's `indexOf`-based quirks, emulated here so hashes captured
	// under gray-matter stayed stable. The kit's grammar is strict instead: a
	// fence line is exactly `---`, and an unterminated block is not
	// frontmatter. Every one of these inputs is malformed, and this plugin's
	// emitters — which go through `FrontmatterSource.join` — cannot produce
	// any of them, so the change is unreachable from generated content.
	it("treats an unterminated block as no frontmatter, not as all-frontmatter", () => {
		const open = "---\ntitle: X\n";
		expect(parseFrontmatter(open)).toEqual({ data: {}, content: open });
	});

	it("accepts a closing fence that ends the document", () => {
		// No trailing newline after the close: still a closed block, and the body
		// is empty. Worth pinning because it is the one shape that looks
		// unterminated and is not.
		expect(parseFrontmatter("---\ntitle: X\n---")).toEqual({ data: { title: "X" }, content: "" });
	});

	it("treats bare delimiter inputs as body, since neither block is closed", () => {
		expect(parseFrontmatter("---")).toEqual({ data: {}, content: "---" });
		expect(parseFrontmatter("---\n")).toEqual({ data: {}, content: "---\n" });
	});

	it("closes at the FIRST \\n--- and leaves later --- lines in the body", () => {
		const { data, content } = parseFrontmatter("---\ntitle: X\n---\nBody\n---\nMore\n");
		expect(data).toEqual({ title: "X" });
		expect(content).toBe("Body\n---\nMore\n");
	});

	it("does not accept ---- as a closing fence", () => {
		// gray-matter found `\n---` inside `\n----` and left the stray `-` in the
		// body. A fence line is exactly `---`, so this block is never closed.
		const input = "---\ntitle: X\n----\nBody\n";
		expect(parseFrontmatter(input)).toEqual({ data: {}, content: input });
	});

	it("does not accept a closing fence with trailing whitespace", () => {
		const input = "---\ntitle: X\n--- \nBody\n";
		expect(parseFrontmatter(input)).toEqual({ data: {}, content: input });
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
