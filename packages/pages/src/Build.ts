/**
 * The `ApiItem` → {@link Page} builders — one per item kind — lifted from
 * the RSPress adapter's page generators, so what a generated page CONTAINS
 * is decided once and every emitter spends the same blocks.
 *
 * @remarks
 * Characterization, not redesign: each builder produces exactly the blocks
 * its generator emitted, in the same order, with the same text — the golden
 * gate over the fixture sites is the oracle. Prose enters the IR as mdast
 * parsed from the cross-linked text, so links are baked in and every emitter
 * renders them identically. Anchors arrive as data through
 * {@link BuildPageInput.memberAnchors}; only the fixed anchors of a
 * constructor and of call/construct/index signatures are spelled here, via
 * the model's `Routes.memberAnchor` — the same algorithm, never a second one.
 *
 * Two generator quirks are carried deliberately, because the gate cannot
 * see them and normalizing them is a product change for a later, labelled
 * commit: the summary paragraph is NOT cross-linked (no generator linked
 * it), and the namespace member index routes members into the DEFAULT
 * category folders (`class`, `function`, …) rather than the configured
 * ones.
 *
 * @packageDocumentation
 */

import type { FlowContent, PhrasingContent } from "@effected/markdown";
import { Markdown, Paragraph, Text } from "@effected/markdown";
import type {
	ApiClass,
	ApiDeclaredItem,
	ApiEnum,
	ApiInterface,
	ApiItem,
	ApiNamespace,
} from "@microsoft/api-extractor-model";
import { ApiItemKind } from "@microsoft/api-extractor-model";
import type { CrossLinker } from "@tsdoctor/model";
import { ApiItems, Signature as ModelSignature, Routes, Tsdoc, TypeReferenceExtractor } from "@tsdoctor/model";
import { Effect, Option, Result, Schema } from "effect";
import type { Block, MemberRole } from "./Blocks.js";
import {
	AvailableFrom,
	BaseClass,
	CodeText,
	EnumMemberRow,
	EnumMemberTable,
	Example,
	ExampleGroup,
	Member,
	MemberGroup,
	MemberIndex,
	MemberIndexEntry,
	ParameterRow,
	ParameterTable,
	ProseBlock,
	SeeAlso,
	Signature,
	SourceLink,
	Title,
} from "./Blocks.js";
import type { ExampleFormatError } from "./Examples.js";
import { codeText, formatExampleCode, prepareExampleCode, prependHiddenImports } from "./Examples.js";
import { NavEntry } from "./Nav.js";
import type { HeadTag, PageKind } from "./Page.js";
import { Page } from "./Page.js";

/**
 * The description a page carries when its item has no summary.
 *
 * @public
 */
export const NO_DESCRIPTION = "No description available.";

/**
 * A member of a namespace, as the adapter's work item carries it: the
 * qualified name decides the page route and the sidebar label.
 *
 * @public
 */
export interface NamespaceMemberFacts {
	/** `Namespace.member`, as the route's last segment and the nav label. */
	readonly qualifiedName: string;
}

/**
 * The input to {@link buildPage}: the item plus every fact the adapter's
 * work item and API configuration contribute.
 *
 * @public
 */
export interface BuildPageInput {
	/** The documented item. */
	readonly item: ApiItem;
	/** The category key the item was categorized under. */
	readonly categoryKey: string;
	/** The category's singular name — the second title part. */
	readonly singularName: string;
	/** The category folder the page lives in. */
	readonly folderName: string;
	/** The API's base route. */
	readonly baseRoute: string;
	/** The package name examples import from and "Available from" spells. */
	readonly packageName: string;
	/** The API's display name — the last title part, when the site names one. */
	readonly apiName?: string | undefined;
	/** Present when the item is a namespace member documented on its own page. */
	readonly namespaceMember?: NamespaceMemberFacts | undefined;
	/** Entry points the item is exported from; more than one yields an "Available from" line. */
	readonly availableFrom?: ReadonlyArray<string> | undefined;
	/** The unexported base declaration a class extends, rendered inline. */
	readonly syntheticBase?: ApiItem | undefined;
	/** Anchor id per member, keyed by canonical reference, from `ApiItems.memberAnchors`. */
	readonly memberAnchors?: ReadonlyMap<string, string> | undefined;
	/** The source repository, when the site links to it. */
	readonly source?: ApiItems.SourceLinkTarget | undefined;
	/** Whether examples carry `@noErrors`; defaults to `true`. */
	readonly suppressExampleErrors?: boolean | undefined;
	/** The cross-linker built from the API's route map. */
	readonly linker: CrossLinker;
	/** Head tags for the page, when the adapter has them before building. */
	readonly headTags?: ReadonlyArray<HeadTag> | undefined;
	/**
	 * Called when Prettier cannot format an example; the example then carries
	 * its unformatted code. Absent, the failure is silent.
	 */
	readonly onExampleFormatError?: ((error: ExampleFormatError) => Effect.Effect<void>) | undefined;
}

/**
 * The input to {@link buildIndexPage}.
 *
 * @public
 */
export interface BuildIndexPageInput {
	/** The package the index introduces. */
	readonly packageName: string;
	/** The API's base route; the index lives at its root. */
	readonly baseRoute: string;
}

/**
 * The API landing page: frontmatter facts only, no blocks.
 *
 * @public
 */
export class IndexPage extends Schema.Class<IndexPage>("IndexPage")({
	/** The page route (`{baseRoute}/index`). */
	route: Schema.String,
	/** The page title. */
	title: Schema.String,
	/** The page description. */
	description: Schema.String,
}) {}

/**
 * The label of the index page.
 *
 * @public
 */
export const INDEX_PAGE_TITLE = "API Reference";

/**
 * Build the API landing page.
 *
 * @public
 */
export function buildIndexPage(input: BuildIndexPageInput): IndexPage {
	return IndexPage.make({
		route: `${input.baseRoute}/index`,
		title: INDEX_PAGE_TITLE,
		description: `Auto-generated API documentation for ${input.packageName}`,
	});
}

// ── Prose ──────────────────────────────────────────────────────────────────

const PARSE_OPTIONS = { dialect: "commonmark" } as const;

/**
 * Parse a one-line prose string as phrasing content. Total: a parse failure
 * (a hardening-guard trip on a pathological string) degrades to the raw
 * text.
 */
function phrasing(text: string): ReadonlyArray<PhrasingContent> {
	const parsed = Markdown.parsePhrasingResult(text, PARSE_OPTIONS);
	return Result.isSuccess(parsed) ? parsed.success : [Text.make({ value: text })];
}

/** Cross-link a prose string, then parse it as phrasing content. */
function linked(linker: CrossLinker, text: string): ReadonlyArray<PhrasingContent> {
	return phrasing(linker.link(text));
}

/** Parse a prose string as flow content. Total, on the same terms as {@link phrasing}. */
function flow(text: string): ReadonlyArray<FlowContent> {
	const parsed = Markdown.parseResult(text, PARSE_OPTIONS);
	if (Result.isSuccess(parsed)) {
		const nodes = parsed.success.children.filter(
			(node): node is FlowContent => node.type !== "frontmatter" && node.type !== "mdxjsEsm",
		);
		if (nodes.length > 0) return nodes;
	}
	return [Paragraph.make({ children: [Text.make({ value: text })] })];
}

// ── Signatures ─────────────────────────────────────────────────────────────

/** The formatted declaration excerpt, or `""` when the item has none. */
function excerptOf(item: ApiItem): string {
	const declared = item as ApiDeclaredItem;
	return declared.excerpt?.text ? ModelSignature.format(declared.excerpt).trim() : "";
}

/**
 * Prepend the hidden `import type` lines a code block needs for the external
 * types `scope` references, resolved against `owner`'s package.
 */
function withHiddenImports(code: string, owner: ApiItem, scope: ApiItem, packageName: string): string {
	const apiPackage = owner.getAssociatedPackage?.();
	if (!apiPackage) return code;
	const imports = new TypeReferenceExtractor(apiPackage, packageName).extractImportsForApiItem(scope);
	return prependHiddenImports(code, imports);
}

/** The `class X extends … implements … {` / `interface X<T> extends … {` opening line. */
function containerDeclaration(item: ApiClass | ApiInterface): string {
	const inheritance = ApiItems.inheritance(item);
	let declaration = item.kind === ApiItemKind.Class ? `class ${item.displayName}` : `interface ${item.displayName}`;
	if (item.kind === ApiItemKind.Interface) {
		const typeParameters = (item as ApiInterface).typeParameters;
		if (typeParameters && typeParameters.length > 0) {
			declaration += `<${typeParameters.map((parameter) => parameter.name).join(", ")}>`;
		}
	}
	if (inheritance.extends && inheritance.extends.length > 0) {
		declaration += ` extends ${inheritance.extends.join(", ")}`;
	}
	if (item.kind === ApiItemKind.Class && inheritance.implements && inheritance.implements.length > 0) {
		declaration += ` implements ${inheritance.implements.join(", ")}`;
	}
	return `${declaration} {`;
}

/** The full skeleton: the opening line, one indented line per member, the closing brace. */
function containerSkeleton(item: ApiClass | ApiInterface, members: ReadonlyArray<ApiItem>): string {
	const lines = [containerDeclaration(item)];
	for (const member of members) {
		const signature = excerptOf(member);
		if (signature) lines.push(`    ${signature}`);
	}
	lines.push("}");
	return lines.join("\n");
}

/** The three-line member context the hide-cut transformer trims: opening, member, closing. */
function memberContext(item: ApiClass | ApiInterface, member: ApiItem, packageName: string): string {
	return withHiddenImports(`${containerDeclaration(item)}\n${excerptOf(member)}\n}`, item, member, packageName);
}

// ── Members ────────────────────────────────────────────────────────────────

const isStatic = (member: ApiItem): boolean => (member as { isStatic?: boolean }).isStatic === true;
const isAccessorName = (member: ApiItem): boolean =>
	member.displayName.startsWith("get ") || member.displayName.startsWith("set ");

interface ClassMembers {
	readonly constructors: ReadonlyArray<ApiItem>;
	readonly staticProperties: ReadonlyArray<ApiItem>;
	readonly staticMethods: ReadonlyArray<ApiItem>;
	readonly instanceProperties: ReadonlyArray<ApiItem>;
	readonly getters: ReadonlyArray<ApiItem>;
	readonly instanceMethods: ReadonlyArray<ApiItem>;
}

/** Group a class's members the way the class page lists and skeletons them. */
function classMembers(apiClass: ApiClass): ClassMembers {
	const properties = apiClass.members.filter((m) => m.kind === "Property" || m.kind === "PropertySignature");
	const methods = apiClass.members.filter((m) => m.kind === "Method" || m.kind === "MethodSignature");
	return {
		constructors: apiClass.members.filter((m) => m.kind === "Constructor"),
		staticProperties: properties.filter(isStatic),
		staticMethods: methods.filter((m) => !(m.kind === "Method" && isAccessorName(m)) && isStatic(m)),
		instanceProperties: properties.filter((m) => !isStatic(m) && !isAccessorName(m)),
		getters: methods.filter((m) => m.kind === "Method" && isAccessorName(m)),
		instanceMethods: methods.filter((m) => !(m.kind === "Method" && isAccessorName(m)) && !isStatic(m)),
	};
}

type Role = typeof MemberRole.Type;

interface MemberOptions {
	/** Carry `parameters` when the member documents any. */
	readonly parameters: boolean;
	/** Carry `returns` when the member documents one. */
	readonly returns: boolean;
}

interface MemberContext {
	readonly owner: ApiClass | ApiInterface;
	readonly packageName: string;
	readonly linker: CrossLinker;
	readonly anchors: ReadonlyMap<string, string>;
}

/** The anchor a member's page element carries — data from the work item, or the model's own algorithm. */
function anchorOf(ctx: MemberContext, member: ApiItem): string {
	return (
		ctx.anchors.get(member.canonicalReference?.toString() ?? member.displayName) ??
		Routes.memberAnchor(member.displayName)
	);
}

function parameterRows(linker: CrossLinker, item: ApiItem): ReadonlyArray<ParameterRow> {
	return Tsdoc.params(item).map((parameter) =>
		ParameterRow.make({
			name: parameter.name,
			...(parameter.type !== undefined ? { type: parameter.type } : {}),
			description: linked(linker, parameter.description),
		}),
	);
}

/**
 * One member block, or none when the member has no declaration excerpt —
 * the generators rendered nothing for such a member.
 */
function buildMember(
	ctx: MemberContext,
	member: ApiItem,
	role: Role,
	name: string,
	anchor: string,
	options: MemberOptions,
): Option.Option<Member> {
	const signature = excerptOf(member);
	if (!signature) return Option.none();
	const summary = Tsdoc.summary(member);
	const parameters = options.parameters ? parameterRows(ctx.linker, member) : [];
	const returns = options.returns ? Tsdoc.returns(member) : null;
	return Option.some(
		Member.make({
			role,
			name,
			anchor,
			code: CodeText.make({ display: signature, source: memberContext(ctx.owner, member, ctx.packageName) }),
			...(summary ? { summary: linked(ctx.linker, summary) } : {}),
			...(parameters.length > 0 ? { parameters } : {}),
			...(returns ? { returns: linked(ctx.linker, returns.description) } : {}),
		}),
	);
}

/**
 * A member whose name and anchor are fixed by its role rather than its
 * declaration: a constructor, or an interface's call/construct/index
 * signatures, which have no name of their own.
 */
interface FixedMember {
	readonly name: string;
	readonly anchor: string;
}

const fixedMember = (name: string, anchorName: string): FixedMember => ({
	name,
	anchor: Routes.memberAnchor(anchorName),
});

/** A heading group, or none when no member of the list renders. */
function memberGroup(
	ctx: MemberContext,
	title: string,
	members: ReadonlyArray<ApiItem>,
	role: Role,
	options: MemberOptions,
	fixed?: FixedMember,
): Option.Option<MemberGroup> {
	if (members.length === 0) return Option.none();
	const built: Member[] = [];
	for (const member of members) {
		const anchor = fixed ? fixed.anchor : anchorOf(ctx, member);
		const name = fixed ? fixed.name : member.displayName;
		const result = buildMember(ctx, member, role, name, anchor, options);
		if (Option.isSome(result)) built.push(result.value);
	}
	return Option.some(MemberGroup.make({ title, members: built }));
}

// ── Shared sections ────────────────────────────────────────────────────────

function titleBlock(item: ApiItem, linker: CrossLinker): Title {
	const deprecation = Tsdoc.deprecation(item);
	return Title.make({
		name: item.displayName,
		releaseTag: Tsdoc.releaseTag(item),
		...(deprecation ? { deprecation: linked(linker, deprecation.message) } : {}),
	});
}

function headBlocks(input: BuildPageInput, summary: string): Block[] {
	const blocks: Block[] = [
		titleBlock(input.item, input.linker),
		ProseBlock.make({ role: "summary", content: flow(summary) }),
	];
	if (input.availableFrom && input.availableFrom.length > 1) {
		blocks.push(AvailableFrom.make({ packageName: input.packageName, entryPoints: input.availableFrom }));
	}
	const href = ApiItems.sourceLink(input.item, input.source);
	if (href) blocks.push(SourceLink.make({ href }));
	return blocks;
}

const buildExampleWithFallback = (input: BuildPageInput, example: Tsdoc.DocExample): Effect.Effect<Example> =>
	Effect.gen(function* () {
		const prepared = prepareExampleCode(
			example,
			input.item.displayName,
			input.packageName,
			input.suppressExampleErrors,
		);
		const formatted = yield* formatExampleCode(prepared.code, prepared.language).pipe(
			Effect.catchTag("ExampleFormatError", (error) =>
				(input.onExampleFormatError ? input.onExampleFormatError(error) : Effect.void).pipe(Effect.as(prepared.code)),
			),
		);
		return Example.make({
			language: prepared.language,
			code: prepared.isTypeScript ? codeText(formatted) : CodeText.make({ display: formatted, source: formatted }),
			typeChecked: prepared.isTypeScript,
		});
	});

const tailBlocks = (input: BuildPageInput): Effect.Effect<Block[]> =>
	Effect.gen(function* () {
		const blocks: Block[] = [];
		const examples = Tsdoc.examples(input.item);
		if (examples.length > 0) {
			const items = yield* Effect.forEach(examples, (example) => buildExampleWithFallback(input, example));
			blocks.push(ExampleGroup.make({ items }));
		}
		const references = Tsdoc.seeReferences(input.item);
		if (references.length > 0) {
			blocks.push(SeeAlso.make({ references: references.map((reference) => linked(input.linker, reference.text)) }));
		}
		return blocks;
	});

// ── Per-kind bodies ────────────────────────────────────────────────────────

function classBody(input: BuildPageInput, apiClass: ApiClass): Block[] {
	const { packageName, linker } = input;
	const members = classMembers(apiClass);
	const ctx: MemberContext = {
		owner: apiClass,
		packageName,
		linker,
		anchors: input.memberAnchors ?? ApiItems.memberAnchors(apiClass),
	};
	const blocks: Block[] = [];

	const skeleton = containerSkeleton(apiClass, [
		...members.constructors,
		...members.staticProperties,
		...members.staticMethods,
		...members.instanceProperties,
		...members.getters,
		...members.instanceMethods,
	]);
	blocks.push(Signature.make({ code: codeText(withHiddenImports(skeleton, apiClass, apiClass, packageName)) }));

	const base = input.syntheticBase as ApiDeclaredItem | undefined;
	if (base?.excerpt?.text) {
		const signature = ModelSignature.format(base.excerpt).trim();
		blocks.push(
			BaseClass.make({
				className: apiClass.displayName,
				baseName: base.displayName,
				packageName,
				code: codeText(withHiddenImports(signature, apiClass, base, packageName)),
			}),
		);
	}

	const withParameters: MemberOptions = { parameters: true, returns: false };
	const methodOptions: MemberOptions = { parameters: true, returns: true };
	const propertyOptions: MemberOptions = { parameters: false, returns: false };
	const groups = [
		memberGroup(
			ctx,
			"Constructors",
			members.constructors,
			"constructor",
			withParameters,
			fixedMember("constructor", "constructor"),
		),
		memberGroup(ctx, "Static Properties", members.staticProperties, "property", propertyOptions),
		memberGroup(ctx, "Static Methods", members.staticMethods, "method", methodOptions),
		memberGroup(ctx, "Properties", members.instanceProperties, "property", propertyOptions),
		memberGroup(ctx, "Getters & Setters", members.getters, "getter", methodOptions),
		memberGroup(ctx, "Methods", members.instanceMethods, "method", methodOptions),
	];
	for (const group of groups) if (Option.isSome(group)) blocks.push(group.value);
	return blocks;
}

function interfaceBody(input: BuildPageInput, apiInterface: ApiInterface): Block[] {
	const { packageName, linker } = input;
	const ctx: MemberContext = {
		owner: apiInterface,
		packageName,
		linker,
		anchors: input.memberAnchors ?? ApiItems.memberAnchors(apiInterface),
	};
	const ofKind = (kind: string): ReadonlyArray<ApiItem> => apiInterface.members.filter((m) => m.kind === kind);
	const callSignatures = ofKind("CallSignature");
	const constructSignatures = ofKind("ConstructSignature");
	const indexSignatures = ofKind("IndexSignature");
	const properties = ofKind("PropertySignature");
	const methods = ofKind("MethodSignature");

	const blocks: Block[] = [];
	const skeleton = containerSkeleton(apiInterface, [
		...callSignatures,
		...constructSignatures,
		...indexSignatures,
		...properties,
		...methods,
	]);
	blocks.push(Signature.make({ code: codeText(withHiddenImports(skeleton, apiInterface, apiInterface, packageName)) }));

	const plain: MemberOptions = { parameters: false, returns: false };
	const groups = [
		memberGroup(
			ctx,
			"Call Signatures",
			callSignatures,
			"call-signature",
			plain,
			fixedMember("Call Signature", "call-signature"),
		),
		memberGroup(
			ctx,
			"Construct Signatures",
			constructSignatures,
			"construct-signature",
			plain,
			fixedMember("Construct Signature", "construct-signature"),
		),
		memberGroup(
			ctx,
			"Index Signature",
			indexSignatures,
			"index-signature",
			plain,
			fixedMember("Index Signature", "index-signature"),
		),
		memberGroup(ctx, "Properties", properties, "property", plain),
		memberGroup(ctx, "Methods", methods, "method", { parameters: true, returns: true }),
	];
	for (const group of groups) if (Option.isSome(group)) blocks.push(group.value);
	return blocks;
}

function functionBody(input: BuildPageInput): Block[] {
	const { item, packageName, linker } = input;
	const blocks: Block[] = [];
	const rows = parameterRows(linker, item);
	const signature = excerptOf(item);
	if (signature) {
		blocks.push(
			Signature.make({
				code: codeText(withHiddenImports(signature, item, item, packageName)),
				hasParameters: rows.length > 0,
			}),
		);
	}
	if (rows.length > 0) blocks.push(ParameterTable.make({ rows }));
	const returns = Tsdoc.returns(item);
	if (returns) {
		blocks.push(
			ProseBlock.make({
				role: "returns",
				content: [Paragraph.make({ children: [...linked(linker, returns.description)] })],
			}),
		);
	}
	return blocks;
}

function declarationBody(input: BuildPageInput): Block[] {
	const { item, packageName } = input;
	const signature = excerptOf(item);
	if (!signature) return [];
	return [Signature.make({ code: codeText(withHiddenImports(signature, item, item, packageName)) })];
}

/** The initializer after `=` in an enum member's excerpt, without a trailing comma. */
function enumMemberValue(member: ApiItem): string | undefined {
	const text = (member as ApiDeclaredItem).excerpt?.text?.trim();
	if (!text) return undefined;
	const equals = text.indexOf("=");
	if (equals === -1) return undefined;
	return text
		.substring(equals + 1)
		.trim()
		.replace(/,\s*$/, "");
}

function enumBody(input: BuildPageInput, apiEnum: ApiEnum): Block[] {
	const { linker } = input;
	const members = apiEnum.members;
	const lines = [`enum ${apiEnum.displayName} {`];
	members.forEach((member, index) => {
		const value = enumMemberValue(member);
		const line = `    ${member.displayName}${value !== undefined ? ` = ${value}` : ""}`;
		lines.push(index < members.length - 1 ? `${line},` : line);
	});
	lines.push("}");
	const hasMembers = members.length > 0;
	const blocks: Block[] = [Signature.make({ code: codeText(lines.join("\n")), hasMembers })];
	if (hasMembers) {
		blocks.push(
			EnumMemberTable.make({
				rows: members.map((member) => {
					const value = enumMemberValue(member);
					return EnumMemberRow.make({
						name: member.displayName,
						...(value !== undefined ? { value } : {}),
						description: linked(linker, Tsdoc.summary(member) || ""),
					});
				}),
			}),
		);
	}
	return blocks;
}

/** The namespace member index sections, in the order the namespace page lists them. */
const NAMESPACE_SECTIONS: ReadonlyArray<readonly [title: string, kind: ApiItemKind, folder: string]> = [
	["Classes", ApiItemKind.Class, "class"],
	["Interfaces", ApiItemKind.Interface, "interface"],
	["Functions", ApiItemKind.Function, "function"],
	["Variables", ApiItemKind.Variable, "variable"],
	["Types", ApiItemKind.TypeAlias, "type"],
	["Enums", ApiItemKind.Enum, "enum"],
	["Namespaces", ApiItemKind.Namespace, "namespace"],
];

/** A declaration abbreviated to its header — everything before the opening brace. */
function abbreviate(signature: string): string {
	const brace = signature.indexOf("{");
	return brace === -1 ? signature : signature.substring(0, brace).trim();
}

function namespaceBody(input: BuildPageInput, apiNamespace: ApiNamespace): Block[] {
	const { packageName, linker, baseRoute } = input;
	const name = apiNamespace.displayName;
	const lines = [`namespace ${name} {`];
	const bodied = new Set<ApiItemKind>([
		ApiItemKind.Class,
		ApiItemKind.Interface,
		ApiItemKind.Enum,
		ApiItemKind.Namespace,
	]);
	for (const [, kind] of NAMESPACE_SECTIONS) {
		for (const member of apiNamespace.members) {
			if (member.kind !== kind) continue;
			const signature = excerptOf(member);
			if (!signature) continue;
			lines.push(bodied.has(kind) ? `    ${abbreviate(signature)} { }` : `    ${signature}`);
		}
	}
	lines.push("}");
	const blocks: Block[] = [
		Signature.make({ code: codeText(withHiddenImports(lines.join("\n"), apiNamespace, apiNamespace, packageName)) }),
	];
	for (const [title, kind, folder] of NAMESPACE_SECTIONS) {
		const members = apiNamespace.members.filter((member) => member.kind === kind);
		if (members.length === 0) continue;
		blocks.push(
			MemberIndex.make({
				title,
				entries: members.map((member) => {
					const summary = Tsdoc.summary(member);
					return MemberIndexEntry.make({
						name: member.displayName,
						route: `${baseRoute}/${folder}/${`${name}.${member.displayName}`.toLowerCase()}`,
						...(summary ? { summary: linked(linker, summary) } : {}),
					});
				}),
			}),
		);
	}
	return blocks;
}

/** The page kind for a supported item kind, or none for anything else. */
function pageKindOf(kind: ApiItemKind): Option.Option<PageKind> {
	switch (kind) {
		case ApiItemKind.Class:
			return Option.some("class");
		case ApiItemKind.Interface:
			return Option.some("interface");
		case ApiItemKind.Function:
			return Option.some("function");
		case ApiItemKind.TypeAlias:
			return Option.some("type-alias");
		case ApiItemKind.Enum:
			return Option.some("enum");
		case ApiItemKind.Variable:
			return Option.some("variable");
		case ApiItemKind.Namespace:
			return Option.some("namespace");
		default:
			return Option.none();
	}
}

/**
 * Whether {@link buildPage} produces a page for an item of this kind.
 *
 * @public
 */
export function isPageKind(kind: ApiItemKind): boolean {
	return Option.isSome(pageKindOf(kind));
}

function bodyFor(input: BuildPageInput, kind: PageKind): Block[] {
	switch (kind) {
		case "class":
			return classBody(input, input.item as ApiClass);
		case "interface":
			return interfaceBody(input, input.item as ApiInterface);
		case "function":
			return functionBody(input);
		case "enum":
			return enumBody(input, input.item as ApiEnum);
		case "namespace":
			return namespaceBody(input, input.item as ApiNamespace);
		case "type-alias":
		case "variable":
			return declarationBody(input);
	}
}

/**
 * Build the page for one item, or none for an item kind that gets no page.
 *
 * @remarks
 * The route is `{baseRoute}/{folderName}/{name}` with the name lowercased;
 * a namespace member's last segment is its lowercased qualified name, which
 * is also its sidebar label. Only Prettier can fail here, and that failure
 * degrades through {@link BuildPageInput.onExampleFormatError}, so the
 * error channel is `never`.
 *
 * @public
 */
export const buildPage: (input: BuildPageInput) => Effect.Effect<Option.Option<Page>> = Effect.fn("Build.buildPage")(
	function* (input: BuildPageInput) {
		const kind = pageKindOf(input.item.kind);
		if (Option.isNone(kind)) return Option.none();

		const { item } = input;
		const summary = Tsdoc.summary(item) || NO_DESCRIPTION;
		const label = input.namespaceMember ? input.namespaceMember.qualifiedName : item.displayName;
		const name = label.toLowerCase();
		const route = `${input.baseRoute}/${input.folderName}/${name}`;

		const blocks: Block[] = [
			...headBlocks(input, summary),
			...bodyFor(input, kind.value),
			...(yield* tailBlocks(input)),
		];

		return Option.some(
			Page.make({
				kind: kind.value,
				entityName: item.displayName,
				singularName: input.singularName,
				...(input.apiName !== undefined ? { apiName: input.apiName } : {}),
				description: summary,
				route,
				headTags: input.headTags ?? [],
				blocks,
				nav: NavEntry.make({ categoryKey: input.categoryKey, label, name, route }),
			}),
		);
	},
);
