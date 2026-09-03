/**
 * The RSPress navigation and landing-page emitters: the root and
 * per-category `_meta.json` files rendered from a `@tsdoctor/pages`
 * {@link NavTree}, and the `index.mdx` frontmatter rendered from an
 * {@link IndexPage}.
 *
 * @remarks
 * Pure functions of the IR. The renderer defaults (`collapsible` and
 * `collapsed` true, `overviewHeaders` `[2]`) are RSPress sidebar policy the
 * tree leaves to its consumer; the tab-indented JSON is the spelling the
 * snapshot system compares an existing file against.
 *
 * @packageDocumentation
 */

import { emitFrontmatterBlock } from "@tsdoctor/model";
import type { IndexPage, NavGroup, NavTree } from "@tsdoctor/pages";

/** One entry of the root `_meta.json`: a category folder. */
export interface RootMetaEntry {
	readonly type: "dir";
	readonly name: string;
	readonly label: string;
	readonly collapsible: boolean;
	readonly collapsed: boolean;
	readonly overviewHeaders: ReadonlyArray<number>;
}

/** One entry of a category `_meta.json`: a page. */
export interface CategoryMetaEntry {
	readonly type: "file";
	readonly name: string;
	readonly label: string;
}

/** The root `_meta.json` entries, one per category group that received a page. */
export function rootMetaEntries(tree: NavTree): ReadonlyArray<RootMetaEntry> {
	return tree.groups.map((group) => ({
		type: "dir",
		name: group.category.folderName,
		label: group.category.displayName,
		collapsible: group.category.collapsible ?? true,
		collapsed: group.category.collapsed ?? true,
		overviewHeaders: group.category.overviewHeaders ?? [2],
	}));
}

/** A category folder's `_meta.json` entries, in the tree's (label-sorted) order. */
export function categoryMetaEntries(group: NavGroup): ReadonlyArray<CategoryMetaEntry> {
	return group.pages.map((page) => ({ type: "file", name: page.name, label: page.label }));
}

/** Serialize `_meta.json` entries the way the plugin always has: tab-indented JSON, no trailing newline. */
export function renderMeta(entries: ReadonlyArray<RootMetaEntry | CategoryMetaEntry>): string {
	return JSON.stringify(entries, null, "\t");
}

/** The root `_meta.json` text for an API. */
export function renderRootMeta(tree: NavTree): string {
	return renderMeta(rootMetaEntries(tree));
}

/** A category folder's `_meta.json` text. */
export function renderCategoryMeta(group: NavGroup): string {
	return renderMeta(categoryMetaEntries(group));
}

/**
 * The `index.mdx` text for an API: frontmatter only, with RSPress's
 * `overview: true` so the page lists its category folders.
 */
export function emitIndexPage(index: IndexPage): string {
	return emitFrontmatterBlock({ title: index.title, description: index.description, overview: true });
}
