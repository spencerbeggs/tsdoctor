import { codeToHast } from "shiki";
import { describe, expect, it } from "vitest";
import { hastText } from "../src/hast-text.js";

describe("hastText", () => {
	it("recovers highlighted code with its characters decoded", async () => {
		const code = `const a: Array<string> = x && y ? "q" : 'r';`;
		const hast = await codeToHast(code, { lang: "ts", theme: "github-dark" });
		expect(hastText(hast)).toBe(code);
	});

	it("ignores comment and doctype nodes", () => {
		expect(
			hastText({
				type: "root",
				children: [
					{ type: "doctype" },
					{ type: "comment", value: "hidden" },
					{ type: "element", tagName: "span", properties: {}, children: [{ type: "text", value: "shown" }] },
				],
			}),
		).toBe("shown");
	});
});
