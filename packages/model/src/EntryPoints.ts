/**
 * Multi-entry-point resolution: flatten a package's entry points into
 * deduplicated items, recording which entry points export each one. Pure.
 *
 * @packageDocumentation
 */

import type { ApiItem, ApiPackage } from "@microsoft/api-extractor-model";

/**
 * A resolved API item with entry point metadata for deduplication.
 *
 * @public
 */
export interface ResolvedEntryItem {
	/** The API item from the model */
	readonly item: ApiItem;
	/** Which entry point defines this item (canonical owner) */
	readonly definingEntryPoint: string;
	/** All entry points that export this item (includes re-exports) */
	readonly availableFrom: string[];
}

/**
 * Derive an entry point name from its display name in the API model.
 *
 * - Empty string (main entry `.` in package.json) maps to `"default"`
 * - Named entries (e.g. `"testing"`) keep their name
 *
 * @public
 */
export function entryPointName(displayName: string): string {
	return displayName === "" ? "default" : displayName;
}

/**
 * Create a stable identity key for an API item based on its display name and kind.
 * Used to detect re-exports across entry points.
 */
function itemKey(item: ApiItem): string {
	return `${item.displayName}::${item.kind}`;
}

/**
 * Resolve all entry points from an API package into a flat list of
 * deduplicated items.
 *
 * - Re-exported items (same displayName + kind across entries) are
 *   deduplicated to a single entry with `availableFrom` listing all
 *   entry points. The defining entry point prefers `"default"`.
 * - Items with different kinds but the same displayName (e.g. the
 *   Effect const + type companion pattern) remain as separate entries.
 *
 * @param apiPackage - The merged API package with 1+ entry points
 * @returns Flat array of resolved items
 *
 * @public
 */
export function resolve(apiPackage: ApiPackage): ResolvedEntryItem[] {
	// Step 1: Collect all items grouped by key, tracking which entry points export them
	const itemsByKey = new Map<
		string,
		Array<{
			item: ApiItem;
			entryPointName: string;
		}>
	>();

	for (const entryPoint of apiPackage.entryPoints) {
		const epName = entryPointName(entryPoint.displayName);
		for (const member of entryPoint.members) {
			const key = itemKey(member);
			const existing = itemsByKey.get(key) || [];
			existing.push({ item: member, entryPointName: epName });
			itemsByKey.set(key, existing);
		}
	}

	// Step 2: Deduplicate each key, preferring "default" as the canonical owner
	const resolved: ResolvedEntryItem[] = [];
	for (const [, entries] of itemsByKey) {
		if (entries.length === 1) {
			const { item, entryPointName: epName } = entries[0];
			resolved.push({ item, definingEntryPoint: epName, availableFrom: [epName] });
		} else {
			const definingEntry = entries.find((e) => e.entryPointName === "default") || entries[0];
			const allEntryPoints = [...new Set(entries.map((e) => e.entryPointName))];
			resolved.push({
				item: definingEntry.item,
				definingEntryPoint: definingEntry.entryPointName,
				availableFrom: allEntryPoints,
			});
		}
	}
	return resolved;
}
