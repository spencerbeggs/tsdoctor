import { describe, expect, it } from "vitest";

import type { SeoPageInput } from "../src/Seo.js";
import { headTags } from "../src/Seo.js";

const input: SeoPageInput = {
	siteUrl: "https://x.test",
	pageRoute: "/api/class/pipeline",
	description: "A pipeline",
	publishedTime: "2026-01-15T12:00:00.000Z",
	modifiedTime: "2026-01-17T10:30:00.000Z",
	section: "Classes",
	packageName: "@scope/pkg",
};

describe("headTags", () => {
	it("emits exactly one canonical link", () => {
		const canonical = headTags(input).filter((t) => t.tag === "link" && t.attrs.rel === "canonical");
		expect(canonical).toHaveLength(1);
		expect(canonical[0]?.attrs.href).toBe("https://x.test/api/class/pipeline");
	});

	it("emits a root-relative canonical when no origin is configured", () => {
		const tags = headTags({ ...input, siteUrl: "" });
		expect(tags.find((t) => t.attrs.rel === "canonical")?.attrs.href).toBe("/api/class/pipeline");
	});

	it("emits open graph and twitter blocks together", () => {
		const tags = headTags(input);
		expect(tags.some((t) => t.attrs.property === "og:url")).toBe(true);
		expect(tags.some((t) => t.attrs.name === "twitter:card")).toBe(true);
	});

	it("emits no script tag when no structured data is supplied", () => {
		expect(headTags(input).filter((t) => t.tag === "script")).toEqual([]);
	});

	it("emits one escaped ld+json script when structured data is supplied", () => {
		const tags = headTags({ ...input, structuredData: JSON.stringify({ a: "</script>" }) });
		const scripts = tags.filter((t) => t.tag === "script");
		expect(scripts).toHaveLength(1);
		expect(scripts[0]?.attrs.type).toBe("application/ld+json");
		expect(scripts[0]?.body).not.toContain("</script>");
	});

	it("emits no script for an empty structuredData string", () => {
		// An empty <script type="application/ld+json"></script> is worse than no
		// script: a crawler reports a structured-data error rather than skipping.
		expect(headTags({ ...input, structuredData: "" }).filter((t) => t.tag === "script")).toEqual([]);
	});

	it("threads twitterSite through to the twitter block", () => {
		expect(headTags(input).find((t) => t.attrs.name === "twitter:site")).toBeUndefined();
		expect(
			headTags({ ...input, twitterSite: "@handle" }).find((t) => t.attrs.name === "twitter:site")?.attrs.content,
		).toBe("@handle");
	});

	it("produces no duplicate property or name keys", () => {
		const tags = headTags({ ...input, ogImage: { url: "https://x.test/a.png" } });
		const keys = tags
			.filter((t) => t.tag === "meta" && t.attrs.property !== "article:tag")
			.map((t) => t.attrs.property ?? t.attrs.name);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
