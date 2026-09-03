import { parseFrontmatter } from "@tsdoctor/model";
import { NavCategory, NavEntry, buildNav } from "@tsdoctor/pages";
import { headTags } from "@tsdoctor/seo";
import { describe, expect, it } from "vitest";

import { emitFrontmatter, headConfig } from "../src/emit/frontmatter.js";
import { sidebarFor, sidebarItems } from "../src/emit/sidebar.js";

describe("frontmatter", () => {
	const tags = headTags({
		siteUrl: "https://example.com",
		pageRoute: "/api/class/x",
		description: "desc",
		publishedTime: "2026-01-01T00:00:00.000Z",
		modifiedTime: "2026-01-01T00:00:00.000Z",
		section: "Classes",
		packageName: "pkg",
		structuredData: '{"@context":"https://schema.org"}',
	});

	it("renders a meta tag as a pair and the JSON-LD script as the triple VitePress reads innerHTML from", () => {
		const canonical = tags.find((t) => t.tag === "link");
		const script = tags.find((t) => t.tag === "script");
		expect(headConfig(canonical as never)).toEqual([
			"link",
			{ rel: "canonical", href: "https://example.com/api/class/x" },
		]);
		const [tag, attrs, body] = headConfig(script as never);
		expect(tag).toBe("script");
		expect(attrs).toEqual({ type: "application/ld+json" });
		expect(body).toContain("schema.org");
		// The pair form has NO third element: a `children` attribute (the
		// RSPress spelling) would be emitted as an empty script by VitePress.
		expect(headConfig(canonical as never)).toHaveLength(2);
	});

	it("round-trips through the frontmatter parser with head as HeadConfig entries", () => {
		const text = emitFrontmatter({ title: "X | Class | API", description: "multi\nline  desc", headTags: tags });
		expect(text.startsWith("---\n")).toBe(true);
		const { data } = parseFrontmatter(text);
		expect(data.title).toBe("X | Class | API");
		expect(data.description).toBe("multi line desc");
		const head = data.head as unknown[][];
		expect(head.length).toBe(tags.length);
		expect(head[0]).toEqual(["link", { rel: "canonical", href: "https://example.com/api/class/x" }]);
		expect((head.at(-1) as unknown[]).length).toBe(3);
	});

	it("omits head entirely when there are no tags", () => {
		const { data } = parseFrontmatter(emitFrontmatter({ title: "t", description: "d" }));
		expect(data).toEqual({ title: "t", description: "d" });
	});
});

describe("sidebar", () => {
	const tree = buildNav({
		baseRoute: "/api",
		categories: {
			classes: NavCategory.make({ displayName: "Classes", folderName: "class", collapsible: true, collapsed: true }),
			functions: NavCategory.make({ displayName: "Functions", folderName: "function", collapsible: false }),
			enums: NavCategory.make({ displayName: "Enums", folderName: "enum" }),
		},
		entries: [
			NavEntry.make({ categoryKey: "functions", label: "run", name: "run", route: "/api/function/run" }),
			NavEntry.make({ categoryKey: "classes", label: "Zed", name: "zed", route: "/api/class/zed" }),
			NavEntry.make({ categoryKey: "classes", label: "Alpha", name: "alpha", route: "/api/class/alpha" }),
		],
	});

	it("keys the sidebar by the base route with the index first, then groups in tree order", () => {
		const sidebar = sidebarFor(tree);
		expect(Object.keys(sidebar)).toEqual(["/api/"]);
		const items = sidebar["/api/"] as ReturnType<typeof sidebarItems>;
		expect(items[0]).toEqual({ text: "API Reference", link: "/api/" });
		expect(items.slice(1).map((i) => i.text)).toEqual(["Classes", "Functions"]);
	});

	it("renders pages in the tree's sorted order and honours collapsible/collapsed", () => {
		const [, classes, functions] = sidebarItems(tree);
		expect(classes?.items?.map((i) => i.link)).toEqual(["/api/class/alpha", "/api/class/zed"]);
		expect(classes?.collapsed).toBe(true);
		// A non-collapsible group carries no `collapsed` at all — VitePress
		// treats any `collapsed` key, even `false`, as "collapsible".
		expect(functions).toEqual({ text: "Functions", items: [{ text: "run", link: "/api/function/run" }] });
	});
});
