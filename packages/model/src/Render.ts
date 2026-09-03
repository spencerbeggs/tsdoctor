/**
 * The single markdown output system. Renders an API Extractor item's body
 * (shared across consumers) and assembles it with an injected frontmatter
 * block and injected crosslink routes. Pure: no I/O, no JSX, no framework.
 *
 * @remarks
 * Bodies are built as `@effected/markdown` node trees and serialized with the
 * canonical serializer; {@link tree} exposes the pre-serialization nodes as
 * the seam a future framework-neutral page IR builds on.
 *
 * @deprecated This module is superseded by `@tsdoctor/pages`, the
 * framework-neutral page IR that carries everything the product page needs
 * (signatures, members with anchors, tables, examples, navigation, head
 * tags). Use `buildPage` to lift an `ApiItem` into a `Page`, then
 * `renderMarkdown` (string) or `markdownTree` (mdast nodes) from
 * `@tsdoctor/pages`. Every export here is kept for one more minor and will be
 * deleted after that.
 *
 * @packageDocumentation
 */

import type { FlowContent, PhrasingContent } from "@effected/markdown";
import {
	Blockquote,
	Code,
	Heading,
	InlineCode,
	List,
	ListItem,
	Markdown,
	Paragraph,
	Root,
	Strong,
	Text,
} from "@effected/markdown";
import type { ApiDeclaredItem, ApiExportedMixin, ApiItem, ApiPackage } from "@microsoft/api-extractor-model";
import { ApiItemContainerMixin } from "@microsoft/api-extractor-model";
import { Result } from "effect";

import { CrossLinker } from "./CrossLinker.js";
import { phrasingFromMarkdown } from "./internal/prose.js";
import * as Signature from "./Signature.js";
import * as Tsdoc from "./Tsdoc.js";
// biome-ignore lint/suspicious/noDeprecatedImports: this module is deprecated alongside these types and is their only consumer
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
 * The default emit rule for {@link docs}: drop compiler-synthetic forgotten
 * exports — items the model retains only because API Extractor ran with
 * `includeForgottenExports: true` (e.g. the `*_base` classes TypeScript hoists
 * for Effect class mixins). Those carry `isExported === false` on
 * `ApiExportedMixin`. Every other item, including any lacking the flag, is
 * kept.
 *
 * @deprecated Use `prepareWorkItems` from `@tsdoctor/pages`, which decides
 * which items receive a page (`isPageKind` for the kind, `SyntheticBases.detect`
 * for the hoisted `*_base` declarations this rule was written to drop).
 * @public
 */
export const isEmittable = (item: ApiItem): boolean => (item as Partial<ApiExportedMixin>).isExported !== false;

const signatureOf = (item: ApiItem): string => {
	const declared = item as ApiDeclaredItem;
	return declared.excerpt?.text ? Signature.format(declared.excerpt).trim() : "";
};

/**
 * Options for {@link item} and {@link tree}: the package name used in
 * fallbacks and an optional crosslinker applied to the rendered prose.
 *
 * @deprecated Use `BuildPageInput` from `@tsdoctor/pages`, which carries the
 * per-API `CrossLinker` as `linker`.
 * @public
 */
export interface RenderItemOptions {
	readonly packageName: string;
	/** Optional crosslinker applied to prose (summaries, params, returns, deprecation). */
	readonly crossLinker?: CrossLinker;
}

/**
 * Render one API item's markdown body as flow nodes — the pre-serialization
 * form of {@link item}.
 *
 * @deprecated Use `buildPage` + `markdownTree` from `@tsdoctor/pages`, which
 * yields the same `FlowContent` nodes from a typed `Page`.
 * @alpha
 */
export function tree(apiItem: ApiItem, opts: RenderItemOptions): ReadonlyArray<FlowContent> {
	const link = (text: string): string => (opts.crossLinker ? opts.crossLinker.link(text) : text);
	const prose = (text: string): ReadonlyArray<PhrasingContent> => phrasingFromMarkdown(link(text));
	const nodes: FlowContent[] = [new Heading({ depth: 1, children: [new Text({ value: apiItem.displayName })] })];

	const deprecation = Tsdoc.deprecation(apiItem);
	if (deprecation) {
		nodes.push(
			new Blockquote({
				children: [
					new Paragraph({
						children: [
							new Strong({ children: [new Text({ value: "Deprecated:" })] }),
							new Text({ value: " " }),
							...prose(deprecation.message),
						],
					}),
				],
			}),
		);
	}

	const summary = Tsdoc.summary(apiItem);
	if (summary) nodes.push(new Paragraph({ children: [...prose(summary)] }));

	const signature = signatureOf(apiItem);
	if (signature) nodes.push(new Code({ value: signature, lang: "ts" }));

	const params = Tsdoc.params(apiItem);
	if (params.length > 0) {
		nodes.push(new Heading({ depth: 2, children: [new Text({ value: "Parameters" })] }));
		nodes.push(
			new List({
				ordered: false,
				spread: false,
				children: params.map((p) => {
					const children: PhrasingContent[] = [new InlineCode({ value: p.name })];
					if (p.type) children.push(new Text({ value: " " }), new InlineCode({ value: p.type }));
					if (p.description) children.push(new Text({ value: " — " }), ...prose(p.description));
					return new ListItem({ spread: false, children: [new Paragraph({ children })] });
				}),
			}),
		);
	}

	const returns = Tsdoc.returns(apiItem);
	if (returns) {
		nodes.push(new Heading({ depth: 2, children: [new Text({ value: "Returns" })] }));
		nodes.push(new Paragraph({ children: [...prose(returns.description)] }));
	}

	// Members of a container (class/interface/namespace): name + signature + summary.
	// biome-ignore lint/suspicious/noExplicitAny: ApiItem.members is on container kinds only
	const members = (apiItem as any).members as ApiItem[] | undefined;
	if (Array.isArray(members) && members.length > 0 && ApiItemContainerMixin.isBaseClassOf(apiItem)) {
		nodes.push(new Heading({ depth: 2, children: [new Text({ value: "Members" })] }));
		for (const m of members) {
			nodes.push(new Heading({ depth: 3, children: [new Text({ value: m.displayName })] }));
			const sig = signatureOf(m);
			if (sig) nodes.push(new Code({ value: sig, lang: "ts" }));
			const mSummary = Tsdoc.summary(m);
			if (mSummary) nodes.push(new Paragraph({ children: [...prose(mSummary)] }));
		}
	}

	const examples = Tsdoc.examples(apiItem);
	if (examples.length > 0) {
		nodes.push(new Heading({ depth: 2, children: [new Text({ value: "Examples" })] }));
		for (const ex of examples) nodes.push(new Code({ value: ex.code.replace(/\n$/, ""), lang: ex.language }));
	}

	return nodes;
}

/**
 * Render one API item to a markdown body string (no frontmatter).
 *
 * @deprecated Use `buildPage` + `renderMarkdown` from `@tsdoctor/pages`.
 * @public
 */
export function item(apiItem: ApiItem, opts: RenderItemOptions): string {
	const root = new Root({ children: [...tree(apiItem, opts)] });
	// A stringify failure on a tree this module built itself is a bug, not a
	// recoverable condition — surface it as a defect.
	const markdown = Result.getOrThrow(Markdown.stringifyResult(root));
	const trimmed = markdown.trim();
	return trimmed ? `${trimmed}\n` : "\n";
}

/**
 * Walk a package's first entry point and assemble one RenderedDoc per
 * top-level member.
 *
 * @deprecated Use `prepareWorkItems` + `buildPage` + `renderMarkdown` from
 * `@tsdoctor/pages`; frontmatter is assembled by the adapter from the
 * `Page`'s facts and head tags.
 * @public
 */
export function docs(apiPackage: ApiPackage, opts: RenderPackageOptions): RenderedDoc[] {
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
		? CrossLinker.fromRefs(
				pairs.map((p) => p.ref),
				opts.routeFor,
			)
		: undefined;

	return pairs.map(({ item: member, ref }) => {
		const body = item(member, { packageName: opts.packageName, ...(crossLinker ? { crossLinker } : {}) });
		const meta: DocMeta = { ...ref, summary: Tsdoc.summary(member), packageName: opts.packageName };
		const frontmatter = opts.frontmatter ? opts.frontmatter(meta) : "";
		return { ...meta, markdown: frontmatter + body };
	});
}
