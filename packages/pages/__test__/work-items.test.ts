import { describe, expect, it } from "vitest";

import type { WorkItemCategory } from "../src/WorkItems.js";
import { crossLinkKindPriority, prepareWorkItems } from "../src/WorkItems.js";
import { loadKitchensink } from "./utils/kitchensink.js";

const category = (displayName: string, singularName: string, folderName: string, kind: string): WorkItemCategory => ({
	displayName,
	singularName,
	folderName,
	itemKinds: [kind],
});

const categories = {
	classes: category("Classes", "Class", "class", "Class"),
	interfaces: category("Interfaces", "Interface", "interface", "Interface"),
	functions: category("Functions", "Function", "function", "Function"),
	types: category("Types", "Type", "type", "TypeAlias"),
	enums: category("Enums", "Enum", "enum", "Enum"),
	variables: category("Variables", "Variable", "variable", "Variable"),
	namespaces: category("Namespaces", "Namespace", "namespace", "Namespace"),
};

describe("prepareWorkItems", () => {
	it("flattens every categorized item plus namespace members into work items", () => {
		const { workItems, uncategorized, collisions } = prepareWorkItems({
			apiPackage: loadKitchensink(),
			categories,
			baseRoute: "/api",
		});
		expect(workItems.length).toBeGreaterThan(0);
		expect(uncategorized).toEqual([]);
		expect(collisions).toEqual([]);
		// Namespace members come after the top-level items, carrying their qualified name.
		const members = workItems.filter((w) => w.namespaceMember !== undefined);
		expect(members.length).toBeGreaterThan(0);
		for (const member of members) expect(member.namespaceMember?.qualifiedName).toContain(".");
		// Classes and interfaces carry their member anchors as data.
		for (const w of workItems.filter((w) => w.item.kind === "Class" || w.item.kind === "Interface")) {
			expect(w.memberAnchors).toBeInstanceOf(Map);
		}
	});

	it("builds routes that agree with the work items' folders and member anchors", () => {
		const { workItems, crossLinkData } = prepareWorkItems({
			apiPackage: loadKitchensink(),
			categories,
			baseRoute: "/api",
		});
		for (const w of workItems) {
			const name = w.namespaceMember?.qualifiedName ?? w.item.displayName;
			const route = crossLinkData.routes.get(name);
			// A bare name may be owned by a higher-priority companion; the qualified
			// or unique name always resolves into its own folder.
			if (route !== undefined && !route.includes("#")) {
				expect(route.startsWith(`/api/${w.categoryConfig.folderName}/`) || w.namespaceMember === undefined).toBe(true);
			}
			if (w.memberAnchors) {
				for (const anchor of w.memberAnchors.values()) {
					const memberRoutes = [...crossLinkData.routes.values()].filter((r) => r.endsWith(`#${anchor}`));
					expect(memberRoutes.length).toBeGreaterThan(0);
				}
			}
		}
	});

	// FORBIDS: silently dropping items — an adapter that ignored uncategorized
	// items would document a partial API with nothing in its output to notice.
	it("returns uncategorized items as data rather than dropping them silently", () => {
		const { workItems, uncategorized } = prepareWorkItems({
			apiPackage: loadKitchensink(),
			categories: { classes: categories.classes },
			baseRoute: "/api",
		});
		expect(workItems.every((w) => w.item.kind === "Class")).toBe(true);
		expect(uncategorized.length).toBeGreaterThan(0);
		expect(uncategorized.some((item) => item.kind === "Function")).toBe(true);
	});

	// Collision detection itself is pinned in the model's Routes tests; this
	// is the control that merging two kinds into one folder is NOT a
	// collision unless names actually coincide (kitchensink's do not).
	it("reports no collision for a folder merge without shared names", () => {
		const { collisions } = prepareWorkItems({
			apiPackage: loadKitchensink(),
			categories: { t: category("T", "T", "shared", "TypeAlias"), i: category("I", "I", "shared", "Interface") },
			baseRoute: "/api",
		});
		expect(collisions).toEqual([]);
	});

	it("ranks value kinds above type-only kinds for bare-name ownership", () => {
		expect(crossLinkKindPriority("Class")).toBeLessThan(crossLinkKindPriority("Interface"));
		expect(crossLinkKindPriority("Variable")).toBeLessThan(crossLinkKindPriority("TypeAlias"));
		expect(crossLinkKindPriority("Unknown")).toBe(100);
	});
});
