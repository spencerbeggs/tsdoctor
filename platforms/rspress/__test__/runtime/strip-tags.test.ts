import { describe, expect, it } from "vitest";
import { stripTags } from "../../src/runtime/utils/strip-tags.js";

/** The regex `stripTags` replaces; the two must agree on every input. */
const regexStrip = (text: string): string => text.replace(/<[^>]*>/g, "");

describe("stripTags", () => {
	it.each([
		["plain text", "plain text"],
		["a <b>bold</b> word", "a bold word"],
		['<a href="x">link</a>', "link"],
		["unclosed < tag", "unclosed < tag"],
		["x < y and <b>z</b>", "x z"],
		["<<<nested>>", ">"],
		["trailing <open", "trailing <open"],
		["<b>a</b> then <open", "a then <open"],
		["", ""],
	])("strips %j like the regex it replaces", (input, expected) => {
		expect(stripTags(input)).toBe(expected);
		expect(stripTags(input)).toBe(regexStrip(input));
	});

	it("stays linear on a long run of unclosed brackets", () => {
		const input = "<".repeat(100_000);
		expect(stripTags(input)).toBe(input);
	});
});
