import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { NavCategory, NavEntry, NavTree, buildNav, sortNavPages } from "../src/Nav.js";

const categories = {
	class: NavCategory.make({ displayName: "Classes", folderName: "class", collapsible: true, collapsed: true }),
	function: NavCategory.make({ displayName: "Functions", folderName: "function" }),
	enum: NavCategory.make({ displayName: "Enums", folderName: "enum", overviewHeaders: [2, 3] }),
};

const entry = (categoryKey: string, label: string) =>
	NavEntry.make({ categoryKey, label, name: label.toLowerCase(), route: `/api/${categoryKey}/${label.toLowerCase()}` });

describe("buildNav", () => {
	it("keeps groups in category insertion order and drops empty categories", () => {
		const tree = buildNav({
			baseRoute: "/api",
			categories,
			entries: [entry("function", "run"), entry("class", "Zed")],
		});
		expect(tree.groups.map((g) => g.key)).toEqual(["class", "function"]);
	});

	// Characterizes writeMetadata's `entries.sort((a, b) => a.label.localeCompare(b.label))`
	// — locale-aware, so case and diacritics order the way the old _meta.json did.
	it("sorts pages within a group by label.localeCompare", () => {
		const labels = ["beta", "Alpha", "Éclair", "alpha", "Zed", "Namespace.member"];
		const tree = buildNav({ baseRoute: "/api", categories, entries: labels.map((l) => entry("class", l)) });
		expect(tree.groups[0]?.pages.map((p) => p.label)).toEqual([...labels].sort((a, b) => a.localeCompare(b)));
	});

	it("always carries the index page at the base route", () => {
		const tree = buildNav({ baseRoute: "/pkg/api", categories, entries: [] });
		expect(tree.groups).toEqual([]);
		expect(tree.index.route).toBe("/pkg/api/index");
		expect(tree.index.name).toBe("index");
	});

	it("drops an entry whose category is not configured", () => {
		const tree = buildNav({ baseRoute: "/api", categories, entries: [entry("ghost", "x"), entry("enum", "E")] });
		expect(tree.groups.map((g) => g.key)).toEqual(["enum"]);
	});

	it("preserves the category presentation facts, absent keys staying absent", () => {
		const tree = buildNav({ baseRoute: "/api", categories, entries: [entry("function", "f"), entry("enum", "E")] });
		const encoded = Schema.encodeSync(NavTree)(tree);
		expect(encoded.groups[0]?.category).toEqual({ displayName: "Functions", folderName: "function" });
		expect(encoded.groups[1]?.category.overviewHeaders).toEqual([2, 3]);
	});

	it("round-trips through encode/decode", () => {
		const tree = buildNav({ baseRoute: "/api", categories, entries: [entry("class", "A"), entry("class", "B")] });
		const decoded = Schema.decodeUnknownSync(NavTree)(Schema.encodeSync(NavTree)(tree));
		expect(decoded).toEqual(tree);
	});
});

describe("sortNavPages", () => {
	it("does not mutate its input", () => {
		const pages = buildNav({ baseRoute: "/api", categories, entries: [entry("class", "b"), entry("class", "a")] })
			.groups[0]?.pages;
		if (!pages) throw new Error("no pages");
		const copy = [...pages];
		sortNavPages(pages);
		expect(pages).toEqual(copy);
	});
});
