/**
 * Work-item preparation — the per-API step that turns a loaded model into
 * the flat list of pages to build plus the cross-link route map every
 * emitter's prose links resolve against.
 *
 * @remarks
 * Lifted from the RSPress adapter's `prepareWorkItems` once the VitePress
 * adapter needed the same computation: entry-point deduplication, synthetic
 * base detection, categorization, route-collision detection, the
 * priority-arbitrated route map, member anchors and namespace members.
 * Nothing here is framework-shaped; what the adapter kept is the reporting
 * — uncategorized items and route collisions come back as DATA in the
 * result, and the caller decides whether to warn or fail.
 *
 * @packageDocumentation
 */

import type { ApiClass, ApiInterface, ApiItem, ApiPackage } from "@microsoft/api-extractor-model";
import { ApiItems, EntryPoints, Routes, SyntheticBases } from "@tsdoctor/model";

/**
 * Cross-link priority by API item kind (lower = higher priority). When a bare
 * name maps to multiple pages (the const+type companion pattern), the bare
 * cross-link resolves to the higher-priority kind — value declarations win
 * over type-only declarations, so `Foo` links to the importable schema, not
 * the type.
 */
const CROSS_LINK_KIND_PRIORITY: Record<string, number> = {
	Class: 0,
	Function: 1,
	Variable: 2,
	Enum: 3,
	Interface: 4,
	TypeAlias: 5,
	Namespace: 6,
};

/**
 * Lower number = higher priority for which page a bare cross-link name
 * resolves to.
 *
 * @public
 */
export function crossLinkKindPriority(kind: string): number {
	return CROSS_LINK_KIND_PRIORITY[kind] ?? 100;
}

/**
 * The facts a category contributes to work-item preparation: how items are
 * matched to it and where its pages live.
 *
 * @public
 */
export interface WorkItemCategory extends ApiItems.CategorySpec {
	/** The category's plural display name. */
	readonly displayName: string;
	/** The category's singular name — the second title part. */
	readonly singularName: string;
	/** The folder the category's pages live in. */
	readonly folderName: string;
}

/**
 * One page to build: the item plus every fact the builder needs from the
 * model that the item alone does not carry.
 *
 * @public
 */
export interface WorkItem<C extends WorkItemCategory = WorkItemCategory> {
	/** The documented item. */
	readonly item: ApiItem;
	/** The category key the item was categorized under. */
	readonly categoryKey: string;
	/** The category the item was categorized under. */
	readonly categoryConfig: C;
	/** Present when the item is a namespace member documented on its own page. */
	readonly namespaceMember?: ApiItems.NamespaceMember;
	/** Entry points this item is available from. */
	readonly availableFrom?: string[];
	/**
	 * Unexported base declaration referenced by this class's extends clause
	 * (the `Foo_base` variable TypeScript emits for `Schema.Class`-style
	 * patterns). Rendered inline on the class page instead of its own page.
	 */
	readonly syntheticBase?: ApiItem;
	/**
	 * Anchor id per member, keyed by the member's canonical reference.
	 *
	 * @remarks
	 * Computed here rather than in the page builder so the `#fragment` in the
	 * cross-link route map and the id the page emits come from ONE computation
	 * and cannot drift. Present for classes and interfaces.
	 */
	readonly memberAnchors?: ReadonlyMap<string, string>;
}

/**
 * The cross-link maps: display name to route, and display name to item kind
 * (used only to arbitrate which kind owns a bare name).
 *
 * @public
 */
export interface CrossLinkData {
	/** Display name (or `Class.member` key) to route path. */
	readonly routes: Map<string, string>;
	/** Display name to API item kind. */
	readonly kinds: Map<string, string>;
}

/**
 * The input to {@link prepareWorkItems}.
 *
 * @public
 */
export interface PrepareWorkItemsInput<C extends WorkItemCategory = WorkItemCategory> {
	/** The loaded API model. */
	readonly apiPackage: ApiPackage;
	/** The categories, in the order their groups are listed. */
	readonly categories: Readonly<Record<string, C>>;
	/** The API's base route. */
	readonly baseRoute: string;
}

/**
 * The result of {@link prepareWorkItems}.
 *
 * @remarks
 * `uncategorized` and `collisions` are returned rather than reported: the
 * RSPress adapter emits an `ItemSkipped` event per uncategorized item and
 * throws `Routes.RouteCollisionError` on any collision, and a second adapter
 * decides for itself. A caller that ignores `collisions` will write two
 * distinct items to one route, so check it.
 *
 * @public
 */
export interface PrepareWorkItemsResult<C extends WorkItemCategory = WorkItemCategory> {
	/** Every page to build, top-level items first then namespace members. */
	readonly workItems: WorkItem<C>[];
	/** The cross-link maps both prose and code linkers consume. */
	readonly crossLinkData: CrossLinkData;
	/** Items no category matched; they get no page. */
	readonly uncategorized: ReadonlyArray<ApiItem>;
	/** Distinct items that would share one output route. */
	readonly collisions: ReadonlyArray<Routes.RouteCollision>;
}

/**
 * Prepare the flat list of work items to build and the cross-link maps.
 *
 * @remarks
 * Resolves entry points into deduplicated items, detects synthetic base
 * declarations (excluded from categorization, collision detection and work
 * items — the owner class page renders them inline), categorizes, detects
 * route collisions on the lowercased `folder/name` route, builds the route
 * map with bare names owned by the highest-priority kind and member routes
 * from the model's anchors, adds namespace member routes (qualified always,
 * unqualified PascalCase when unambiguous), routes synthetic base names to
 * the owner's `#base-class` anchor, and flattens everything into work items.
 *
 * @public
 */
export function prepareWorkItems<C extends WorkItemCategory>(
	input: PrepareWorkItemsInput<C>,
): PrepareWorkItemsResult<C> {
	const { apiPackage, categories, baseRoute } = input;

	// 0. Resolve entry points into deduplicated items
	const resolvedItems = EntryPoints.resolve(apiPackage);

	// 0b. Synthetic base declarations get no page of their own.
	const syntheticBases = SyntheticBases.detect(resolvedItems.map((r) => r.item));
	const docItems = syntheticBases.bases.size
		? resolvedItems.filter((r) => !syntheticBases.bases.has(r.item))
		: resolvedItems;

	const resolvedLookup = new Map<string, EntryPoints.ResolvedEntryItem>();
	for (const resolved of docItems) {
		resolvedLookup.set(`${resolved.item.displayName}::${resolved.item.kind}`, resolved);
	}

	// 1. Categorize; items no category matched come back as data.
	const { items, uncategorized } = ApiItems.categorize(docItems, categories);

	// 1b. Namespace members (needed for both candidates and routes below)
	const namespaceMembers = ApiItems.namespaceMembers(docItems);

	const categoryFor = (item: ApiItem): [string, C] | undefined =>
		Object.entries(categories).find(([, config]) => config.itemKinds?.includes(item.kind)) as [string, C] | undefined;

	// 1c. Route collisions: two distinct items on one lowercased category route.
	//     The companion const+type pattern routes to different folders and is
	//     NOT a collision.
	const candidates: Routes.RouteCandidate[] = [];
	for (const [categoryKey, categoryConfig] of Object.entries(categories)) {
		for (const item of items[categoryKey] || []) {
			candidates.push(
				new Routes.RouteCandidate({
					id: `${item.displayName}::${item.kind}`,
					displayName: item.displayName,
					folder: categoryConfig.folderName,
					baseName: item.displayName.toLowerCase(),
					kind: String(item.kind),
					canonicalRef: item.canonicalReference?.toString() ?? item.displayName,
				}),
			);
		}
	}
	for (const nsMember of namespaceMembers) {
		const nsCategory = categoryFor(nsMember.item);
		if (!nsCategory) continue;
		candidates.push(
			new Routes.RouteCandidate({
				id: nsMember.qualifiedName,
				displayName: nsMember.qualifiedName,
				folder: nsCategory[1].folderName,
				baseName: nsMember.qualifiedName.toLowerCase(),
				kind: String(nsMember.item.kind),
				canonicalRef: nsMember.item.canonicalReference?.toString() ?? nsMember.qualifiedName,
			}),
		);
	}
	const collisions = Routes.detectCollisions(candidates);

	// 2. Cross-link routes and kinds maps
	const routes = new Map<string, string>();
	const kinds = new Map<string, string>();
	// Tracks the cross-link kind priority that currently owns each bare-name
	// route, so a companion's bare name deterministically resolves to the value page.
	const routeOwnerPriority = new Map<string, number>();

	for (const [categoryKey, categoryConfig] of Object.entries(categories)) {
		for (const item of items[categoryKey] || []) {
			const itemRoute = `${baseRoute}/${categoryConfig.folderName}/${item.displayName.toLowerCase()}`;
			const priority = crossLinkKindPriority(String(item.kind));
			const existingPriority = routeOwnerPriority.get(item.displayName);
			if (existingPriority === undefined || priority < existingPriority) {
				routes.set(item.displayName, itemRoute);
				kinds.set(item.displayName, item.kind);
				routeOwnerPriority.set(item.displayName, priority);
			}

			// Anchors and cross-link keys both come from the model, so the
			// `#fragment` a key resolves to is the same one the page emits.
			if (item.kind === "Class" || item.kind === "Interface") {
				const itemWithMembers = item as ApiClass | ApiInterface;
				const anchors = ApiItems.memberAnchors(itemWithMembers);
				const byCanonicalRef = new Map(
					itemWithMembers.members.map((member) => [
						member.canonicalReference?.toString() ?? member.displayName,
						member,
					]),
				);
				for (const [routeKey, memberId] of ApiItems.memberRouteKeys(itemWithMembers)) {
					const member = byCanonicalRef.get(memberId);
					if (!member) continue;
					const anchor = anchors.get(memberId) ?? Routes.memberAnchor(member.displayName);
					routes.set(routeKey, `${itemRoute}#${anchor}`);
					kinds.set(routeKey, member.kind);
				}
			}
		}
	}

	// 3. Namespace member routes
	const unqualifiedNameCounts = new Map<string, number>();
	for (const nsMember of namespaceMembers) {
		const name = nsMember.item.displayName;
		unqualifiedNameCounts.set(name, (unqualifiedNameCounts.get(name) || 0) + 1);
	}

	for (const nsMember of namespaceMembers) {
		const category = categoryFor(nsMember.item);
		if (!category) continue;
		const qualifiedRoute = `${baseRoute}/${category[1].folderName}/${nsMember.qualifiedName.toLowerCase()}`;

		routes.set(nsMember.qualifiedName, qualifiedRoute);
		kinds.set(nsMember.qualifiedName, nsMember.item.kind);

		const displayName = nsMember.item.displayName;
		const isPascalCase = /^[A-Z]/.test(displayName);
		if (isPascalCase && (unqualifiedNameCounts.get(displayName) || 0) <= 1 && !routes.has(displayName)) {
			routes.set(displayName, qualifiedRoute);
			kinds.set(displayName, nsMember.item.kind);
		}
	}

	// 3b. Synthetic base names route to the owner class page's inline section,
	//     so the `extends Foo_base` reference in signatures stays clickable.
	for (const [baseItem, syntheticBase] of syntheticBases.bases) {
		const baseName = baseItem.displayName;
		if (routes.has(baseName)) continue;
		const owner = syntheticBase.ownerClasses[0];
		const ownerRoute = owner ? routes.get(owner.displayName) : undefined;
		if (!ownerRoute) continue;
		routes.set(baseName, `${ownerRoute}#${SyntheticBases.BASE_CLASS_ANCHOR}`);
		kinds.set(baseName, baseItem.kind);
	}

	// 4. Flatten into work items
	const workItems: WorkItem<C>[] = [];
	for (const [categoryKey, categoryConfig] of Object.entries(categories)) {
		for (const item of items[categoryKey] || []) {
			const resolved = resolvedLookup.get(`${item.displayName}::${item.kind}`);
			const syntheticBase = syntheticBases.baseByOwner.get(item);
			const memberAnchors =
				item.kind === "Class" || item.kind === "Interface"
					? ApiItems.memberAnchors(item as ApiClass | ApiInterface)
					: undefined;
			workItems.push({
				item,
				categoryKey,
				categoryConfig,
				...(resolved?.availableFrom != null ? { availableFrom: resolved.availableFrom } : {}),
				...(syntheticBase != null ? { syntheticBase } : {}),
				...(memberAnchors != null ? { memberAnchors } : {}),
			});
		}
	}
	for (const nsMember of namespaceMembers) {
		const category = categoryFor(nsMember.item);
		if (category) {
			workItems.push({
				item: nsMember.item,
				categoryKey: category[0],
				categoryConfig: category[1],
				namespaceMember: nsMember,
			});
		}
	}

	return { workItems, crossLinkData: { routes, kinds }, uncategorized, collisions };
}
