/**
 * The page record — the unit of the IR: the facts an adapter builds its
 * frontmatter from, the ordered blocks, and the page's navigation entry.
 *
 * @remarks
 * Frontmatter assembly deliberately stays adapter-side. The IR carries the
 * title parts, the description and the neutral `HeadTag[]` from
 * `@tsdoctor/seo`; RSPress spells a JSON-LD script body as a `children`
 * attribute and VitePress as a third tuple element, and the RSPress
 * frontmatter hash is taken over the FINAL assembled block in its generate
 * stage — a contract that must not move.
 *
 * @packageDocumentation
 */

import type { HeadTag as SeoHeadTag } from "@tsdoctor/seo";
import { Schema } from "effect";

import { Block } from "./Blocks.js";
import { NavEntry } from "./Nav.js";

/**
 * The neutral head tag, as a schema — the same shape as `@tsdoctor/seo`'s
 * `HeadTag` interface, so a value from `headTags` is accepted unchanged.
 *
 * @public
 */
export const HeadTag = Schema.Struct({
	/** The element name. */
	tag: Schema.Literals(["meta", "link", "script"]),
	/** The element attributes. */
	attrs: Schema.Record(Schema.String, Schema.String),
	/** Element content; only meaningful for `script`. */
	body: Schema.optionalKey(Schema.String),
});

/**
 * A neutral head tag value.
 *
 * @public
 */
export type HeadTag = typeof HeadTag.Type;

// The seo interface and the schema type must stay mutually assignable, or
// an adapter could not hand `headTags(...)` output to `Page.make` unchanged.
const _seoToSchema: HeadTag = null as unknown as SeoHeadTag;
const _schemaToSeo: SeoHeadTag = null as unknown as HeadTag;
void _seoToSchema;
void _schemaToSeo;

/**
 * The kind of symbol a page documents — which builder produced it, and
 * which component imports and block layout an emitter chooses.
 *
 * @public
 */
export const PageKind = Schema.Literals([
	"class",
	"interface",
	"function",
	"type-alias",
	"enum",
	"variable",
	"namespace",
]);

/**
 * A page kind value.
 *
 * @public
 */
export type PageKind = typeof PageKind.Type;

/**
 * One generated API page.
 *
 * @public
 */
export class Page extends Schema.Class<Page>("Page")({
	/** The kind of symbol the page documents. */
	kind: PageKind,
	/** The documented item's display name — the first title part. */
	entityName: Schema.String,
	/** The category's singular name (`Class`, `Function`) — the second title part. */
	singularName: Schema.String,
	/** The API's display name — the last title part, when the site names one. */
	apiName: Schema.optionalKey(Schema.String),
	/** The page description: the item's summary, or the fallback the generators used. */
	description: Schema.String,
	/** The page route. */
	route: Schema.String,
	/** Every `<head>` tag the page carries, from `@tsdoctor/seo`. */
	headTags: Schema.Array(HeadTag),
	/** The page body, in order. */
	blocks: Schema.Array(Block),
	/** The page's place in the navigation tree. */
	nav: NavEntry,
}) {
	/**
	 * The structured page title: `{entityName} | {singularName} | API | {apiName}`,
	 * the last part omitted when the site names no API.
	 */
	get title(): string {
		const parts = [this.entityName, this.singularName, "API"];
		if (this.apiName !== undefined) parts.push(this.apiName);
		return parts.join(" | ");
	}
}
