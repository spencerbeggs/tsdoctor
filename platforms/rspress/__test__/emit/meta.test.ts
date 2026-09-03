/**
 * The `_meta.json` and `index.mdx` emitters over the IR's navigation tree,
 * pinned against the JSON `writeMetadata` used to assemble itself.
 */

import { NavCategory, NavEntry, buildIndexPage, buildNav } from "@tsdoctor/pages";
import { describe, expect, it } from "vitest";
import { emitIndexPage, renderCategoryMeta, renderRootMeta } from "../../src/emit/meta.js";

const tree = buildNav({
	baseRoute: "/api",
	categories: {
		classes: NavCategory.make({ displayName: "Classes", folderName: "class" }),
		functions: NavCategory.make({
			displayName: "Functions",
			folderName: "function",
			collapsible: false,
			collapsed: false,
			overviewHeaders: [2, 3],
		}),
		empty: NavCategory.make({ displayName: "Empty", folderName: "empty" }),
	},
	entries: [
		NavEntry.make({ categoryKey: "functions", label: "zeta", name: "zeta", route: "/api/function/zeta" }),
		NavEntry.make({ categoryKey: "classes", label: "Pipeline", name: "pipeline", route: "/api/class/pipeline" }),
		NavEntry.make({ categoryKey: "functions", label: "alpha", name: "alpha", route: "/api/function/alpha" }),
	],
});

describe("renderRootMeta", () => {
	it("renders one dir entry per non-empty category in category order, with renderer defaults filled in", () => {
		expect(JSON.parse(renderRootMeta(tree))).toEqual([
			{ type: "dir", name: "class", label: "Classes", collapsible: true, collapsed: true, overviewHeaders: [2] },
			{
				type: "dir",
				name: "function",
				label: "Functions",
				collapsible: false,
				collapsed: false,
				overviewHeaders: [2, 3],
			},
		]);
	});

	it("uses tab indentation and no trailing newline, the spelling the snapshot system compares against", () => {
		const text = renderRootMeta(tree);
		expect(text.startsWith('[\n\t{\n\t\t"type": "dir"')).toBe(true);
		expect(text.endsWith("]")).toBe(true);
	});
});

describe("renderCategoryMeta", () => {
	it("renders file entries sorted by label", () => {
		const functions = tree.groups.find((g) => g.key === "functions");
		if (!functions) throw new Error("no functions group");
		expect(JSON.parse(renderCategoryMeta(functions))).toEqual([
			{ type: "file", name: "alpha", label: "alpha" },
			{ type: "file", name: "zeta", label: "zeta" },
		]);
	});
});

describe("emitIndexPage", () => {
	it("renders frontmatter only, with overview enabled", () => {
		const text = emitIndexPage(buildIndexPage({ packageName: "@scope/pkg", baseRoute: "/api" }));
		expect(text).toBe(
			"---\ntitle: API Reference\ndescription: Auto-generated API documentation for @scope/pkg\noverview: true\n---\n\n",
		);
	});
});
