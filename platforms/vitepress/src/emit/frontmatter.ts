/**
 * Frontmatter assembly for generated pages: the page title and description
 * plus the neutral `@tsdoctor/seo` head tags rendered into VitePress's
 * `HeadConfig` shape.
 *
 * @remarks
 * Adapter-side on purpose — the IR carries facts and a `HeadTag[]`, not a
 * block. VitePress spells a `meta`/`link` tag as a `[tag, attrs]` pair and a
 * script body as the `[tag, attrs, innerHTML]` TRIPLE; RSPress spells the
 * same body as a `children` attribute. That one difference is why assembly
 * is not shared.
 *
 * @packageDocumentation
 */

import { emitFrontmatterBlock } from "@tsdoctor/model";
import type { HeadTag } from "@tsdoctor/seo";

/**
 * One VitePress head entry: a pair for an attribute-only tag, a triple when
 * the tag carries inner HTML.
 *
 * @public
 */
export type HeadConfig = [string, Record<string, string>] | [string, Record<string, string>, string];

/**
 * Collapse newlines and runs of whitespace to single spaces, and trim.
 *
 * @remarks
 * Whitespace normalization, not quoting — `@effected/yaml` owns quoting.
 */
function cleanValue(value: string): string {
	return value
		.replace(/[\r\n]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

/**
 * Render a neutral head tag into VitePress's `HeadConfig` entry.
 *
 * @public
 */
export function headConfig(tag: HeadTag): HeadConfig {
	const attrs: Record<string, string> = {};
	for (const [key, value] of Object.entries(tag.attrs)) attrs[key] = cleanValue(value);
	return tag.body != null ? [tag.tag, attrs, cleanValue(tag.body)] : [tag.tag, attrs];
}

/**
 * The facts a page's frontmatter is built from.
 *
 * @public
 */
export interface FrontmatterInput {
	/** The page title. */
	readonly title: string;
	/** The page description. */
	readonly description: string;
	/** Every head tag the page carries. */
	readonly headTags?: ReadonlyArray<HeadTag> | undefined;
}

/**
 * Emit the frontmatter block for a page: `title`, `description` and, when
 * the page carries any, `head` in VitePress's `HeadConfig[]` shape.
 *
 * @public
 */
export function emitFrontmatter(input: FrontmatterInput): string {
	const data: Record<string, unknown> = {
		title: cleanValue(input.title),
		description: cleanValue(input.description),
	};
	const head = (input.headTags ?? []).map(headConfig);
	if (head.length > 0) data.head = head;
	return emitFrontmatterBlock(data);
}
