/**
 * The default category set: one group per API item kind, with the folder,
 * singular name and sidebar presentation each carries.
 *
 * @remarks
 * The same seven categories the RSPress plugin's `DEFAULT_CATEGORIES`
 * declares, so both adapters generate the same routes from the same bundle.
 * A shared home for the defaults is a Tier 2 candidate; until then keep the
 * two in step.
 *
 * @packageDocumentation
 */

import { ApiItemKind } from "@microsoft/api-extractor-model";
import type { NavCategory, WorkItemCategory } from "@tsdoctor/pages";

/**
 * A category as this adapter configures it: how items match it, where its
 * pages live, and how its sidebar group presents.
 *
 * @public
 */
export interface CategoryConfig extends WorkItemCategory {
	/** Whether the sidebar group can be collapsed. Defaults to `true`. */
	readonly collapsible?: boolean | undefined;
	/** Whether the sidebar group starts collapsed. Defaults to `true`. */
	readonly collapsed?: boolean | undefined;
}

const category = (
	displayName: string,
	singularName: string,
	folderName: string,
	kind: ApiItemKind,
): CategoryConfig => ({
	displayName,
	singularName,
	folderName,
	itemKinds: [kind],
	collapsible: true,
	collapsed: true,
});

/**
 * The default categories, in sidebar order.
 *
 * @public
 */
export const DEFAULT_CATEGORIES: Readonly<Record<string, CategoryConfig>> = {
	classes: category("Classes", "Class", "class", ApiItemKind.Class),
	interfaces: category("Interfaces", "Interface", "interface", ApiItemKind.Interface),
	functions: category("Functions", "Function", "function", ApiItemKind.Function),
	types: category("Types", "Type", "type", ApiItemKind.TypeAlias),
	enums: category("Enums", "Enum", "enum", ApiItemKind.Enum),
	variables: category("Variables", "Variable", "variable", ApiItemKind.Variable),
	namespaces: category("Namespaces", "Namespace", "namespace", ApiItemKind.Namespace),
};

/** The navigation-tree view of a category. */
export function navCategory(config: CategoryConfig): NavCategory {
	return {
		displayName: config.displayName,
		folderName: config.folderName,
		...(config.collapsible !== undefined ? { collapsible: config.collapsible } : {}),
		...(config.collapsed !== undefined ? { collapsed: config.collapsed } : {}),
	} as NavCategory;
}
