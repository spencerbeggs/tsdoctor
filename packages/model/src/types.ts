/**
 * Public types for the markdown output system. The two consumer-specific pieces
 * — frontmatter and crosslink routes — are injected via FrontmatterRenderer and
 * RouteFormatter; the body rendering is shared.
 *
 * @packageDocumentation
 */

import type { ApiItem } from "@microsoft/api-extractor-model";

/**
 * URL-stable slug for an item kind, used in routes and generated doc paths.
 *
 * @public
 */
export type ItemKindSlug = "class" | "interface" | "function" | "type" | "variable" | "enum" | "namespace";

/**
 * A reference to a renderable top-level API item.
 *
 * @public
 */
export interface ApiItemRef {
	readonly name: string;
	readonly kind: ItemKindSlug;
	/** Lowercased name for the file/url, e.g. "managedsection". */
	readonly slug: string;
}

/**
 * Metadata handed to the injected frontmatter renderer for one doc.
 *
 * @public
 */
export interface DocMeta extends ApiItemRef {
	readonly summary: string;
	readonly packageName: string;
}

/**
 * Injected: turn an item reference into a crosslink URL (the only scheme difference).
 *
 * @public
 */
export type RouteFormatter = (ref: ApiItemRef) => string;

/**
 * Injected: produce the frontmatter block (incl. trailing blank line) for a doc, or "".
 *
 * @public
 */
export type FrontmatterRenderer = (meta: DocMeta) => string;

/**
 * One rendered API doc = its metadata plus the assembled markdown (frontmatter + body).
 *
 * @public
 */
export interface RenderedDoc extends DocMeta {
	readonly markdown: string;
}

/**
 * Options for {@link renderPackage}: the package name plus the optional injected
 * route, frontmatter, and filter services.
 *
 * @public
 */
export interface RenderPackageOptions {
	/** Package display name (used in fallbacks + handed to the frontmatter renderer). */
	readonly packageName: string;
	/** Injected crosslink scheme. Omit → no cross-linking. */
	readonly routeFor?: RouteFormatter;
	/** Injected frontmatter. Omit → bodies only. */
	readonly frontmatter?: FrontmatterRenderer;
	/**
	 * Predicate deciding whether a top-level item is emitted (and registered as a
	 * crosslink target). Returns `true` to keep the item. Omit → the default rule
	 * {@link isEmittable} drops compiler-synthetic forgotten exports
	 * (`isExported === false`). Providing a filter fully replaces the default; compose
	 * with {@link isEmittable} to retain the forgotten-export drop.
	 */
	readonly filter?: (item: ApiItem) => boolean;
}
