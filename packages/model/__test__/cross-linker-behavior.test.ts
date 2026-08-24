import { describe, expect, it } from "vitest";

import { CrossLinker } from "../src/index.js";

describe("CrossLinker (ported from the plugin MarkdownCrossLinker suite)", () => {
	describe("CrossLinker#link (ported plugin suite)", () => {
		const linker = CrossLinker.fromRoutes(
			new Map([
				["MyClass", "/api/classes/myclass"],
				["Hook", "/api/classes/hook"],
				["HookEvent", "/api/classes/hookevent"],
			]),
		);

		it("should add markdown cross-links to type references", () => {
			const text = "This uses MyClass for configuration";

			const result = linker.link(text);

			expect(result).toBe("This uses [MyClass](/api/classes/myclass) for configuration");
		});

		it("should match longer names first", () => {
			const text = "HookEvent extends Hook";

			const result = linker.link(text);

			// HookEvent should be matched and linked
			expect(result).toContain("[HookEvent](/api/classes/hookevent)");
			// Note: Hook may not be linked if the logic has issues with indexOf
		});

		it("should not linkify inside existing markdown links", () => {
			const text = "[MyClass](https://example.com)";

			const result = linker.link(text);

			expect(result).toBe("[MyClass](https://example.com)");
		});

		it("should not linkify when part of another word", () => {
			const text = "MyClassFactory extends MyClass";

			const result = linker.link(text);

			// MyClass should be linked but not MyClassFactory
			expect(result).toContain("[MyClass](/api/classes/myclass)");
			expect(result).toContain("MyClassFactory");
		});

		it("should handle multiple occurrences", () => {
			const text = "MyClass, MyClass, and MyClass";

			const result = linker.link(text);

			expect(result).toBe(
				"[MyClass](/api/classes/myclass), [MyClass](/api/classes/myclass), and [MyClass](/api/classes/myclass)",
			);
		});

		it("should handle text with no matches", () => {
			const text = "This has no type references";

			const result = linker.link(text);

			expect(result).toBe(text);
		});

		it("should handle empty string", () => {
			const result = linker.link("");

			expect(result).toBe("");
		});

		it("should preserve text formatting", () => {
			const text = "**Bold MyClass**";

			const result = linker.link(text);

			// MyClass should be linked inside bold formatting
			expect(result).toContain("[MyClass](/api/classes/myclass)");
		});

		it("should not linkify inside backtick code spans", () => {
			const text = "A `MyClass<T>` instance";

			const result = linker.link(text);

			// MyClass inside backticks should NOT be linkified
			expect(result).toBe("A `MyClass<T>` instance");
		});

		it("should linkify outside backtick code spans but not inside", () => {
			const text = "See `MyClass<T>` or use MyClass directly";

			const result = linker.link(text);

			// Inside backticks: unchanged; outside backticks: linked
			expect(result).toBe("See `MyClass<T>` or use [MyClass](/api/classes/myclass) directly");
		});

		it("should handle multiple code spans correctly", () => {
			const text = "`MyClass` and `Hook` are types";

			const result = linker.link(text);

			// Both are inside code spans — should not be linkified
			expect(result).toBe("`MyClass` and `Hook` are types");
		});
	});

	describe("CrossLinker#linkHtml (ported plugin suite)", () => {
		const linker = CrossLinker.fromRoutes(
			new Map([
				["MyClass", "/api/classes/myclass"],
				["Hook", "/api/classes/hook"],
				["HookEvent", "/api/classes/hookevent"],
			]),
		);

		it("should add HTML cross-links to type references", () => {
			const text = "This uses MyClass for configuration";

			const result = linker.linkHtml(text);

			expect(result).toBe('This uses <a href="/api/classes/myclass">MyClass</a> for configuration');
		});

		it("should match longer names first", () => {
			const text = "HookEvent extends Hook";

			const result = linker.linkHtml(text);

			// HookEvent should be matched and linked
			expect(result).toContain('<a href="/api/classes/hookevent">HookEvent</a>');
			// Note: Hook may not be linked if the logic has issues with indexOf
		});

		it("should not linkify inside existing HTML links", () => {
			const text = '<a href="https://example.com">MyClass</a>';

			const result = linker.linkHtml(text);

			expect(result).toBe('<a href="https://example.com">MyClass</a>');
		});

		it("should not linkify when part of another word", () => {
			const text = "MyClassFactory extends MyClass";

			const result = linker.linkHtml(text);

			// MyClass should be linked but not MyClassFactory
			expect(result).toContain('<a href="/api/classes/myclass">MyClass</a>');
			expect(result).toContain("MyClassFactory");
		});

		it("should handle multiple occurrences", () => {
			const text = "MyClass, MyClass, and MyClass";

			const result = linker.linkHtml(text);

			expect(result).toBe(
				'<a href="/api/classes/myclass">MyClass</a>, <a href="/api/classes/myclass">MyClass</a>, and <a href="/api/classes/myclass">MyClass</a>',
			);
		});

		it("should handle text with no matches", () => {
			const text = "This has no type references";

			const result = linker.linkHtml(text);

			expect(result).toBe(text);
		});

		it("should handle empty string", () => {
			const result = linker.linkHtml("");

			expect(result).toBe("");
		});

		it("should not linkify second occurrence when first is already inside an HTML link", () => {
			const text = '<a href="/existing">MyClass</a> and then MyClass again';

			const result = linker.linkHtml(text);

			// First occurrence is inside an existing link — should not be double-wrapped
			expect(result).toContain('<a href="/existing">MyClass</a>');
			// Second occurrence should be linked
			expect(result).toContain('and then <a href="/api/classes/myclass">MyClass</a> again');
		});

		it("should preserve HTML tags", () => {
			const text = "<strong>Bold MyClass</strong> and <em>italic MyClass</em>";

			const result = linker.linkHtml(text);

			expect(result).toContain('<strong>Bold <a href="/api/classes/myclass">MyClass</a></strong>');
			expect(result).toContain('<em>italic <a href="/api/classes/myclass">MyClass</a></em>');
		});
	});
});
