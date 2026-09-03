/**
 * The VitePress sidebar rendered from a `@tsdoctor/pages` {@link NavTree}:
 * one `themeConfig.sidebar` entry keyed by the API's base route, holding the
 * index link and one collapsible group per category that received a page.
 *
 * @remarks
 * A pure function of the tree. The renderer defaults (`collapsed` true when
 * the category says nothing) are sidebar policy the tree leaves to its
 * consumer.
 *
 * @packageDocumentation
 */

import type { NavGroup, NavTree } from "@tsdoctor/pages";

/**
 * One VitePress sidebar item — the subset of the default theme's
 * `SidebarItem` this adapter emits. Arrays are mutable because VitePress's
 * own `Sidebar` type is, and a `ReadonlyArray` would not assign to it.
 *
 * @public
 */
export interface SidebarItem {
	/** The item label. */
	readonly text: string;
	/** The page route, when the item is a link. */
	readonly link?: string;
	/** Child items, when the item is a group. */
	readonly items?: SidebarItem[];
	/** Whether a group starts collapsed; absent leaves it always open. */
	readonly collapsed?: boolean;
}

/**
 * A multi-sidebar object: sidebar items keyed by the path prefix they
 * apply to.
 *
 * @public
 */
export type SidebarMulti = Record<string, SidebarItem[]>;

/** One category group as a collapsible sidebar section. */
export function sidebarGroup(group: NavGroup): SidebarItem {
	const collapsible = group.category.collapsible ?? true;
	return {
		text: group.category.displayName,
		items: group.pages.map((page) => ({ text: page.label, link: page.route })),
		...(collapsible ? { collapsed: group.category.collapsed ?? true } : {}),
	};
}

/**
 * The sidebar items for one API: the index link, then one group per
 * category in the tree's order.
 *
 * @public
 */
export function sidebarItems(tree: NavTree): SidebarItem[] {
	return [{ text: tree.index.label, link: `${tree.baseRoute}/` }, ...tree.groups.map(sidebarGroup)];
}

/**
 * The `themeConfig.sidebar` entry for one API, keyed by its base route so
 * the sidebar shows only under the API's pages.
 *
 * @public
 */
export function sidebarFor(tree: NavTree): SidebarMulti {
	return { [`${tree.baseRoute}/`]: sidebarItems(tree) };
}
