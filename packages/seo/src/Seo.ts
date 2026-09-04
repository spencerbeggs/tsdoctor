/**
 * The one seam an adapter consumes: everything a documentation page needs in
 * its `<head>`, as a flat array of neutral {@link HeadTag}s.
 *
 * @remarks
 * Composition lives here so that every adapter emits the same tags in the same
 * order. An adapter's job is to render a `HeadTag` into whatever its framework
 * calls a head entry — never to decide which tags a page gets.
 *
 * @packageDocumentation
 */

import { canonicalUrl } from "./Canonical.js";
import type { HeadTag } from "./HeadTag.js";
import { jsonLd, link } from "./HeadTag.js";
import type { OpenGraphImageMetadata } from "./OpenGraph.js";
import { createPageMetadata, openGraphTags, twitterTags } from "./OpenGraph.js";

/**
 * Everything {@link headTags} needs about one documentation page.
 *
 * @public
 */
export interface SeoPageInput {
	/** Site URL prefix, from `deriveSiteUrl`. `""` leaves every URL root-relative. */
	readonly siteUrl: string;
	/** Page route path, beginning with `/`. */
	readonly pageRoute: string;
	/** Page title, used for both `og:title` and `twitter:title`. */
	readonly title: string;
	/** Site name for the `og:site_name` tag, when the site declares one. */
	readonly siteName?: string;
	/** Page description, used for both `og:description` and `twitter:description`. */
	readonly description: string;
	/** ISO 8601 date string for `article:published_time`. */
	readonly publishedTime: string;
	/** ISO 8601 date string for `article:modified_time`. */
	readonly modifiedTime: string;
	/** Article section label (e.g. `"Classes"`). */
	readonly section: string;
	/** The documented package's npm name. */
	readonly packageName: string;
	/** Resolved Open Graph image, when the API declares one. */
	readonly ogImage?: OpenGraphImageMetadata;
	/** The `twitter:site` handle, when the site declares one. */
	readonly twitterSite?: string;
	/** A serialized JSON-LD graph. Absent until structured data is wired. */
	readonly structuredData?: string;
}

/**
 * Every `<head>` tag for one documentation page.
 *
 * @remarks
 * The order — canonical link, Open Graph block, Twitter block, then the
 * JSON-LD script — is fixed. It carries no semantics: a crawler reads the
 * tags as a set. It is fixed so that a page's emitted head is stable
 * build-to-build and a diff over generated pages stays readable.
 *
 * @public
 */
export function headTags(input: SeoPageInput): ReadonlyArray<HeadTag> {
	const metadata = createPageMetadata({
		siteUrl: input.siteUrl,
		pageRoute: input.pageRoute,
		title: input.title,
		...(input.siteName != null ? { siteName: input.siteName } : {}),
		description: input.description,
		publishedTime: input.publishedTime,
		modifiedTime: input.modifiedTime,
		section: input.section,
		packageName: input.packageName,
		...(input.ogImage != null ? { ogImage: input.ogImage } : {}),
	});

	const tags: HeadTag[] = [
		link("canonical", canonicalUrl(input.siteUrl, input.pageRoute)),
		...openGraphTags(metadata),
		...twitterTags(metadata, input.twitterSite),
	];

	if (input.structuredData != null && input.structuredData !== "") {
		tags.push(jsonLd(input.structuredData));
	}

	return tags;
}
