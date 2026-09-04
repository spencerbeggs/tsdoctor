import { Text } from "@effected/markdown";
import { headTags } from "@tsdoctor/seo";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import { Title } from "../src/Blocks.js";
import { NavEntry } from "../src/Nav.js";
import { Page } from "../src/Page.js";

const nav = NavEntry.make({ categoryKey: "class", label: "Foo", name: "foo", route: "/api/class/foo" });

describe("Page", () => {
	it("builds the structured title with and without an API name", () => {
		const base = {
			kind: "class" as const,
			entityName: "Foo",
			singularName: "Class",
			description: "d",
			route: "/api/class/foo",
			headTags: [],
			blocks: [],
			nav,
		};
		expect(Page.make(base).title).toBe("Foo | Class | API");
		expect(Page.make({ ...base, apiName: "My Package" }).title).toBe("Foo | Class | API | My Package");
	});

	it("accepts @tsdoctor/seo head tags unchanged and round-trips them", () => {
		const tags = headTags({
			siteUrl: "https://x.test",
			pageRoute: "/api/class/foo",
			title: "Foo",
			description: "d",
			publishedTime: "2026-01-01T00:00:00.000Z",
			modifiedTime: "2026-01-01T00:00:00.000Z",
			section: "Classes",
			packageName: "@scope/pkg",
			structuredData: '{"@context":"https://schema.org"}',
		});
		const page = Page.make({
			kind: "class",
			entityName: "Foo",
			singularName: "Class",
			description: "d",
			route: "/api/class/foo",
			headTags: tags,
			blocks: [Title.make({ name: "Foo", releaseTag: "Public", deprecation: [Text.make({ value: "gone" })] })],
			nav,
		});
		const decoded = Schema.decodeUnknownSync(Page)(JSON.parse(JSON.stringify(Schema.encodeSync(Page)(page))));
		expect(decoded.headTags).toEqual(tags);
		expect(decoded.blocks[0]).toBeInstanceOf(Title);
		expect(decoded.title).toBe(page.title);
	});
});
