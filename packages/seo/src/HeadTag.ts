/**
 * The neutral head-tag vocabulary every adapter renders.
 *
 * @remarks
 * A `HeadTag` is deliberately not a framework element. RSPress renders one
 * into a frontmatter `head` pair; VitePress renders the same value into a
 * `transformHead` entry. Keeping the type this dumb is what makes the second
 * adapter cheap.
 *
 * @packageDocumentation
 */

/**
 * One tag destined for a page's `<head>`.
 *
 * @public
 */
export interface HeadTag {
	readonly tag: "meta" | "link" | "script";
	readonly attrs: Readonly<Record<string, string>>;
	/** Element content. Only meaningful for `script`. */
	readonly body?: string;
}

/**
 * Escape a JSON string so it cannot terminate the `<script>` element that
 * carries it.
 *
 * @remarks
 * Every string in a JSON-LD graph originates in author-written TSDoc, so a
 * summary containing the literal `</script>` would close the element early and
 * inject markup into the page. `JSON.stringify` does not escape it.
 *
 * Escaping both angle brackets as `<` / `>` is valid JSON that
 * parses back to the original characters, so the graph a consumer reads is
 * unchanged while the element becomes unclosable from inside.
 *
 * `&` is escaped for the same reason at a different layer: XHTML parses
 * script content as ordinary element content, where a bare `&` is a
 * well-formedness error. An HTML-parsed page tolerates it; an XHTML-served one
 * does not, and nothing in a docs pipeline guarantees which a consumer serves.
 *
 * The escape is idempotent — no escape sequence it emits contains `<`, `>` or
 * `&` — so a body that arrives already escaped by an upstream serializer
 * survives a second pass unchanged.
 *
 * @public
 */
export function escapeScriptBody(json: string): string {
	return json.replaceAll("<", "\\u003C").replaceAll(">", "\\u003E").replaceAll("&", "\\u0026");
}

/** An Open Graph style `<meta property=… content=…>`. @public */
export function meta(property: string, content: string): HeadTag {
	return { tag: "meta", attrs: { property, content } };
}

/** A Twitter/standard style `<meta name=… content=…>`. @public */
export function metaNamed(name: string, content: string): HeadTag {
	return { tag: "meta", attrs: { name, content } };
}

/** A `<link rel=… href=…>`. @public */
export function link(rel: string, href: string): HeadTag {
	return { tag: "link", attrs: { rel, href } };
}

/** A `<script type="application/ld+json">` carrying an escaped body. @public */
export function jsonLd(json: string): HeadTag {
	return { tag: "script", attrs: { type: "application/ld+json" }, body: escapeScriptBody(json) };
}
