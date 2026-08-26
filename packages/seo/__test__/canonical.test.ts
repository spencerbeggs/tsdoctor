/**
 * URL derivation: canonical page URLs, image URL resolution and MIME mapping.
 *
 * @remarks
 * `resolveUrl`, `deriveSiteUrl` and `imageMimeType` moved here verbatim from
 * the RSPress adapter's `og-resolver.ts` (`resolveOgUrl` renamed, since
 * canonical links resolve through the same function). Every case below that
 * predates the move is carried over from `og-resolver.test.ts` unchanged.
 */

import { describe, expect, it } from "vitest";

import { canonicalUrl, deriveSiteUrl, imageMimeType, resolveUrl } from "../src/Canonical.js";

describe("resolveUrl", () => {
	it("passes an absolute http URL through", () => {
		expect(resolveUrl("https://example.com", "http://cdn.example.com/og.png")).toBe("http://cdn.example.com/og.png");
	});

	it("passes an absolute https URL through", () => {
		expect(resolveUrl("https://example.com", "https://cdn.example.com/og.png")).toBe("https://cdn.example.com/og.png");
	});

	it("prefixes a root-relative path with the site URL", () => {
		expect(resolveUrl("https://example.com", "/images/og.png")).toBe("https://example.com/images/og.png");
	});

	// FORBIDS: falling back to `${siteUrl}/${url}` for a bare relative path.
	// There is no base that would not silently produce a broken link, so this
	// must stay a rejection the caller can report.
	it("rejects a bare relative path rather than guessing a base", () => {
		expect(resolveUrl("https://example.com", "invalid-path")).toBeUndefined();
		expect(resolveUrl("https://example.com", "images/og.png")).toBeUndefined();
		expect(resolveUrl("https://x.test", "img/a.png")).toBeUndefined();
	});

	it("preserves query parameters", () => {
		expect(resolveUrl("https://example.com", "https://cdn.example.com/og.png?v=123")).toBe(
			"https://cdn.example.com/og.png?v=123",
		);
	});

	it("preserves fragments", () => {
		expect(resolveUrl("https://example.com", "https://cdn.example.com/og.png#section")).toBe(
			"https://cdn.example.com/og.png#section",
		);
	});

	// Both of these produce a double slash. That is the behaviour as shipped,
	// pinned rather than endorsed — a normalization here would change every
	// existing site's og:image URL, so it is a deliberate follow-up, not a
	// drive-by fix.
	it("concatenates without normalizing a leading double slash", () => {
		expect(resolveUrl("https://example.com", "//images/og.png")).toBe("https://example.com//images/og.png");
	});

	it("concatenates without normalizing a trailing slash on siteUrl", () => {
		expect(resolveUrl("https://example.com/", "/images/og.png")).toBe("https://example.com//images/og.png");
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
		expect(imageMimeType("jpg")).toBe("image/jpeg");
	});

	it("returns undefined for an unmapped type", () => {
		expect(imageMimeType("bmp")).toBeUndefined();
		expect(imageMimeType(undefined)).toBeUndefined();
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
		expect(resolveUrl(deriveSiteUrl(undefined, "/"), "/images/og.png")).toBe("/images/og.png");
	});

	it("composes with resolveUrl into exactly one slash", () => {
		const siteUrl = deriveSiteUrl("https://foo.github.io", "/bar/");
		expect(resolveUrl(siteUrl, "/og.png")).toBe("https://foo.github.io/bar/og.png");
	});
});

describe("canonicalUrl", () => {
	it("joins the site url and the route", () => {
		expect(canonicalUrl("https://x.test", "/api/class/pipeline")).toBe("https://x.test/api/class/pipeline");
	});

	it("stays root-relative when no origin is configured", () => {
		expect(canonicalUrl("", "/api/class/pipeline")).toBe("/api/class/pipeline");
	});

	it("does not double a slash when the site url has a trailing one", () => {
		expect(canonicalUrl("https://x.test/", "/api/class/pipeline")).toBe("https://x.test/api/class/pipeline");
	});
});
