/**
 * The VitePress markdown emitter: spends a `@tsdoctor/pages` {@link Page} as
 * plain markdown in VitePress's dialect — `ts twoslash` fences carrying each
 * code block's `source` (Twoslash's native `// ---cut---` hides the
 * prepended imports, so no hide transformer is needed), GFM tables from the
 * typed rows, and `### name {#anchor}` custom heading anchors from the
 * member ids the IR carries.
 *
 * @remarks
 * Every node is `@effected/markdown` mdast serialized by the kit in one tree;
 * nothing here assembles markdown from string fragments, and nothing
 * post-processes the kit's bytes. The `{#anchor}` heading suffix rides as
 * trailing text — mdast has no node for it — and the kit serializes it raw
 * on a tree with no MDX nodes (`@effected/markdown@0.8.0` pins that; 0.7.0
 * escaped the `#`, and a shim for it was deliberately not kept).
 *
 * A code block that is not type-checked — a non-TypeScript example — carries
 * its `display` in a plain fence with its own language.
 *
 * @packageDocumentation
 */

import type { FlowContent, MarkdownStringifyError, PhrasingContent } from "@effected/markdown";
import {
	Blockquote,
	Code,
	Heading,
	InlineCode,
	Link,
	List,
	ListItem,
	Markdown,
	Paragraph,
	Root,
	Strong,
	Table,
	TableCell,
	TableRow,
	Text,
} from "@effected/markdown";
import type { Block, EnumMemberRow, Member, Page, ParameterRow } from "@tsdoctor/pages";
import { Result } from "effect";

/**
 * The fence info string that triggers Twoslash under VitePress's default
 * `explicitTrigger`.
 *
 * @public
 */
export const TWOSLASH_META = "twoslash";

const text = (value: string): Text => Text.make({ value });
const paragraph = (children: ReadonlyArray<PhrasingContent>): Paragraph => Paragraph.make({ children: [...children] });
const heading = (depth: 1 | 2 | 3, value: string): Heading => Heading.make({ depth, children: [text(value)] });
const code = (value: string): InlineCode => InlineCode.make({ value });
const cell = (children: ReadonlyArray<PhrasingContent>): TableCell => TableCell.make({ children: [...children] });
const row = (cells: ReadonlyArray<TableCell>): TableRow => TableRow.make({ children: [...cells] });

/** A type-checked fence: the `source` text under the Twoslash trigger. */
const twoslashFence = (source: string): Code => Code.make({ value: source, lang: "ts", meta: TWOSLASH_META });

const NO_ERRORS = "// @noErrors";

/**
 * A type-checked fence for a DECLARATION — a signature, a member, a base
 * class — with error rendering off.
 *
 * @remarks
 * A declaration excerpt is not a program: its type parameters and the
 * sibling types it names are out of scope, so Twoslash would annotate every
 * line with "Cannot find name". The RSPress plugin never type-checks these
 * blocks at all; here they keep their hovers (every identifier the package's
 * declarations resolve) and drop the diagnostics, which is what `@noErrors`
 * does. The directive is the emitter's spelling, not the IR's — `source`
 * carries it only when the builder put it there (examples).
 */
const declarationFence = (source: string): Code =>
	twoslashFence(source.includes(NO_ERRORS) ? source : `${NO_ERRORS}\n${source}`);

/** A plain fence: the `display` text, no type-checking. */
const plainFence = (display: string, lang: string): Code => Code.make({ value: display, lang });

/**
 * A heading carrying a VitePress custom anchor: `### name {#anchor}`.
 *
 * @remarks
 * mdast has no node for the attribute suffix, so it rides as trailing text;
 * the kit passes `{` through on a tree with no MDX nodes.
 */
const anchoredHeading = (depth: 3, name: string, anchor: string): Heading =>
	Heading.make({ depth, children: [text(`${name} {#${anchor}}`)] });

const parametersTable = (rows: ReadonlyArray<ParameterRow>): Table =>
	Table.make({
		children: [
			row([cell([text("Name")]), cell([text("Type")]), cell([text("Description")])]),
			...rows.map((r) =>
				row([cell([code(r.name)]), cell(r.type === undefined ? [] : [code(r.type)]), cell(r.description)]),
			),
		],
	});

const enumMembersTable = (rows: ReadonlyArray<EnumMemberRow>): Table =>
	Table.make({
		children: [
			row([cell([text("Name")]), cell([text("Value")]), cell([text("Description")])]),
			...rows.map((r) =>
				row([cell([code(r.name)]), cell(r.value === undefined ? [] : [code(r.value)]), cell(r.description)]),
			),
		],
	});

/** The heading text a member role fixes, or the member's own name. */
function memberHeadingName(member: Member): string {
	switch (member.role) {
		case "constructor":
			return "constructor";
		case "call-signature":
			return "Call Signature";
		case "construct-signature":
			return "Construct Signature";
		case "index-signature":
			return "Index Signature";
		default:
			return member.name;
	}
}

const memberNodes = (member: Member): ReadonlyArray<FlowContent> => {
	const nodes: FlowContent[] = [
		anchoredHeading(3, memberHeadingName(member), member.anchor),
		declarationFence(member.code.source),
	];
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
						children: [
							paragraph([
								text("⚠️ "),
								Strong.make({ children: [text("Deprecated:")] }),
								text(" "),
								...block.deprecation,
							]),
						],
					}),
				);
			}
			if (block.releaseTag !== "Public") nodes.push(paragraph([code(block.releaseTag)]));
			return nodes;
		}
		case "available-from": {
			const children: PhrasingContent[] = [text("Available from: ")];
			block.entryPoints.forEach((entryPoint, index) => {
				if (index > 0) children.push(text(", "));
				children.push(code(entryPoint === "default" ? block.packageName : `${block.packageName}/${entryPoint}`));
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
			return [heading(2, "Signature"), declarationFence(block.code.source)];
		case "base-class":
			return [
				heading(2, "Base Class"),
				paragraph([
					code(block.className),
					text(" extends "),
					code(block.baseName),
					text(", a compiler-generated declaration that is not exported from "),
					code(block.packageName),
					text("."),
				]),
				declarationFence(block.code.source),
			];
		case "member-group":
			return [heading(2, block.title), ...block.members.flatMap(memberNodes)];
		case "parameters":
			return [parametersTable(block.rows)];
		case "enum-members":
			return [enumMembersTable(block.rows)];
		case "examples":
			return [
				heading(2, "Examples"),
				...block.items.map((item) =>
					item.typeChecked ? twoslashFence(item.code.source) : plainFence(item.code.display, item.language),
				),
			];
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
 * {@link emitMarkdownBody}.
 *
 * @public
 */
export function markdownTree(page: Page): ReadonlyArray<FlowContent> {
	return page.blocks.flatMap(markdownBlockTree);
}

/**
 * Emit a page's markdown body. No frontmatter — the adapter assembles that
 * from the page facts (see `emit/frontmatter.ts`).
 *
 * @remarks
 * A stringify failure is surfaced rather than thrown: the prose inside a
 * block arrived from a builder and may carry any node the kit admits, and the
 * kit's own error names what it could not serialize.
 *
 * @public
 */
export function emitMarkdownBody(page: Page): Result.Result<string, MarkdownStringifyError> {
	const root = Root.make({ children: [...markdownTree(page)] });
	return Result.map(Markdown.stringifyResult(root), (markdown) => {
		const trimmed = markdown.trim();
		return trimmed ? `${trimmed}\n` : "\n";
	});
}
