/**
 * `@tsdoctor/seo` — framework-neutral `<head>` metadata for static TypeScript
 * API documentation: schema.org JSON-LD, Open Graph and Twitter card
 * vocabulary, canonical URLs, and package attribution.
 *
 * @packageDocumentation
 */

export type { AttributionFacts } from "./Attribution.js";
export { attributionFacts } from "./Attribution.js";
export { canonicalUrl, deriveSiteUrl, imageMimeType, resolveUrl } from "./Canonical.js";
export type { HeadTag } from "./HeadTag.js";
export { escapeScriptBody, jsonLd, link, meta, metaNamed } from "./HeadTag.js";
export {
	OpenGraphImageConfig,
	OpenGraphImageMetadata,
	OpenGraphMetadata,
	createPageMetadata,
	ogAltText,
	openGraphTags,
	twitterTags,
} from "./OpenGraph.js";
export type { SeoPageInput } from "./Seo.js";
export { headTags } from "./Seo.js";
export type {
	PackageContext,
	PackageNodeInput,
	PageNodeInput,
	StructuredDataError,
} from "./StructuredData.js";
export { derive, deriveScriptBody, packageContext } from "./StructuredData.js";
