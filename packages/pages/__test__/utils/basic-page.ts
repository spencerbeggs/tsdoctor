/**
 * A minimal IR builder for tests: lifts exactly the facts `Render.tree` in
 * `@tsdoctor/model` reads from an item (title, deprecation, summary, raw
 * signature, parameters, returns, container members, examples) into a Page,
 * so the markdown emitter can be characterized against that renderer. The
 * production builder (Build.ts, one per item kind) supersedes this in phase 2.
 */

import type { PhrasingContent } from "@effected/markdown";
import { Markdown, Paragraph, Text } from "@effected/markdown";
import type { ApiDeclaredItem, ApiItem } from "@microsoft/api-extractor-model";
import { ApiItemContainerMixin } from "@microsoft/api-extractor-model";
import { Routes, Signature, Tsdoc } from "@tsdoctor/model";
import { Result } from "effect";

import type { Block } from "../../src/Blocks.js";
import {
	CodeText,
	Example,
	ExampleGroup,
	Member,
	MemberGroup,
	ParameterRow,
	ParameterTable,
	ProseBlock,
	Signature as SignatureBlock,
	Title,
} from "../../src/Blocks.js";
import { NavEntry } from "../../src/Nav.js";
import type { PageKind } from "../../src/Page.js";
import { Page } from "../../src/Page.js";

const phrasing = (prose: string): ReadonlyArray<PhrasingContent> => {
	const parsed = Markdown.parsePhrasingResult(prose);
	return Result.isSuccess(parsed) && parsed.success.length > 0 ? parsed.success : [Text.make({ value: prose })];
};

const signatureOf = (item: ApiItem): string => {
	const declared = item as ApiDeclaredItem;
	return declared.excerpt?.text ? Signature.format(declared.excerpt).trim() : "";
};

const plain = (code: string): CodeText => CodeText.make({ display: code, source: code });

const pageKind = (item: ApiItem): PageKind => {
	switch (item.kind) {
		case "Class":
			return "class";
		case "Interface":
			return "interface";
		case "Function":
			return "function";
		case "TypeAlias":
			return "type-alias";
		case "Enum":
			return "enum";
		case "Namespace":
			return "namespace";
		default:
			return "variable";
	}
};

/** Build a Page carrying the same facts Render.tree reads. */
export function basicPage(item: ApiItem): Page {
	const blocks: Block[] = [];
	const deprecation = Tsdoc.deprecation(item);
	blocks.push(
		Title.make({
			name: item.displayName,
			releaseTag: Tsdoc.releaseTag(item),
			...(deprecation ? { deprecation: phrasing(deprecation.message) } : {}),
		}),
	);

	const summary = Tsdoc.summary(item);
	if (summary)
		blocks.push(ProseBlock.make({ role: "summary", content: [Paragraph.make({ children: [...phrasing(summary)] })] }));

	const signature = signatureOf(item);
	if (signature) blocks.push(SignatureBlock.make({ code: plain(signature) }));

	const params = Tsdoc.params(item);
	if (params.length > 0) {
		blocks.push(
			ParameterTable.make({
				rows: params.map((p) =>
					ParameterRow.make({ name: p.name, type: p.type ?? "", description: phrasing(p.description) }),
				),
			}),
		);
	}

	const returns = Tsdoc.returns(item);
	if (returns)
		blocks.push(
			ProseBlock.make({ role: "returns", content: [Paragraph.make({ children: [...phrasing(returns.description)] })] }),
		);

	if (ApiItemContainerMixin.isBaseClassOf(item) && item.members.length > 0) {
		blocks.push(
			MemberGroup.make({
				title: "Members",
				members: item.members.map((m) => {
					const mSummary = Tsdoc.summary(m);
					return Member.make({
						role: "property",
						name: m.displayName,
						anchor: Routes.memberAnchor(m.displayName),
						code: plain(signatureOf(m)),
						...(mSummary ? { summary: phrasing(mSummary) } : {}),
					});
				}),
			}),
		);
	}

	const examples = Tsdoc.examples(item);
	if (examples.length > 0) {
		blocks.push(
			ExampleGroup.make({
				items: examples.map((ex) =>
					Example.make({ language: ex.language, code: plain(ex.code.replace(/\n$/, "")), typeChecked: false }),
				),
			}),
		);
	}

	const slug = item.displayName.toLowerCase();
	return Page.make({
		kind: pageKind(item),
		entityName: item.displayName,
		singularName: item.kind,
		description: summary || "No description available.",
		route: `/api/${item.kind.toLowerCase()}/${slug}`,
		headTags: [],
		blocks,
		nav: NavEntry.make({
			categoryKey: item.kind.toLowerCase(),
			label: item.displayName,
			name: slug,
			route: `/api/${slug}`,
		}),
	});
}
