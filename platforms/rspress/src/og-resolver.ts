/**
 * Pure Open Graph metadata logic: URL resolution, alt text, MIME mapping and
 * page-metadata assembly.
 *
 * @remarks
 * The IO half — locating a local image and reading its dimensions — moved to
 * {@link OgService} in Chunk 4. What is left is total and synchronous, so it
 * needs no Effect, no filesystem and no event emitter; the sync-island seam
 * this module used to carry is gone.
 *
 * @packageDocumentation
 */

import type { OpenGraphImageMetadata, OpenGraphMetadata } from "./schemas/index.js";

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
 */
export function imageMimeType(type: string | undefined): string | undefined {
	if (type == null) return undefined;
	return IMAGE_MIME_TYPES[type.toLowerCase()];
}

/**
 * Turn a configured image URL into an absolute one.
 *
 * @returns The absolute URL, or `undefined` when the input is neither an
 * absolute `http(s)` URL nor a site-root-relative path. A bare relative path
 * is deliberately rejected rather than guessed at — there is no base to
 * resolve it against that would not silently produce a broken link.
 */
export function resolveOgUrl(siteUrl: string, url: string): string | undefined {
	if (url.startsWith("http://") || url.startsWith("https://")) return url;
	if (url.startsWith("/")) return `${siteUrl}${url}`;
	return undefined;
}

/** Descriptive alt text for a package's (or one API's) OG image. */
export function ogAltText(packageName: string, apiName?: string): string {
	return apiName ? `${apiName} - ${packageName} API Documentation` : `${packageName} API Documentation`;
}

/**
 * Assemble the complete Open Graph metadata for one documentation page.
 *
 * @remarks
 * Was `OpenGraphResolver.createPageMetadata`. It never touched the resolver's
 * instance state, so it is a free function now rather than a static on a class
 * that no longer exists.
 */
export function createPageMetadata(options: {
	siteUrl: string;
	pageRoute: string;
	description: string;
	publishedTime: string;
	modifiedTime: string;
	section: string;
	packageName: string;
	ogImage?: OpenGraphImageMetadata;
}): OpenGraphMetadata {
	return {
		siteUrl: options.siteUrl,
		pageRoute: options.pageRoute,
		description: options.description,
		publishedTime: options.publishedTime,
		modifiedTime: options.modifiedTime,
		section: options.section,
		tags: ["TypeScript", "API", options.packageName],
		...(options.ogImage != null ? { ogImage: options.ogImage } : {}),
		ogType: "article",
	};
}
