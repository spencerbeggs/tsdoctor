/**
 * The pure half of Open Graph handling.
 *
 * @remarks
 * The IO half — locating a local image and reading its dimensions — moved to
 * `OgService` in Chunk 4 and is tested in `__test__/layers/og-service.test.ts`
 * against `@effected/memfs` rather than a `vi.mock("node:fs")`. What is left
 * here is total.
 */

import { describe, expect, it } from "vitest";
import { createPageMetadata, deriveSiteUrl, imageMimeType, ogAltText, resolveOgUrl } from "../src/og-resolver.js";
import type { OpenGraphImageMetadata } from "../src/schemas/opengraph.js";

describe("resolveOgUrl", () => {
	it("passes an absolute http URL through", () => {
		expect(resolveOgUrl("https://example.com", "http://cdn.example.com/og.png")).toBe("http://cdn.example.com/og.png");
	});

	it("passes an absolute https URL through", () => {
		expect(resolveOgUrl("https://example.com", "https://cdn.example.com/og.png")).toBe(
			"https://cdn.example.com/og.png",
		);
	});

	it("prefixes a root-relative path with the site URL", () => {
		expect(resolveOgUrl("https://example.com", "/images/og.png")).toBe("https://example.com/images/og.png");
	});

	// FORBIDS: falling back to `${siteUrl}/${url}` for a bare relative path.
	// There is no base that would not silently produce a broken link, so this
	// must stay a rejection the caller can report.
	it("rejects a bare relative path rather than guessing a base", () => {
		expect(resolveOgUrl("https://example.com", "invalid-path")).toBeUndefined();
		expect(resolveOgUrl("https://example.com", "images/og.png")).toBeUndefined();
	});
});

describe("ogAltText", () => {
	it("names the API when one is given", () => {
		expect(ogAltText("my-lib", "Core")).toBe("Core - my-lib API Documentation");
	});

	it("falls back to the package name alone", () => {
		expect(ogAltText("my-lib")).toBe("my-lib API Documentation");
	});
});

describe("imageMimeType", () => {
	it.each([
		["jpg", "image/jpeg"],
		["jpeg", "image/jpeg"],
		["png", "image/png"],
		["gif", "image/gif"],
		["webp", "image/webp"],
		["svg", "image/svg+xml"],
	])("maps %s to %s", (type, mime) => {
		expect(imageMimeType(type)).toBe(mime);
	});

	it("matches case-insensitively", () => {
		expect(imageMimeType("PNG")).toBe("image/png");
	});

	it("returns undefined for an unmapped type", () => {
		expect(imageMimeType("bmp")).toBeUndefined();
		expect(imageMimeType(undefined)).toBeUndefined();
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
			description: "MyClass provides...",
			publishedTime: "2024-01-15T10:00:00Z",
			modifiedTime: "2024-01-20T15:30:00Z",
			section: "Classes",
			tags: ["TypeScript", "API", "my-library"],
			ogImage,
			ogType: "article",
		});
	});

	it("should work without ogImage", () => {
		const result = createPageMetadata({
			siteUrl: "https://example.com",
			pageRoute: "/api/functions/myFunction",
			description: "myFunction provides...",
			publishedTime: "2024-01-15T10:00:00Z",
			modifiedTime: "2024-01-20T15:30:00Z",
			section: "Functions",
			packageName: "my-library",
		});

		expect(result.ogImage).toBeUndefined();
		expect(result.ogType).toBe("article");
	});

	it("should always set ogType to article", () => {
		const result = createPageMetadata({
			siteUrl: "https://example.com",
			pageRoute: "/api/types/MyType",
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
			description: "IConfig description",
			publishedTime: "2024-01-15T10:00:00Z",
			modifiedTime: "2024-01-20T15:30:00Z",
			section: "Interfaces",
			packageName: "custom-package",
		});

		expect(result.tags).toEqual(["TypeScript", "API", "custom-package"]);
	});
});

describe("edge cases", () => {
	it("keeps an empty package name verbatim in the alt text", () => {
		expect(ogAltText("")).toBe(" API Documentation");
	});

	it("keeps a scoped package name verbatim", () => {
		expect(ogAltText("@scope/my-package")).toBe("@scope/my-package API Documentation");
	});

	it("preserves query parameters", () => {
		expect(resolveOgUrl("https://example.com", "https://cdn.example.com/og.png?v=123")).toBe(
			"https://cdn.example.com/og.png?v=123",
		);
	});

	it("preserves fragments", () => {
		expect(resolveOgUrl("https://example.com", "https://cdn.example.com/og.png#section")).toBe(
			"https://cdn.example.com/og.png#section",
		);
	});

	// Both of these produce a double slash. That is the behaviour as shipped,
	// pinned rather than endorsed — a normalization here would change every
	// existing site's og:image URL, so it is a deliberate follow-up, not a
	// drive-by fix.
	it("concatenates without normalizing a leading double slash", () => {
		expect(resolveOgUrl("https://example.com", "//images/og.png")).toBe("https://example.com//images/og.png");
	});

	it("concatenates without normalizing a trailing slash on siteUrl", () => {
		expect(resolveOgUrl("https://example.com/", "/images/og.png")).toBe("https://example.com//images/og.png");
	});
});

describe("deriveSiteUrl", () => {
	// The plugin's `siteUrl` option is gone; the canonical URL now comes from
	// RSPress's own `siteOrigin` + `base`, which is the only place that knows
	// where the site is actually deployed.

	it("joins siteOrigin and base, per RSPress's siteOrigin + base + routePath order", () => {
		expect(deriveSiteUrl("https://foo.github.io", "/bar/")).toBe("https://foo.github.io/bar");
	});

	it("returns the bare origin when base is the default root", () => {
		expect(deriveSiteUrl("https://example.com", "/")).toBe("https://example.com");
		expect(deriveSiteUrl("https://example.com", undefined)).toBe("https://example.com");
	});

	it("leaves no trailing slash, since callers append a route beginning with /", () => {
		// FORBIDS a naive `${origin}${base}` join: with base "/bar/" that yields
		// "…/bar/" and every og:url gets a doubled slash before the route.
		for (const base of ["/bar/", "bar", "/bar", "bar/", "//bar//"]) {
			expect(deriveSiteUrl("https://foo.github.io", base)).toBe("https://foo.github.io/bar");
		}
		expect(deriveSiteUrl("https://example.com/", "/")).toBe("https://example.com");
	});

	it("falls back to a root-relative prefix without a siteOrigin", () => {
		// RSPress's own documented fallback is `base + routePath` when siteOrigin
		// is unset, and matching it is what makes the tags inspectable under
		// `rspress dev` on localhost, where no configured origin could be right.
		expect(deriveSiteUrl(undefined, "/bar/")).toBe("/bar");
		expect(deriveSiteUrl("", "/bar/")).toBe("/bar");
		expect(deriveSiteUrl("   ", "/bar/")).toBe("/bar");
	});

	it("yields an empty prefix at the site root, leaving routes root-relative", () => {
		// FORBIDS returning "/" here: the caller appends a route that already
		// starts with "/", so a "/" prefix doubles it into "//api/...", which a
		// browser reads as a protocol-relative URL pointing at a host named "api".
		expect(deriveSiteUrl(undefined, "/")).toBe("");
		expect(deriveSiteUrl(undefined, undefined)).toBe("");
		expect(resolveOgUrl(deriveSiteUrl(undefined, "/"), "/images/og.png")).toBe("/images/og.png");
	});

	it("composes with resolveOgUrl into exactly one slash", () => {
		const siteUrl = deriveSiteUrl("https://foo.github.io", "/bar/");
		expect(resolveOgUrl(siteUrl as string, "/og.png")).toBe("https://foo.github.io/bar/og.png");
	});
});
