/**
 * The neutral plain-markdown emitter over the IR — the dependency-free
 * serializer for a consumer with no framework at all, and the successor to
 * `@tsdoctor/model`'s body-only `Render.tree`.
 *
 * @remarks
 * No JSX, no framework fences: signatures and examples are plain fenced
 * code carrying each block's `display` text, tables are GFM tables built from
 * the typed rows, and member anchors are not spelled at all — a framework
 * emitter (RSPress `id=` props, VitePress `{#id}` suffixes) owns that. Prose
 * is emitted as the already-linked mdast the block carries, so links render
 * identically to every other emitter.
 *
 * @packageDocumentation
 */

import type { FlowContent, MarkdownStringifyError, PhrasingContent } from "@effected/markdown";
import {
	Blockquote,
	Code,
	Heading,
	InlineCode,
	Markdown as Kit,
	Link,
	List,
	ListItem,
	Paragraph,
	Root,
	Strong,
	Table,
	TableCell,
	TableRow,
	Text,
} from "@effected/markdown";
import { Effect, Result } from "effect";

import type { Block, EnumMemberRow, Member, ParameterRow } from "./Blocks.js";
import type { Page } from "./Page.js";

const text = (value: string): Text => Text.make({ value });
const heading = (depth: 1 | 2 | 3, value: string): Heading => Heading.make({ depth, children: [text(value)] });
const paragraph = (children: ReadonlyArray<PhrasingContent>): Paragraph => Paragraph.make({ children: [...children] });
const fence = (value: string, lang: string): Code => Code.make({ value, lang });
const cell = (children: ReadonlyArray<PhrasingContent>): TableCell => TableCell.make({ children: [...children] });
const row = (cells: ReadonlyArray<TableCell>): TableRow => TableRow.make({ children: [...cells] });

const parametersTable = (rows: ReadonlyArray<ParameterRow>): Table =>
	Table.make({
		children: [
			row([cell([text("Name")]), cell([text("Type")]), cell([text("Description")])]),
			...rows.map((r) =>
				row([
					cell([InlineCode.make({ value: r.name })]),
					cell(r.type === undefined ? [] : [InlineCode.make({ value: r.type })]),
					cell(r.description),
				]),
			),
		],
	});

const enumMembersTable = (rows: ReadonlyArray<EnumMemberRow>): Table =>
	Table.make({
		children: [
			row([cell([text("Name")]), cell([text("Value")]), cell([text("Description")])]),
			...rows.map((r) =>
				row([
					cell([InlineCode.make({ value: r.name })]),
					cell(r.value === undefined ? [] : [InlineCode.make({ value: r.value })]),
					cell(r.description),
				]),
			),
		],
	});

const memberNodes = (member: Member): ReadonlyArray<FlowContent> => {
	const nodes: FlowContent[] = [heading(3, member.name), fence(member.code.display, "ts")];
	if (member.summary && member.summary.length > 0) nodes.push(paragraph(member.summary));
	if (member.parameters && member.parameters.length > 0) nodes.push(parametersTable(member.parameters));
	if (member.returns && member.returns.length > 0) {
		nodes.push(paragraph([Strong.make({ children: [text("Returns:")] }), text(" "), ...member.returns]));
	}
	return nodes;
};

/**
 * Render one block to flow nodes.
 *
 * @public
 */
export function markdownBlockTree(block: Block): ReadonlyArray<FlowContent> {
	switch (block.kind) {
		case "title": {
			const nodes: FlowContent[] = [heading(1, block.name)];
			if (block.deprecation && block.deprecation.length > 0) {
				nodes.push(
					Blockquote.make({
						children: [paragraph([Strong.make({ children: [text("Deprecated:")] }), text(" "), ...block.deprecation])],
					}),
				);
			}
			if (block.releaseTag !== "Public") nodes.push(paragraph([InlineCode.make({ value: block.releaseTag })]));
			return nodes;
		}
		case "available-from": {
			const children: PhrasingContent[] = [text("Available from: ")];
			block.entryPoints.forEach((entryPoint, index) => {
				if (index > 0) children.push(text(", "));
				const spec = entryPoint === "default" ? block.packageName : `${block.packageName}/${entryPoint}`;
				children.push(InlineCode.make({ value: spec }));
			});
			return [paragraph(children)];
		}
		case "prose":
			return block.role === "summary"
				? block.content
				: [heading(2, block.role === "remarks" ? "Remarks" : "Returns"), ...block.content];
		case "source-link":
			return [paragraph([Link.make({ url: block.href, children: [text("Source")] })])];
		case "signature":
			return [fence(block.code.display, "ts")];
		case "base-class":
			return [
				heading(2, "Base Class"),
				paragraph([
					InlineCode.make({ value: block.className }),
					text(" extends "),
					InlineCode.make({ value: block.baseName }),
					text(", a compiler-generated declaration that is not exported from "),
					InlineCode.make({ value: block.packageName }),
					text("."),
				]),
				fence(block.code.display, "ts"),
			];
		case "member-group":
			return [heading(2, block.title), ...block.members.flatMap(memberNodes)];
		case "parameters":
			return [parametersTable(block.rows)];
		case "enum-members":
			return [enumMembersTable(block.rows)];
		case "examples":
			return [heading(2, "Examples"), ...block.items.map((item) => fence(item.code.display, item.language))];
		case "see-also":
			return [
				heading(2, "See Also"),
				List.make({
					ordered: false,
					spread: false,
					children: block.references.map((reference) =>
						ListItem.make({ spread: false, children: [paragraph(reference)] }),
					),
				}),
			];
		case "member-index":
			return [
				heading(2, block.title),
				List.make({
					ordered: false,
					spread: false,
					children: block.entries.map((entry) => {
						const children: PhrasingContent[] = [Link.make({ url: entry.route, children: [text(entry.name)] })];
						if (entry.summary && entry.summary.length > 0) children.push(text(" - "), ...entry.summary);
						return ListItem.make({ spread: false, children: [paragraph(children)] });
					}),
				}),
			];
	}
}

/**
 * Render a page's body to flow nodes — the pre-serialization form of
 * {@link renderMarkdownResult}.
 *
 * @public
 */
export function markdownTree(page: Page): ReadonlyArray<FlowContent> {
	return page.blocks.flatMap(markdownBlockTree);
}

/**
 * Render a page's body to a markdown string. No frontmatter: that is the
 * adapter's, built from the page facts.
 *
 * @remarks
 * A stringify failure on a tree this module built itself is surfaced rather
 * than thrown, because the prose inside a block arrived from a builder and
 * may carry any node the kit admits; the kit's own error names what it could
 * not serialize.
 *
 * @public
 */
export function renderMarkdownResult(page: Page): Result.Result<string, MarkdownStringifyError> {
	const root = Root.make({ children: [...markdownTree(page)] });
	return Result.map(Kit.stringifyResult(root), (markdown) => {
		const trimmed = markdown.trim();
		return trimmed ? `${trimmed}\n` : "\n";
	});
}

/**
 * The Effect form of {@link renderMarkdownResult}.
 *
 * @public
 */
export const renderMarkdown: (page: Page) => Effect.Effect<string, MarkdownStringifyError> = Effect.fn(
	"Markdown.renderMarkdown",
)((page: Page) => Effect.fromResult(renderMarkdownResult(page)));
