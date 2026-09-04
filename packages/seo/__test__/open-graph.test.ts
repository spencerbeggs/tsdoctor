import { describe, expect, it } from "vitest";
import type { OpenGraphImageMetadata, OpenGraphMetadata } from "../src/OpenGraph.js";
import { createPageMetadata, openGraphTags, twitterTags } from "../src/OpenGraph.js";

const base: OpenGraphMetadata = {
	siteUrl: "https://x.test",
	pageRoute: "/api/class/pipeline",
	title: "Pipeline",
	description: "A pipeline",
	publishedTime: "2026-01-15T12:00:00.000Z",
	modifiedTime: "2026-01-17T10:30:00.000Z",
	section: "Classes",
	tags: ["api", "class"],
	ogType: "article",
};

function content(tags: ReadonlyArray<{ attrs: Readonly<Record<string, string>> }>, key: string): string | undefined {
	return tags.find((t) => t.attrs.property === key || t.attrs.name === key)?.attrs.content;
}

describe("openGraphTags", () => {
	it("emits url, type, title and description", () => {
		const tags = openGraphTags(base);
		expect(content(tags, "og:url")).toBe("https://x.test/api/class/pipeline");
		expect(content(tags, "og:type")).toBe("article");
		expect(content(tags, "og:title")).toBe("Pipeline");
		expect(content(tags, "og:description")).toBe("A pipeline");
	});

	it("emits og:site_name only when siteName is a non-empty string", () => {
		expect(content(openGraphTags(base), "og:site_name")).toBeUndefined();
		expect(content(openGraphTags({ ...base, siteName: "" }), "og:site_name")).toBeUndefined();
		expect(content(openGraphTags({ ...base, siteName: "tsdoctor" }), "og:site_name")).toBe("tsdoctor");
	});

	it("emits one article:tag per tag", () => {
		const tags = openGraphTags(base).filter((t) => t.attrs.property === "article:tag");
		expect(tags.map((t) => t.attrs.content)).toEqual(["api", "class"]);
	});

	it("emits tags in a fixed order: url, type, title, description, then the article block", () => {
		const properties = openGraphTags(base).map((t) => t.attrs.property);
		expect(properties).toEqual([
			"og:url",
			"og:type",
			"og:title",
			"og:description",
			"article:published_time",
			"article:modified_time",
			"article:section",
			"article:tag",
			"article:tag",
		]);
	});

	it("places og:site_name between og:title and og:description when configured", () => {
		const properties = openGraphTags({ ...base, siteName: "tsdoctor" }).map((t) => t.attrs.property);
		expect(properties.slice(0, 5)).toEqual(["og:url", "og:type", "og:title", "og:site_name", "og:description"]);
	});

	it("omits every image tag when no image is configured", () => {
		expect(openGraphTags(base).filter((t) => t.attrs.property?.startsWith("og:image"))).toEqual([]);
	});

	it("emits the optional image sub-tags only when present", () => {
		const tags = openGraphTags({ ...base, ogImage: { url: "https://x.test/a.png", width: 1200 } });
		expect(content(tags, "og:image")).toBe("https://x.test/a.png");
		expect(content(tags, "og:image:width")).toBe("1200");
		expect(content(tags, "og:image:height")).toBeUndefined();
		expect(content(tags, "og:image:secure_url")).toBeUndefined();
		expect(content(tags, "og:image:type")).toBeUndefined();
		expect(content(tags, "og:image:alt")).toBeUndefined();
	});

	it("emits every image sub-tag when the image carries them all", () => {
		const tags = openGraphTags({
			...base,
			ogImage: {
				url: "https://x.test/a.png",
				secureUrl: "https://x.test/a.png",
				type: "image/png",
				width: 1200,
				height: 630,
				alt: "Alt",
			},
		});
		expect(content(tags, "og:image:secure_url")).toBe("https://x.test/a.png");
		expect(content(tags, "og:image:type")).toBe("image/png");
		expect(content(tags, "og:image:height")).toBe("630");
		expect(content(tags, "og:image:alt")).toBe("Alt");
	});
});

describe("twitterTags", () => {
	it("includes twitter:title immediately after twitter:card", () => {
		const names = twitterTags(base).map((t) => t.attrs.name);
		expect(names.slice(0, 2)).toEqual(["twitter:card", "twitter:title"]);
		expect(content(twitterTags(base), "twitter:title")).toBe("Pipeline");
	});

	it("uses summary_large_image when an image is present", () => {
		const tags = twitterTags({ ...base, ogImage: { url: "https://x.test/a.png" } });
		expect(content(tags, "twitter:card")).toBe("summary_large_image");
		expect(content(tags, "twitter:image")).toBe("https://x.test/a.png");
	});

	it("falls back to summary with no image", () => {
		const tags = twitterTags(base);
		expect(content(tags, "twitter:card")).toBe("summary");
		expect(content(tags, "twitter:image")).toBeUndefined();
	});

	it("emits twitter:site only when one is configured", () => {
		expect(content(twitterTags(base), "twitter:site")).toBeUndefined();
		expect(content(twitterTags(base, ""), "twitter:site")).toBeUndefined();
		expect(content(twitterTags(base, "@handle"), "twitter:site")).toBe("@handle");
	});

	it("emits twitter:image:alt only when the image carries alt text", () => {
		expect(
			content(twitterTags({ ...base, ogImage: { url: "https://x.test/a.png" } }), "twitter:image:alt"),
		).toBeUndefined();
		expect(
			content(twitterTags({ ...base, ogImage: { url: "https://x.test/a.png", alt: "Alt" } }), "twitter:image:alt"),
		).toBe("Alt");
	});

	it("uses name attributes, not property", () => {
		for (const tag of twitterTags(base)) {
			expect(tag.attrs.name).toBeDefined();
			expect(tag.attrs.property).toBeUndefined();
		}
	});
});

describe("createPageMetadata", () => {
	it("should create complete metadata object", () => {
		const ogImage: OpenGraphImageMetadata = {
			url: "https://example.com/images/og.png",
			width: 1200,
			height: 630,
			type: "image/png",
			alt: "Custom alt",
		};

		const result = createPageMetadata({
			siteUrl: "https://example.com",
			pageRoute: "/api/classes/MyClass",
			title: "MyClass",
			siteName: "tsdoctor",
			description: "MyClass provides...",
			publishedTime: "2024-01-15T10:00:00Z",
			modifiedTime: "2024-01-20T15:30:00Z",
			section: "Classes",
			packageName: "my-library",
			ogImage,
		});

		expect(result).toEqual({
			siteUrl: "https://example.com",
			pageRoute: "/api/classes/MyClass",
			title: "MyClass",
			siteName: "tsdoctor",
			description: "MyClass provides...",
			publishedTime: "2024-01-15T10:00:00Z",
			modifiedTime: "2024-01-20T15:30:00Z",
			section: "Classes",
			tags: ["TypeScript", "API", "my-library"],
			ogImage,
			ogType: "article",
		});
	});

	it("should work without ogImage or siteName", () => {
		const result = createPageMetadata({
			siteUrl: "https://example.com",
			pageRoute: "/api/functions/myFunction",
			title: "myFunction",
			description: "myFunction provides...",
			publishedTime: "2024-01-15T10:00:00Z",
			modifiedTime: "2024-01-20T15:30:00Z",
			section: "Functions",
			packageName: "my-library",
		});

		expect(result.ogImage).toBeUndefined();
		expect(result.siteName).toBeUndefined();
		expect(result.ogType).toBe("article");
	});

	it("should always set ogType to article", () => {
		const result = createPageMetadata({
			siteUrl: "https://example.com",
			pageRoute: "/api/types/MyType",
			title: "MyType",
			description: "MyType description",
			publishedTime: "2024-01-15T10:00:00Z",
			modifiedTime: "2024-01-20T15:30:00Z",
			section: "Types",
			packageName: "my-library",
		});

		expect(result.ogType).toBe("article");
	});

	it("should include package name in tags", () => {
		const result = createPageMetadata({
			siteUrl: "https://example.com",
			pageRoute: "/api/interfaces/IConfig",
			title: "IConfig",
			description: "IConfig description",
			publishedTime: "2024-01-15T10:00:00Z",
			modifiedTime: "2024-01-20T15:30:00Z",
			section: "Interfaces",
			packageName: "custom-package",
		});

		expect(result.tags).toEqual(["TypeScript", "API", "custom-package"]);
	});
});
