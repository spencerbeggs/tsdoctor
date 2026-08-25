/**
 * Pure API-item analysis: categorization, namespace member extraction,
 * inheritance, and source-link derivation. All functions accept either an
 * `ApiPackage` (legacy single-entry: reads `entryPoints[0]`) or the
 * `ResolvedEntryItem[]` produced by {@link EntryPoints.resolve | EntryPoints.resolve}.
 *
 * @packageDocumentation
 */

import type { ApiClass, ApiInterface, ApiItem, ApiNamespace, ApiPackage } from "@microsoft/api-extractor-model";
import { ApiItemKind } from "@microsoft/api-extractor-model";

import type { ResolvedEntryItem } from "./EntryPoints.js";
import * as Routes from "./Routes.js";
import * as Tsdoc from "./Tsdoc.js";

/**
 * The category rules `categorize` reads — a structural subset of a consumer's
 * richer category config (display names, sidebar options, …), so those configs
 * assign directly.
 *
 * @public
 */
export interface CategorySpec {
	/** API item kinds included in this category. */
	readonly itemKinds?: ReadonlyArray<string> | undefined;
	/** TSDoc modifier tag that marks items for this category (takes precedence). */
	readonly tsdocModifier?: string | undefined;
}

/**
 * The result of {@link categorize}: items grouped by category key, plus the
 * items no category matched. Uncategorized items are returned as data — the
 * caller decides whether to warn.
 *
 * @public
 */
export interface CategorizedItems {
	readonly items: Record<string, ApiItem[]>;
	readonly uncategorized: ReadonlyArray<ApiItem>;
}

/**
 * A member of a namespace with its parent namespace context.
 *
 * @public
 */
export interface NamespaceMember {
	/** The API item (class, interface, function, etc.) */
	readonly item: ApiItem;
	/** The parent namespace */
	readonly namespace: ApiNamespace;
	/** Qualified name including namespace prefix (e.g. `"MathUtils.Vector"`) */
	readonly qualifiedName: string;
}

/**
 * Inheritance information read off a class or interface declaration.
 *
 * @public
 */
export interface Inheritance {
	readonly extends?: ReadonlyArray<string>;
	readonly implements?: ReadonlyArray<string>;
}

/**
 * Repository target for {@link sourceLink} — framework-neutral shape a
 * consumer's source config assigns to structurally.
 *
 * @public
 */
export interface SourceLinkTarget {
	/** Repository base URL, e.g. `"https://github.com/org/repo"`. */
	readonly url: string;
	/** Ref path segment appended to the URL. Defaults to `"blob/main"`. */
	readonly ref?: string | undefined;
}

/** Extract the flat top-level item list from either source shape. */
function topLevelItems(source: ApiPackage | ReadonlyArray<ResolvedEntryItem>): readonly ApiItem[] {
	if (Array.isArray(source)) {
		return (source as ReadonlyArray<ResolvedEntryItem>).map((r) => r.item);
	}
	const entryPoint = (source as ApiPackage).entryPoints[0];
	return entryPoint ? entryPoint.members : [];
}

/**
 * Group top-level API items into categories. A category's `tsdocModifier`
 * takes precedence over its `itemKinds`; categories declaring a modifier are
 * checked first. Items no category matches land in `uncategorized`.
 *
 * @public
 */
export function categorize(
	source: ApiPackage | ReadonlyArray<ResolvedEntryItem>,
	categories: Record<string, CategorySpec>,
): CategorizedItems {
	const items: Record<string, ApiItem[]> = {};
	for (const categoryKey of Object.keys(categories)) {
		items[categoryKey] = [];
	}

	// Sort categories: those with tsdocModifier first (higher priority)
	const sortedCategories = Object.entries(categories).sort((a, b) => {
		const [, configA] = a;
		const [, configB] = b;
		if (configA.tsdocModifier && !configB.tsdocModifier) return -1;
		if (!configA.tsdocModifier && configB.tsdocModifier) return 1;
		return 0;
	});

	const uncategorized: ApiItem[] = [];
	for (const member of topLevelItems(source)) {
		let categorized = false;
		for (const [categoryKey, config] of sortedCategories) {
			if (config.tsdocModifier && Tsdoc.hasModifier(member, config.tsdocModifier)) {
				items[categoryKey].push(member);
				categorized = true;
				break;
			}
			if (config.itemKinds?.includes(member.kind)) {
				items[categoryKey].push(member);
				categorized = true;
				break;
			}
		}
		if (!categorized) uncategorized.push(member);
	}

	return { items, uncategorized };
}

/**
 * Extract all members of top-level namespaces as a flat list with qualified
 * names.
 *
 * @public
 */
export function namespaceMembers(source: ApiPackage | ReadonlyArray<ResolvedEntryItem>): NamespaceMember[] {
	const members: NamespaceMember[] = [];
	for (const item of topLevelItems(source)) {
		if (item.kind === ApiItemKind.Namespace) {
			const namespace = item as ApiNamespace;
			for (const member of namespace.members) {
				members.push({
					item: member,
					namespace,
					qualifiedName: `${namespace.displayName}.${member.displayName}`,
				});
			}
		}
	}
	return members;
}

/**
 * Read extends/implements information from a class or interface declaration.
 *
 * @public
 */
export function inheritance(item: ApiClass | ApiInterface): Inheritance {
	const result: { extends?: string[]; implements?: string[] } = {};

	if (item.kind === ApiItemKind.Class) {
		const apiClass = item as ApiClass;
		if (apiClass.extendsType) {
			result.extends = [apiClass.extendsType.excerpt.text];
		}
		const implementsTypes = apiClass.implementsTypes || [];
		if (implementsTypes.length > 0) {
			result.implements = implementsTypes.map((type) => type.excerpt.text);
		}
	} else if (item.kind === ApiItemKind.Interface) {
		const apiInterface = item as ApiInterface;
		const extendsTypes = apiInterface.extendsTypes || [];
		if (extendsTypes.length > 0) {
			result.extends = extendsTypes.map((type) => type.excerpt.text);
		}
	}

	return result;
}

/**
 * Build a source-code URL (with line number when available) for an API item,
 * or `null` when no target or file path is known.
 *
 * @public
 */
export function sourceLink(item: ApiItem, target?: SourceLinkTarget): string | null {
	if (!target) return null;

	// biome-ignore lint/suspicious/noExplicitAny: API Extractor stores fileUrlPath dynamically on the item
	const itemAny = item as any;
	const filePath = itemAny.fileUrlPath || itemAny.filePath;
	if (!filePath) return null;

	const lineNumber = itemAny.fileLineNumber || itemAny.line;
	const ref = target.ref || "blob/main";
	const baseUrl = `${target.url}/${ref}`;
	return lineNumber ? `${baseUrl}/${filePath}#L${lineNumber}` : `${baseUrl}/${filePath}`;
}

/**
 * The slot a class member occupies, for anchor disambiguation.
 *
 * @remarks
 * Getters and setters are `Method` items whose display name carries the
 * `get `/`set ` prefix — that is how API Extractor models them.
 */
function memberSlot(member: ApiItem): Routes.MemberSlot {
	const isStatic = (member as { isStatic?: boolean }).isStatic === true;
	const isAccessor =
		member.kind === "Method" && (member.displayName.startsWith("get ") || member.displayName.startsWith("set "));
	if (isAccessor) return "getter";
	const isMethod = member.kind === "Method" || member.kind === "MethodSignature";
	if (isStatic) return isMethod ? "static-method" : "static-property";
	return isMethod ? "instance-method" : "instance-property";
}

/**
 * Anchor id for every member of a class or interface, keyed by the member's
 * canonical reference.
 *
 * @remarks
 * The ONE place an API item is turned into the {@link Routes.MemberRef} shape
 * anchor computation needs. Both the cross-link route map and the rendered
 * page call this, so a member's `#fragment` and its `id=` cannot disagree —
 * which they did before Task 1.1, when each side derived anchors separately.
 *
 * A canonical reference already distinguishes a static member from an
 * instance member of the same name (`Foo.bar` vs `Foo#bar`), so it is the
 * natural key; a member without one falls back to its display name.
 *
 * @public
 */
export function memberAnchors(item: ApiClass | ApiInterface): ReadonlyMap<string, string> {
	return Routes.memberAnchors(memberRefs(item));
}

/** The {@link Routes.MemberRef} view of a class or interface's members. */
function memberRefs(item: ApiClass | ApiInterface): Routes.MemberRef[] {
	return item.members.map((member) => ({
		id: member.canonicalReference?.toString() ?? member.displayName,
		displayName: member.displayName,
		slot: memberSlot(member),
	}));
}

/**
 * Cross-link keys for a class or interface's members, mapped to the member's
 * canonical reference.
 *
 * @remarks
 * The {@link Routes.memberRouteKeys} vocabulary over real API items — see
 * there for which keys are emitted and why `Class#member` is not one of them.
 *
 * @public
 */
export function memberRouteKeys(item: ApiClass | ApiInterface): ReadonlyMap<string, string> {
	return Routes.memberRouteKeys(item.displayName, memberRefs(item));
}
