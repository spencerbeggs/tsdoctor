/**
 * `@effected/markdown` must produce the same mdast as `mdast-util-from-markdown`
 * for the hover-documentation subset.
 *
 * @remarks
 * Chunk 2 swaps the parser inside `renderMarkdown`. "It deep-equals the
 * reference utility" is the entire warrant for that swap, so this verifies it
 * against the real reference rather than trusting the kit's documentation.
 *
 * Two things this pins beyond raw equality:
 *
 * - **Dialect.** `mdast-util-from-markdown` is CommonMark; the kit defaults to
 *   GFM. Adopting GFM would silently start rendering tables, strikethrough and
 *   autolinks inside hover popups — defensible as a product decision, not as a
 *   side effect of a dependency swap. `dialect: "commonmark"` is passed
 *   explicitly and the GFM cases below assert it took effect.
 * - **Position data.** `toHast` reads `position` when present. Both parsers are
 *   compared after the same normalization the production path applies.
 *
 * The reference dependency stays installed for this file alone. When it is
 * finally dropped, this test goes with it and the swap is on its own.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Markdown, Mdast } from "@effected/markdown";
import { Result } from "effect";
import { fromMarkdown } from "mdast-util-from-markdown";
import { toHast } from "mdast-util-to-hast";

/** The kit's parse, in the exact configuration `renderMarkdown` uses. */
function kitParse(source: string): unknown {
	const parsed = Markdown.parseResult(source, { dialect: "commonmark" });
	if (Result.isFailure(parsed)) throw new Error(`kit parse failed: ${String(parsed.failure)}`);
	return Mdast.toMdast(parsed.success);
}

/**
 * Strip fields that carry no rendering meaning so the comparison is about
 * document structure. Byte offsets differ in representation between the two
 * parsers without changing a single rendered element.
 */
function structural(node: unknown): unknown {
	if (Array.isArray(node)) return node.map(structural);
	if (node && typeof node === "object") {
		const out: Record<string, unknown> = {};
		for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
			if (k === "position") continue;
			out[k] = structural(v);
		}
		return out;
	}
	return node;
}

/** The cases that actually occur in TSDoc hover documentation. */
const CASES: ReadonlyArray<[string, string]> = [
	["plain prose", "A short summary sentence."],
	["inline code", "Returns a `Promise<void>` when done."],
	["emphasis and strong", "This is *emphasised* and this is **strong**."],
	["a link", "See [the docs](/api/class/pipeline) for details."],
	["a transformed TSDoc link", "See [Pipeline](/api/class/pipeline) for details."],
	["two paragraphs", "First paragraph.\n\nSecond paragraph."],
	["a bullet list", "- one\n- two\n- three"],
	["an ordered list", "1. first\n2. second"],
	["a fenced code block", "```ts\nconst x: number = 1;\n```"],
	["a blockquote", "> a quoted note"],
	["a heading", "## A heading"],
	["mixed inline", "Use `foo` with [bar](/bar) and **baz**."],
	["html entity", "A &amp; B"],
	["escaped characters", "A literal \\* asterisk."],
];

describe("kit parse matches mdast-util-from-markdown", () => {
	it.each(CASES)("produces identical mdast for %s", (_label, source) => {
		expect(structural(kitParse(source))).toEqual(structural(fromMarkdown(source)));
	});

	it.each(CASES)("produces identical HAST for %s", (_label, source) => {
		const viaKit = toHast(kitParse(source) as never);
		const viaReference = toHast(fromMarkdown(source));
		expect(structural(viaKit)).toEqual(structural(viaReference));
	});
});

describe("the commonmark dialect is in force", () => {
	// If the kit's GFM default leaked through, these would parse as GFM
	// constructs and diverge from the CommonMark reference. Each asserts
	// agreement with the reference parser, which is CommonMark-only.
	const GFM_CASES: ReadonlyArray<[string, string]> = [
		["a table", "| a | b |\n| - | - |\n| 1 | 2 |"],
		["strikethrough", "~~struck~~"],
		["an autolink literal", "Visit https://example.com for more."],
		["a task list item", "- [x] done\n- [ ] todo"],
		["a footnote reference", "Text with a footnote[^1].\n\n[^1]: the note."],
	];

	it.each(GFM_CASES)("treats %s as CommonMark, not GFM", (_label, source) => {
		expect(structural(kitParse(source))).toEqual(structural(fromMarkdown(source)));
	});
});

describe("the production call site uses the pinned configuration", () => {
	// The equivalence above proves the KIT behaves like the reference at the
	// configuration this file chooses. It says nothing about the configuration
	// `renderMarkdown` actually passes — dropping `dialect: "commonmark"` there
	// leaves every test above green while production silently switches to GFM.
	// `renderMarkdown` is module-private, so the call site is pinned
	// structurally, which is also the shape the regression would take.
	const source = fs.readFileSync(path.join(import.meta.dirname, "..", "src", "twoslash-transformer.ts"), "utf8");

	it("passes dialect: commonmark to Markdown.parseResult", () => {
		expect(source).toMatch(/Markdown\.parseResult\([^)]*\{\s*dialect:\s*"commonmark"\s*\}\)/);
	});

	it("has no bare parseResult call that would inherit the GFM default", () => {
		const calls = source.match(/Markdown\.parseResult\(/g) ?? [];
		const configured = source.match(/Markdown\.parseResult\([^)]*dialect:/g) ?? [];
		expect(configured.length).toBe(calls.length);
	});

	it("no longer imports the reference parser in production code", () => {
		// It remains a devDependency for this file alone.
		expect(source).not.toContain("mdast-util-from-markdown");
	});
});
