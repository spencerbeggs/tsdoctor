import { describe, expect, it } from "vitest";

import { escapeScriptBody, jsonLd, link, meta, metaNamed } from "../src/HeadTag.js";

describe("escapeScriptBody", () => {
	it("escapes a closing script tag so the body cannot break out", () => {
		const json = JSON.stringify({ description: "use </script> carefully" });
		const escaped = escapeScriptBody(json);
		expect(escaped).not.toContain("</script>");
		expect(escaped).toContain("\\u003C");
	});

	it("escapes both angle brackets", () => {
		expect(escapeScriptBody(JSON.stringify({ a: "<b>" }))).toBe('{"a":"\\u003Cb\\u003E"}');
	});

	it("round-trips back to the original value", () => {
		const value = { description: "a </script> and <b> and & an entity" };
		expect(JSON.parse(escapeScriptBody(JSON.stringify(value)))).toEqual(value);
	});

	it("leaves a body with no angle brackets byte-identical", () => {
		const json = JSON.stringify({ a: "plain" });
		expect(escapeScriptBody(json)).toBe(json);
	});

	it("escapes an ampersand and still round-trips", () => {
		const value = { a: "a & b" };
		const escaped = escapeScriptBody(JSON.stringify(value));
		expect(escaped).not.toContain("&");
		expect(escaped).toContain("\\u0026");
		expect(JSON.parse(escaped)).toEqual(value);
	});

	it("is idempotent", () => {
		const json = JSON.stringify({ a: "</script> & <b> & \u0026" });
		const once = escapeScriptBody(json);
		expect(escapeScriptBody(once)).toBe(once);
	});
});

describe("tag constructors", () => {
	it("meta uses the property attribute", () => {
		expect(meta("og:url", "https://x.test/a")).toEqual({
			tag: "meta",
			attrs: { property: "og:url", content: "https://x.test/a" },
		});
	});

	it("metaNamed uses the name attribute", () => {
		expect(metaNamed("twitter:card", "summary")).toEqual({
			tag: "meta",
			attrs: { name: "twitter:card", content: "summary" },
		});
	});

	it("link carries rel and href", () => {
		expect(link("canonical", "https://x.test/a")).toEqual({
			tag: "link",
			attrs: { rel: "canonical", href: "https://x.test/a" },
		});
	});

	it("jsonLd escapes its body and sets the ld+json type", () => {
		const tag = jsonLd(JSON.stringify({ a: "</script>" }));
		expect(tag.tag).toBe("script");
		expect(tag.attrs).toEqual({ type: "application/ld+json" });
		expect(tag.body).not.toContain("</script>");
	});
});
