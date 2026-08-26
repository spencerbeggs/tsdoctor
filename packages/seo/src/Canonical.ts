/**
 * URL derivation for a documentation page: the site URL prefix, the canonical
 * page URL, absolute image URLs and image MIME mapping.
 *
 * @remarks
 * `imageMimeType`, `resolveUrl` and `deriveSiteUrl` moved here verbatim from
 * the RSPress adapter's `og-resolver.ts`. `resolveUrl` was `resolveOgUrl`
 * there; canonical links resolve through the same function, so the
 * OG-specific name no longer fits. Everything here is total and synchronous —
 * no Effect, no filesystem.
 *
 * @packageDocumentation
 */

/**
 * MIME type mappings for common image formats, used for `og:image:type`.
 */
const IMAGE_MIME_TYPES: Record<string, string> = {
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	png: "image/png",
	gif: "image/gif",
	webp: "image/webp",
	svg: "image/svg+xml",
};

/**
 * The `og:image:type` value for a detected image format, or `undefined` for a
 * format with no mapping.
 *
 * @public
 */
export function imageMimeType(type: string | undefined): string | undefined {
	if (type == null) return undefined;
	return IMAGE_MIME_TYPES[type.toLowerCase()];
}

/**
 * Turn a configured URL into an absolute one.
 *
 * @returns The absolute URL, or `undefined` when the input is neither an
 * absolute `http(s)` URL nor a site-root-relative path. A bare relative path
 * is deliberately rejected rather than guessed at — there is no base to
 * resolve it against that would not silently produce a broken link.
 *
 * @public
 */
export function resolveUrl(siteUrl: string, url: string): string | undefined {
	if (url.startsWith("http://") || url.startsWith("https://")) return url;
	if (url.startsWith("/")) return `${siteUrl}${url}`;
	return undefined;
}

/**
 * Derive the site URL prefix from the framework's own config.
 *
 * @remarks
 * Replaces the RSPress plugin's former `siteUrl` option. RSPress already knows
 * where a site is deployed — {@link https://rspress.rs/api/config/config-basic#siteorigin | `siteOrigin`}
 * plus `base` — so asking for it a second time invited the two to disagree, and
 * a plugin-level answer that contradicted the site's own would silently emit
 * canonical and `og:url` tags pointing at a host the site is not served from.
 *
 * RSPress concatenates as `siteOrigin + base + routePath`, and **this follows
 * its documented fallback exactly**: with no `siteOrigin`, RSPress uses
 * `base + routePath`. So an unset origin yields a ROOT-RELATIVE prefix rather
 * than nothing.
 *
 * That fallback is what makes the tags inspectable in `rspress dev`, where the
 * site is served from `localhost` and no configured origin could be correct
 * anyway. A root-relative `/images/og.png` resolves against the page's own
 * origin in the browser; it is a *relative* path (`images/og.png`, no leading
 * slash) that has no base to resolve against, and this never emits one.
 *
 * @returns The prefix to put in front of a route that already begins with `/`.
 * `""` when the site declares neither `siteOrigin` nor a non-root `base`, which
 * leaves every URL root-relative. Never has a trailing slash, since every
 * caller appends a route starting with `/`.
 *
 * @public
 */
export function deriveSiteUrl(siteOrigin: string | undefined, base: string | undefined): string {
	const origin = (siteOrigin ?? "").trim().replace(/\/+$/, "");
	const path = (base ?? "/").trim();
	// `base` is a path segment, not a URL: normalize it to a leading slash and
	// no trailing slash so the join cannot double or drop one.
	const normalizedBase = path === "" || path === "/" ? "" : `/${path.replace(/^\/+/, "").replace(/\/+$/, "")}`;

	return `${origin}${normalizedBase}`;
}

/**
 * The canonical URL for a page.
 *
 * @remarks
 * With no configured origin the prefix is `""`, so the result is
 * root-relative (`/api/class/foo`) rather than absent. That matches RSPress's
 * own documented `base + routePath` fallback and keeps the tag inspectable
 * under a dev server, where no configured origin could be correct.
 *
 * @public
 */
export function canonicalUrl(siteUrl: string, pageRoute: string): string {
	const prefix = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;
	return `${prefix}${pageRoute}`;
}
