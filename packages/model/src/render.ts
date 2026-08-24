/**
 * The single markdown output system. Renders an API Extractor item's body
 * (shared across consumers) and assembles it with an injected frontmatter block
 * and injected crosslink routes. Pure: no I/O, no JSX, no RSPress.
 *
 * @packageDocumentation
 */

import type { ApiDeclaredItem, ApiExportedMixin, ApiItem, ApiPackage } from "@microsoft/api-extractor-model";
import { ApiItemContainerMixin } from "@microsoft/api-extractor-model";

import { CrossLinker } from "./cross-linker.js";
import { TypeSignatureFormatter } from "./formatter.js";
import { getDeprecation, getExamples, getParams, getReturns, getSummary } from "./tsdoc.js";
import type { ApiItemRef, DocMeta, ItemKindSlug, RenderPackageOptions, RenderedDoc } from "./types.js";

const KIND_SLUG: Readonly<Record<string, ItemKindSlug>> = {
	Class: "class",
	Interface: "interface",
	Function: "function",
	TypeAlias: "type",
	Variable: "variable",
	Enum: "enum",
	Namespace: "namespace",
};

/**
 * The default emit rule for {@link renderPackage}: drop compiler-synthetic
 * forgotten exports — items the model retains only because API Extractor ran with
 * `includeForgottenExports: true` (e.g. the `*_base` classes TypeScript hoists for
 * Effect class mixins). Those carry `isExported === false` on `ApiExportedMixin`.
 * Every other item, including any lacking the flag, is kept.
 *
 * @public
 */
export const isEmittable = (item: ApiItem): boolean => (item as Partial<ApiExportedMixin>).isExported !== false;

const formatter = new TypeSignatureFormatter();

const signatureOf = (item: ApiItem): string => {
	const declared = item as ApiDeclaredItem;
	return declared.excerpt?.text ? formatter.format(declared.excerpt).trim() : "";
};

/**
 * Options for {@link renderItem}: the package name used in fallbacks and an
 * optional crosslinker applied to the rendered prose.
 *
 * @public
 */
export interface RenderItemOptions {
	readonly packageName: string;
	/** Optional crosslinker applied to prose (summaries, params, returns, deprecation). */
	readonly crossLinker?: CrossLinker;
}

/**
 * Render one API item to a markdown body (no frontmatter).
 *
 * @public
 */
export function renderItem(item: ApiItem, opts: RenderItemOptions): string {
	const link = (text: string): string => (opts.crossLinker ? opts.crossLinker.addLinks(text) : text);
	const lines: string[] = [`# ${item.displayName}`, ""];

	const deprecation = getDeprecation(item);
	if (deprecation) lines.push(`> **Deprecated:** ${link(deprecation.message)}`, "");

	const summary = getSummary(item);
	if (summary) lines.push(link(summary), "");

	const signature = signatureOf(item);
	if (signature) lines.push("```ts", signature, "```", "");

	const params = getParams(item);
	if (params.length > 0) {
		lines.push("## Parameters", "");
		for (const p of params) {
			const type = p.type ? ` \`${p.type}\`` : "";
			const desc = p.description ? ` — ${link(p.description)}` : "";
			lines.push(`- \`${p.name}\`${type}${desc}`);
		}
		lines.push("");
	}

	const returns = getReturns(item);
	if (returns) lines.push("## Returns", "", link(returns.description), "");

	// Members of a container (class/interface/namespace): name + signature + summary.
	// biome-ignore lint/suspicious/noExplicitAny: ApiItem.members is on container kinds only
	const members = (item as any).members as ApiItem[] | undefined;
	if (Array.isArray(members) && members.length > 0 && ApiItemContainerMixin.isBaseClassOf(item)) {
		lines.push("## Members", "");
		for (const m of members) {
			const sig = signatureOf(m);
			const mSummary = getSummary(m);
			lines.push(`### ${m.displayName}`, "");
			if (sig) lines.push("```ts", sig, "```", "");
			if (mSummary) lines.push(link(mSummary), "");
		}
	}

	const examples = getExamples(item);
	if (examples.length > 0) {
		lines.push("## Examples", "");
		for (const ex of examples) lines.push(`\`\`\`${ex.language}`, ex.code, "```", "");
	}

	return `${lines.join("\n").trim()}\n`;
}

/**
 * Walk a package's first entry point and assemble one RenderedDoc per top-level member.
 *
 * @public
 */
export function renderPackage(apiPackage: ApiPackage, opts: RenderPackageOptions): RenderedDoc[] {
	const entryPoint = apiPackage.entryPoints[0];
	if (!entryPoint) return [];

	// First pass: build the ref registry so cross-links resolve within the package.
	// Filtering here excludes an item from both the emitted docs and the crosslink
	// registry, so no surviving page can link to a dropped one.
	const keep = opts.filter ?? isEmittable;
	const pairs: Array<{ item: ApiItem; ref: ApiItemRef }> = [];
	for (const member of entryPoint.members) {
		const kind = KIND_SLUG[member.kind];
		if (kind === undefined) continue; // skip kinds we don't surface (EntryPoint, etc.)
		if (!keep(member)) continue; // drop forgotten exports (default) or per the injected filter
		pairs.push({ item: member, ref: { name: member.displayName, kind, slug: member.displayName.toLowerCase() } });
	}

	const crossLinker = opts.routeFor
		? new CrossLinker(
				pairs.map((p) => p.ref),
				opts.routeFor,
			)
		: undefined;

	return pairs.map(({ item, ref }) => {
		const body = renderItem(item, { packageName: opts.packageName, ...(crossLinker ? { crossLinker } : {}) });
		const meta: DocMeta = { ...ref, summary: getSummary(item), packageName: opts.packageName };
		const frontmatter = opts.frontmatter ? opts.frontmatter(meta) : "";
		return { ...meta, markdown: frontmatter + body };
	});
}
