/**
 * Open Graph and Twitter card vocabulary: the metadata schemas, the
 * page-metadata assembly and the two tag emitters.
 *
 * @remarks
 * The schemas and {@link createPageMetadata} / {@link ogAltText} moved here
 * verbatim from the RSPress adapter (`schemas/opengraph.ts` and
 * `og-resolver.ts`). {@link openGraphTags} is the tag-emission logic that was
 * inlined in the adapter's `generateFrontmatter`, lifted unchanged — same tag
 * order, same conditional emission of each optional image sub-tag — so that a
 * second adapter can reach the vocabulary rather than reimplement it.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

import { canonicalUrl } from "./Canonical.js";
import type { HeadTag } from "./HeadTag.js";
import { meta, metaNamed } from "./HeadTag.js";

/**
 * Structured Open Graph image metadata (alternative to a plain URL string).
 *
 * @public
 */
export const OpenGraphImageMetadata = Schema.Struct({
	/** Absolute URL of the image. */
	url: Schema.String,
	/** HTTPS URL of the image (for secure contexts). */
	secureUrl: Schema.optional(Schema.String),
	/** MIME type of the image (e.g. `"image/png"`). */
	type: Schema.optional(Schema.String),
	/** Image width in pixels. */
	width: Schema.optional(Schema.Number),
	/** Image height in pixels. */
	height: Schema.optional(Schema.Number),
	/** Alt text for the image. */
	alt: Schema.optional(Schema.String),
});
/** @public */
export type OpenGraphImageMetadata = typeof OpenGraphImageMetadata.Type;

/**
 * Open Graph image: either a plain URL string or structured `OpenGraphImageMetadata`.
 *
 * @public
 */
export const OpenGraphImageConfig = Schema.Union([Schema.String, OpenGraphImageMetadata]);
/** @public */
export type OpenGraphImageConfig = typeof OpenGraphImageConfig.Type;

/**
 * Resolved Open Graph metadata for one documentation page.
 *
 * @public
 */
export const OpenGraphMetadata = Schema.Struct({
	/** Canonical site base URL. */
	siteUrl: Schema.String,
	/** Page route path (e.g. `/api/classes/myclass`). */
	pageRoute: Schema.String,
	/** Page description for the `og:description` tag. */
	description: Schema.String,
	/** ISO 8601 date string for `article:published_time`. */
	publishedTime: Schema.String,
	/** ISO 8601 date string for `article:modified_time`. */
	modifiedTime: Schema.String,
	/** Article section label (e.g. `"API"`). */
	section: Schema.String,
	/** Article tag keywords. */
	tags: Schema.mutable(Schema.Array(Schema.String)),
	/** Optional structured image metadata. */
	ogImage: Schema.optional(OpenGraphImageMetadata),
	/** Open Graph object type (e.g. `"article"`). */
	ogType: Schema.String,
});
/** @public */
export type OpenGraphMetadata = typeof OpenGraphMetadata.Type;

/**
 * Descriptive alt text for a package's (or one API's) OG image.
 *
 * @public
 */
export function ogAltText(packageName: string, apiName?: string): string {
	return apiName ? `${apiName} - ${packageName} API Documentation` : `${packageName} API Documentation`;
}

/**
 * Assemble the complete Open Graph metadata for one documentation page.
 *
 * @public
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

/**
 * The Open Graph block for a page.
 *
 * @remarks
 * Each optional image sub-tag is emitted only when the resolved image actually
 * carries it — an `og:image:width` with no width is a tag a crawler reads as a
 * declared-but-empty dimension rather than an absent one.
 *
 * @public
 */
export function openGraphTags(metadata: OpenGraphMetadata): ReadonlyArray<HeadTag> {
	const tags: HeadTag[] = [
		meta("og:url", canonicalUrl(metadata.siteUrl, metadata.pageRoute)),
		meta("og:type", metadata.ogType),
		meta("og:description", metadata.description),
	];

	const image = metadata.ogImage;
	if (image) {
		tags.push(meta("og:image", image.url));
		if (image.secureUrl) tags.push(meta("og:image:secure_url", image.secureUrl));
		if (image.type) tags.push(meta("og:image:type", image.type));
		if (image.width) tags.push(meta("og:image:width", String(image.width)));
		if (image.height) tags.push(meta("og:image:height", String(image.height)));
		if (image.alt) tags.push(meta("og:image:alt", image.alt));
	}

	tags.push(meta("article:published_time", metadata.publishedTime));
	tags.push(meta("article:modified_time", metadata.modifiedTime));
	tags.push(meta("article:section", metadata.section));

	for (const tag of metadata.tags) {
		tags.push(meta("article:tag", tag));
	}

	return tags;
}

/**
 * Twitter card tags derived from the same metadata as the Open Graph block.
 *
 * @remarks
 * Twitter reads most `og:` tags directly, so only what it does not infer is
 * emitted here. The card type is a function of whether an image exists —
 * `summary_large_image` with one, `summary` without — because declaring the
 * large card with no image renders as a broken preview rather than degrading
 * to the small one.
 *
 * Twitter's tags use `name`, not `property`.
 *
 * @public
 */
export function twitterTags(metadata: OpenGraphMetadata, site?: string): ReadonlyArray<HeadTag> {
	const tags: HeadTag[] = [
		metaNamed("twitter:card", metadata.ogImage ? "summary_large_image" : "summary"),
		metaNamed("twitter:description", metadata.description),
	];
	if (site != null && site !== "") tags.push(metaNamed("twitter:site", site));
	if (metadata.ogImage) {
		tags.push(metaNamed("twitter:image", metadata.ogImage.url));
		if (metadata.ogImage.alt) tags.push(metaNamed("twitter:image:alt", metadata.ogImage.alt));
	}
	return tags;
}
