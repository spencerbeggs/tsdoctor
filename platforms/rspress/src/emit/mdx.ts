/**
 * The RSPress MDX emitter: spends a `@tsdoctor/pages` {@link Page} as the
 * MDX body the page generators used to concatenate by hand — component
 * import lines, the `ApiSignature` / `ApiMember` / `ApiExample` elements
 * with their `code` / `source` props, `ParametersTable` /
 * `EnumMembersTable` as JSON props, and the prose between them.
 *
 * @remarks
 * Every node is built as `@effected/markdown` mdast (the MDX vocabulary for
 * JSX) and serialized by the kit; nothing here assembles MDX from string
 * fragments, and nothing post-processes the kit's bytes. What this module
 * DOES own is the joining of blocks: each top-level node is serialized as
 * its own document and the emitter places the blank line — or, after an
 * enum signature, the single newline — between them, exactly as the
 * generators did. This per-node serialization is kept deliberately, even
 * on `@effected/markdown@0.8.0`: the round-1 handoff declined a separator
 * option (block separation is always exactly one blank line), so the
 * enum-signature single-newline join still needs the emitter to own the
 * joins; and serializing the whole page as one tree would let the kit's
 * presence-keyed MDX escaping rewrite `{` in prose that the generators
 * emitted raw. The kit's documented raw hatch for that (an inline `Html`
 * node emits verbatim) is a future refactor, not adopted here.
 *
 * `escapeMdxGenerics` is applied where — and only where — the generators
 * applied it: the deprecation notice, member summaries and returns, the
 * function-level parameter descriptions, the function's returns section,
 * see-also references and namespace member-index summaries. Member-level
 * parameter descriptions and enum member descriptions were emitted
 * unescaped, and still are; normalizing that is a product change, not a
 * lift.
 *
 * There is no byte-parity shim any more. `@effected/markdown@0.7.0` escaped
 * an intraword `_` and a non-entity `&` (`# DEFAULT\_PIPELINE\_OPTIONS`,
 * `## Getters \& Setters`), and a labelled `unescapeLiteral` reversed that
 * in headings and member-index link text; 0.8.0 escapes both minimally
 * (`_` only where it could bind emphasis, `&` only before an entity-shaped
 * run) and pins `parse ∘ stringify` identity for them, so the shim is gone.
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
	MdxJsxAttribute,
	MdxJsxAttributeValueExpression,
	MdxJsxFlowElement,
	MdxjsEsm,
	Paragraph,
	Root,
	Strong,
	Text,
} from "@effected/markdown";
import type { Block, EnumMemberRow, Member, Page, PageKind, ParameterRow } from "@tsdoctor/pages";
import { Result } from "effect";

/**
 * What the emitter needs beyond the page: the API scope every code element
 * carries, and whether the LLMs toolbar slot is rendered beside a source
 * link.
 */
export interface EmitMdxOptions {
	/** The API scope, spent as the `apiScope` prop on every code element. */
	readonly apiScope: string;
	/** Whether the plugin's LLMs integration is enabled for this API. */
	readonly llmsEnabled?: boolean | undefined;
}

/**
 * Escape generic type parameters in MDX prose by wrapping them in backticks,
 * so `<T>` / `<K, V>` are not read as JSX tags. Code spans are left alone.
 *
 * @example
 * ```ts
 * escapeMdxGenerics("Returns Promise<T>");        // "Returns Promise`<T>`"
 * escapeMdxGenerics("Map<K, V> extends...");      // "Map`<K, V>` extends..."
 * escapeMdxGenerics("`Pipeline<I, O>`");           // "`Pipeline<I, O>`" (unchanged)
 * ```
 */
export function escapeMdxGenerics(text: string): string {
	const parts = text.split(/(`[^`]+`)/g);
	return parts
		.map((part) => {
			if (part.startsWith("`") && part.endsWith("`")) {
				return part;
			}
			return part.replace(GENERICS, "`<$1>`");
		})
		.join("");
}

// ── Serialization ──────────────────────────────────────────────────────────

/** One serialized top-level node and the separator that follows it. */
interface Chunk {
	readonly text: string;
	readonly trailing: "\n\n" | "\n";
}

type Emit = Result.Result<string, MarkdownStringifyError>;

/** Serialize one flow node as its own document, without the trailing newline. */
function serialize(node: FlowContent | MdxjsEsm): Emit {
	return Result.map(Markdown.stringifyResult(Root.make({ children: [node] })), (text) => text.replace(/\n$/, ""));
}

/** Serialize phrasing content to the one-line string a JSX prop or a table cell carries. */
function inlineText(children: ReadonlyArray<PhrasingContent>): Emit {
	if (children.length === 0) return Result.succeed("");
	return serialize(Paragraph.make({ children: [...children] }));
}

const GENERICS = /<([A-Z][A-Za-z0-9_]*(?:\s+extends\s+[^>]+)?(?:,\s*[A-Z][A-Za-z0-9_]*(?:\s+extends\s+[^>]+)?)*)>/g;

/**
 * {@link escapeMdxGenerics} as an mdast transform: a generic parameter list
 * in a text run becomes an inline code node, and a raw-HTML node that IS a
 * generic (`<T>` parses as an HTML tag) becomes one too. Code spans are
 * already inline code and are left alone; container nodes are walked.
 *
 * @remarks
 * Done on the tree rather than on the serialized string because the kit
 * escapes a bare `<` in text (`Map\<K, V\>`) as it serializes, and the
 * string-level regex would no longer see the generic. The two spellings are
 * the same MDX; the tree form is what lets the kit own every byte.
 */
function escapeGenericsInPhrasing(children: ReadonlyArray<PhrasingContent>): ReadonlyArray<PhrasingContent> {
	const out: PhrasingContent[] = [];
	for (const node of children) {
		if (node.type === "text") {
			let last = 0;
			for (const match of node.value.matchAll(GENERICS)) {
				const index = match.index ?? 0;
				if (index > last) out.push(Text.make({ value: node.value.slice(last, index) }));
				out.push(InlineCode.make({ value: match[0] }));
				last = index + match[0].length;
			}
			if (last === 0) out.push(node);
			else if (last < node.value.length) out.push(Text.make({ value: node.value.slice(last) }));
		} else if (node.type === "html" && new RegExp(`^${GENERICS.source}$`).test(node.value)) {
			out.push(InlineCode.make({ value: node.value }));
		} else if (node.type === "link" || node.type === "strong" || node.type === "emphasis" || node.type === "delete") {
			out.push({ ...node, children: [...escapeGenericsInPhrasing(node.children)] } as PhrasingContent);
		} else {
			out.push(node);
		}
	}
	return out;
}

/** Phrasing content with generics escaped — the tree form of {@link escapeMdxGenerics}. */
function escapedPhrasing(
	children: ReadonlyArray<PhrasingContent>,
): Result.Result<ReadonlyArray<PhrasingContent>, MarkdownStringifyError> {
	return Result.succeed(escapeGenericsInPhrasing(children));
}

const text = (value: string): Text => Text.make({ value });
const paragraph = (children: ReadonlyArray<PhrasingContent>): Paragraph => Paragraph.make({ children: [...children] });
const heading = (depth: 1 | 2, value: string): Heading => Heading.make({ depth, children: [text(value)] });
const code = (value: string): InlineCode => InlineCode.make({ value });

const expression = (name: string, value: unknown): MdxJsxAttribute =>
	MdxJsxAttribute.make({ name, value: MdxJsxAttributeValueExpression.make({ value: JSON.stringify(value) }) });
const literal = (name: string, value: string): MdxJsxAttribute => MdxJsxAttribute.make({ name, value });
const element = (
	name: string,
	attributes: ReadonlyArray<MdxJsxAttribute>,
	children: ReadonlyArray<FlowContent> = [],
): MdxJsxFlowElement => MdxJsxFlowElement.make({ name, attributes: [...attributes], children: [...children] });

// ── Chunks ─────────────────────────────────────────────────────────────────

class Body {
	private readonly chunks: Chunk[] = [];
	private failure: MarkdownStringifyError | undefined;

	push(node: FlowContent | MdxjsEsm, trailing: Chunk["trailing"] = "\n\n"): void {
		if (this.failure) return;
		const result = serialize(node);
		if (Result.isFailure(result)) {
			this.failure = result.failure;
			return;
		}
		this.chunks.push({ text: result.success, trailing });
	}

	/** Push a heading. */
	heading(depth: 1 | 2, value: string): void {
		this.push(heading(depth, value));
	}

	pushResult<A>(result: Result.Result<A, MarkdownStringifyError>, use: (value: A) => void): void {
		if (this.failure) return;
		if (Result.isFailure(result)) {
			this.failure = result.failure;
			return;
		}
		use(result.success);
	}

	render(): Emit {
		if (this.failure) return Result.fail(this.failure);
		return Result.succeed(this.chunks.map((chunk) => chunk.text + chunk.trailing).join(""));
	}
}

// ── Import lines ───────────────────────────────────────────────────────────

const RUNTIME = "rspress-plugin-api-extractor/runtime";

/** The component import lines each page kind carried. */
function importLines(kind: PageKind): string {
	const lines = [`import { SourceCode } from "@rspress/core/theme";`];
	if (kind === "enum") {
		lines.push(`import { EnumMembersTable } from "${RUNTIME}";`);
	} else if (kind !== "namespace") {
		lines.push(`import { ParametersTable } from "${RUNTIME}";`);
	}
	const components =
		kind === "class" || kind === "interface" ? "ApiSignature, ApiMember, ApiExample" : "ApiSignature, ApiExample";
	lines.push(`import { ${components} } from "${RUNTIME}";`);
	return lines.join("\n");
}

// ── Blocks ─────────────────────────────────────────────────────────────────

function parameterRows(
	rows: ReadonlyArray<ParameterRow>,
	escapeGenerics: boolean,
): Result.Result<ReadonlyArray<Record<string, string>>, MarkdownStringifyError> {
	return Result.all(
		rows.map((row) =>
			Result.map(
				inlineText(escapeGenerics ? escapeGenericsInPhrasing(row.description) : row.description),
				(description) => ({
					name: row.name,
					...(row.type !== undefined ? { type: row.type } : {}),
					description,
				}),
			),
		),
	);
}

function enumRows(
	rows: ReadonlyArray<EnumMemberRow>,
): Result.Result<ReadonlyArray<Record<string, string>>, MarkdownStringifyError> {
	return Result.all(
		rows.map((row) =>
			Result.map(inlineText(row.description), (description) => ({
				name: row.name,
				...(row.value !== undefined ? { value: row.value } : {}),
				description,
			})),
		),
	);
}

/** The literal `memberName` a role fixes, or none when the member's own name is spent as an expression. */
function fixedMemberName(member: Member): string | undefined {
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
			return undefined;
	}
}

/** Whether the role carried a `hasParameters` prop — constructors and methods, never properties or signatures. */
function carriesHasParameters(member: Member): boolean {
	return member.role === "constructor" || member.role === "method" || member.role === "getter";
}

function emitMember(body: Body, member: Member, apiScope: string): void {
	body.pushResult(member.summary ? escapedPhrasing(member.summary) : Result.succeed(undefined), (summaryNodes) => {
		body.pushResult(summaryNodes ? inlineText(summaryNodes) : Result.succeed(""), (summary) => {
			const fixedName = fixedMemberName(member);
			const attributes: MdxJsxAttribute[] = [
				expression("code", member.code.display),
				expression("source", member.code.source),
				expression("apiScope", apiScope),
				fixedName !== undefined ? literal("memberName", fixedName) : expression("memberName", member.name),
			];
			if (summary) attributes.push(expression("summary", summary));
			attributes.push(expression("id", member.anchor));
			if (carriesHasParameters(member)) attributes.push(expression("hasParameters", member.parameters !== undefined));
			body.push(element("ApiMember", attributes));
		});
	});
	if (member.parameters !== undefined) {
		body.pushResult(parameterRows(member.parameters, false), (rows) => {
			body.push(element("ParametersTable", [expression("parameters", rows)]));
		});
	}
	if (member.returns !== undefined) {
		body.pushResult(escapedPhrasing(member.returns), (returns) => {
			body.push(paragraph([Strong.make({ children: [text("Returns:")] }), text(" "), ...returns]));
		});
	}
}

function emitBlock(body: Body, block: Block, page: Page, options: EmitMdxOptions): void {
	const { apiScope } = options;
	switch (block.kind) {
		case "title": {
			body.heading(1, block.name);
			if (block.deprecation !== undefined) {
				body.pushResult(escapedPhrasing(block.deprecation), (message) => {
					body.push(
						Blockquote.make({
							children: [
								paragraph([text("⚠️ "), Strong.make({ children: [text("Deprecated:")] }), text(" "), ...message]),
							],
						}),
					);
				});
			}
			if (block.releaseTag !== "Public") body.push(paragraph([code(block.releaseTag)]));
			return;
		}
		case "prose": {
			if (block.role === "summary") {
				for (const node of block.content) body.push(node);
				return;
			}
			body.heading(2, block.role === "remarks" ? "Remarks" : "Returns");
			for (const node of block.content) {
				if (block.role === "returns" && node.type === "paragraph") {
					body.pushResult(escapedPhrasing(node.children), (children) => body.push(paragraph(children)));
				} else {
					body.push(node);
				}
			}
			return;
		}
		case "available-from": {
			const children: PhrasingContent[] = [text("Available from: ")];
			block.entryPoints.forEach((entryPoint, index) => {
				if (index > 0) children.push(text(", "));
				children.push(code(entryPoint === "default" ? block.packageName : `${block.packageName}/${entryPoint}`));
			});
			body.push(paragraph(children));
			return;
		}
		case "source-link": {
			const children: FlowContent[] = [
				element(
					"div",
					[literal("className", "api-docs-toolbar-left")],
					[element("SourceCode", [literal("href", block.href)])],
				),
			];
			if (options.llmsEnabled) children.push(element("div", [literal("className", "api-docs-toolbar-right")]));
			body.push(element("div", [literal("className", "api-docs-toolbar")], children));
			return;
		}
		case "signature": {
			const attributes = [
				expression("code", block.code.display),
				expression("source", block.code.source),
				expression("apiScope", apiScope),
			];
			if (block.hasParameters !== undefined) attributes.push(expression("hasParameters", block.hasParameters));
			if (block.hasMembers !== undefined) attributes.push(expression("hasMembers", block.hasMembers));
			// An enum's members table sits directly under its signature: one newline, no paragraph break.
			body.push(element("ApiSignature", attributes), block.hasMembers === true ? "\n" : "\n\n");
			return;
		}
		case "base-class": {
			body.heading(2, "Base Class");
			body.push(
				paragraph([
					code(block.className),
					text(" extends "),
					code(block.baseName),
					text(", a compiler-generated declaration that is not exported from "),
					code(block.packageName),
					text("."),
				]),
			);
			body.push(
				element("ApiSignature", [
					expression("code", block.code.display),
					expression("source", block.code.source),
					expression("apiScope", apiScope),
				]),
			);
			return;
		}
		case "member-group": {
			body.heading(2, block.title);
			for (const member of block.members) emitMember(body, member, apiScope);
			return;
		}
		case "parameters": {
			body.pushResult(parameterRows(block.rows, true), (rows) => {
				body.push(element("ParametersTable", [expression("parameters", rows)]));
			});
			return;
		}
		case "enum-members": {
			body.pushResult(enumRows(block.rows), (rows) => {
				body.push(element("EnumMembersTable", [expression("members", rows)]));
			});
			return;
		}
		case "examples": {
			body.heading(2, "Examples");
			for (const example of block.items) {
				if (example.typeChecked) {
					body.push(
						element("ApiExample", [
							expression("code", example.code.display),
							expression("source", example.code.source),
							expression("apiScope", apiScope),
						]),
					);
				} else {
					body.push(Code.make({ value: example.code.display, lang: example.language }));
				}
			}
			return;
		}
		case "see-also": {
			body.heading(2, "See Also");
			body.pushResult(Result.all(block.references.map(escapedPhrasing)), (references) => {
				body.push(
					List.make({
						ordered: false,
						spread: false,
						children: references.map((reference) => ListItem.make({ spread: false, children: [paragraph(reference)] })),
					}),
				);
			});
			return;
		}
		case "member-index": {
			body.heading(2, block.title);
			body.pushResult(
				Result.all(
					block.entries.map((entry) => (entry.summary ? escapedPhrasing(entry.summary) : Result.succeed(undefined))),
				),
				(summaries) => {
					const items = block.entries.map((entry, index) => {
						const children: PhrasingContent[] = [Link.make({ url: entry.route, children: [text(entry.name)] })];
						const summary = summaries[index];
						if (summary !== undefined) children.push(text(" - "), ...summary);
						return ListItem.make({ spread: false, children: [paragraph(children)] });
					});
					body.push(List.make({ ordered: false, spread: false, children: items }));
				},
			);
			return;
		}
	}
	// Exhaustiveness: every block kind is handled above.
	const _exhaustive: never = block;
	void _exhaustive;
	void page;
}

/**
 * Emit a page's MDX body: the component import lines followed by every
 * block, joined as the generators joined them. No frontmatter — the adapter
 * assembles that from the page facts, in the generate stage the snapshot
 * hash is taken in.
 */
export function emitMdxBody(page: Page, options: EmitMdxOptions): Emit {
	const body = new Body();
	body.push(MdxjsEsm.make({ value: importLines(page.kind) }));
	for (const block of page.blocks) emitBlock(body, block, page, options);
	return body.render();
}
