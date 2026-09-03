/**
 * The per-API navigation tree — category groups of pages plus the index —
 * as data, so a sidebar that is files in one framework and config in another
 * is a pure rendering of the same value.
 *
 * @remarks
 * The ordering is the one the RSPress adapter's `writeMetadata` produced when
 * it wrote `_meta.json` files directly: groups in category insertion order,
 * kept only when at least one page landed in them; pages within a group by
 * `label.localeCompare`; the index page always present. `buildNav` is
 * characterized against that behaviour, and the RSPress rendering of this
 * tree is covered by the golden gate.
 *
 * @packageDocumentation
 */

import { Schema } from "effect";

/**
 * A page's place in the navigation tree, carried on the page itself.
 *
 * @public
 */
export class NavEntry extends Schema.Class<NavEntry>("NavEntry")({
	/** The category key the page was categorized under. */
	categoryKey: Schema.String,
	/** The sidebar label — the display name, qualified for a namespace member. */
	label: Schema.String,
	/** The file basename without extension (`foo` for `class/foo.mdx`). */
	name: Schema.String,
	/** The page route. */
	route: Schema.String,
}) {}

/**
 * The per-category presentation facts a tree carries for its groups.
 *
 * @public
 */
export class NavCategory extends Schema.Class<NavCategory>("NavCategory")({
	/** The group label. */
	displayName: Schema.String,
	/** The folder the category's pages live in. */
	folderName: Schema.String,
	/** Whether the group can be collapsed; absent means the renderer's default. */
	collapsible: Schema.optionalKey(Schema.Boolean),
	/** Whether the group starts collapsed; absent means the renderer's default. */
	collapsed: Schema.optionalKey(Schema.Boolean),
	/** Heading depths surfaced in an overview; absent means the renderer's default. */
	overviewHeaders: Schema.optionalKey(Schema.Array(Schema.Number)),
}) {}

/**
 * One page in a group.
 *
 * @public
 */
export class NavPage extends Schema.Class<NavPage>("NavPage")({
	/** The sidebar label. */
	label: Schema.String,
	/** The file basename without extension. */
	name: Schema.String,
	/** The page route. */
	route: Schema.String,
}) {}

/**
 * One category group with its pages, already sorted.
 *
 * @public
 */
export class NavGroup extends Schema.Class<NavGroup>("NavGroup")({
	/** The category key. */
	key: Schema.String,
	/** The category presentation facts. */
	category: NavCategory,
	/** The group's pages, sorted by label. */
	pages: Schema.Array(NavPage),
}) {}

/**
 * The navigation tree for one API.
 *
 * @public
 */
export class NavTree extends Schema.Class<NavTree>("NavTree")({
	/** The API's base route; the index page lives at its root. */
	baseRoute: Schema.String,
	/** The index page. */
	index: NavPage,
	/** The category groups that received at least one page, in category order. */
	groups: Schema.Array(NavGroup),
}) {}

/**
 * The input to {@link buildNav}.
 *
 * @public
 */
export interface BuildNavInput {
	/** The API's base route. */
	readonly baseRoute: string;
	/** The categories in the order they were configured — insertion order is the group order. */
	readonly categories: Readonly<Record<string, NavCategory>>;
	/** Every generated page's entry, in any order. */
	readonly entries: ReadonlyArray<NavEntry>;
}

/**
 * The label of the index page every tree carries.
 *
 * @public
 */
export const NAV_INDEX_LABEL = "API Reference";

/**
 * Sort pages the way the sidebar lists them: alphabetically by label.
 *
 * @public
 */
export function sortNavPages(pages: ReadonlyArray<NavPage>): ReadonlyArray<NavPage> {
	return [...pages].sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Build the navigation tree for one API from its categories and its pages.
 *
 * @remarks
 * Groups follow `categories`' insertion order and a category with no page
 * is dropped rather than rendered empty. An entry whose category key names
 * no configured category is dropped too — it could not have been generated
 * into a folder — so the tree only ever describes pages that exist.
 *
 * @public
 */
export function buildNav(input: BuildNavInput): NavTree {
	const byCategory = new Map<string, NavPage[]>();
	for (const entry of input.entries) {
		const pages = byCategory.get(entry.categoryKey) ?? [];
		pages.push(NavPage.make({ label: entry.label, name: entry.name, route: entry.route }));
		byCategory.set(entry.categoryKey, pages);
	}

	const groups: NavGroup[] = [];
	for (const [key, category] of Object.entries(input.categories)) {
		const pages = byCategory.get(key);
		if (!pages || pages.length === 0) continue;
		groups.push(NavGroup.make({ key, category, pages: sortNavPages(pages) }));
	}

	return NavTree.make({
		baseRoute: input.baseRoute,
		index: NavPage.make({ label: NAV_INDEX_LABEL, name: "index", route: `${input.baseRoute}/index` }),
		groups,
	});
}
