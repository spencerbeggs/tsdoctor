/**
 * The block vocabulary — the things a generated API page is built from,
 * named once so every adapter emits the same page in its own dialect.
 *
 * @remarks
 * Each block is a `Schema.Class` carrying `Schema.tag` on a domain-named
 * discriminant, `kind`, and the vocabulary is closed by the `Block`
 * union. Not `Data.TaggedEnum`: the IR must be decodable, validated at
 * construction and serializable as a stable artifact. Not
 * `Schema.TaggedClass`: it hardwires `_tag`, and a vocabulary that sits
 * beside mdast nodes discriminated on `type` reads better with its own key.
 *
 * Prose inside a block is `@effected/markdown` mdast — already cross-linked
 * by the builder, so every emitter renders identical links. Code-bearing
 * blocks carry a {@link CodeText} pair: `display` (what a reader sees and
 * copies) and `source` (what the type-checker sees), produced once by the
 * `Examples` module and never derived from each other in an emitter.
 *
 * @packageDocumentation
 */

import { FlowContent, PhrasingContent } from "@effected/markdown";
import { Schema } from "effect";

/**
 * A run of block-level mdast — a summary paragraph, a remarks section.
 *
 * @public
 */
export const Prose = Schema.Array(FlowContent);

/**
 * A run of inline mdast — a one-line description, a table cell, a
 * deprecation message.
 *
 * @public
 */
export const Inline = Schema.Array(PhrasingContent);

/**
 * The TSDoc release tag a page's title badge is derived from.
 *
 * @public
 */
export const ReleaseTag = Schema.Literals(["Public", "Beta", "Alpha", "Internal"]);

/**
 * The two spellings of one code block: what a reader sees and what the
 * type-checker sees.
 *
 * @remarks
 * `source` is the type-check text — hidden `import type` lines, then
 * `// ---cut---`, then the code, Twoslash directives intact. `display` is
 * the directive-stripped text a reader sees and copies. RSPress spends them
 * as two props; VitePress puts `source` in a `ts twoslash` fence and lets the
 * cut marker hide the preamble. Carrying both is one field of redundancy
 * against a transformer per framework.
 *
 * @public
 */
export class CodeText extends Schema.Class<CodeText>("CodeText")({
	/** The directive-stripped text a reader sees and copies. */
	display: Schema.String,
	/** The type-check text: hidden imports, cut marker, directives intact. */
	source: Schema.String,
}) {}

/**
 * One row of a parameters table.
 *
 * @public
 */
export class ParameterRow extends Schema.Class<ParameterRow>("ParameterRow")({
	/** The parameter name as declared. */
	name: Schema.String,
	/** The parameter's type text from the declaration excerpt, when the declaration carries one. */
	type: Schema.optionalKey(Schema.String),
	/** The `@param` description, cross-linked. */
	description: Inline,
}) {}

/**
 * One row of an enum members table.
 *
 * @public
 */
export class EnumMemberRow extends Schema.Class<EnumMemberRow>("EnumMemberRow")({
	/** The member name. */
	name: Schema.String,
	/** The initializer value, when the declaration carries one. */
	value: Schema.optionalKey(Schema.String),
	/** The member's summary, cross-linked. */
	description: Inline,
}) {}

/**
 * The role a class or interface member plays, which decides its heading
 * group and how an emitter labels it.
 *
 * @public
 */
export const MemberRole = Schema.Literals([
	"constructor",
	"property",
	"method",
	"getter",
	"call-signature",
	"construct-signature",
	"index-signature",
]);

/**
 * One member of a class or interface: its own signature, summary and the
 * anchor id every cross-link to it resolves against.
 *
 * @remarks
 * `anchor` arrives as data from `ApiItems.memberAnchors` in
 * `@tsdoctor/model`, threaded through the work item. No emitter recomputes
 * it — the route map's `#fragment` and the page's element id must come from
 * one computation, or cross-links land nowhere.
 *
 * @public
 */
export class Member extends Schema.Class<Member>("Member")({
	/** Which heading group the member belongs to and how it is labelled. */
	role: MemberRole,
	/** The member's display name (`constructor` for constructors). */
	name: Schema.String,
	/** The anchor id, computed once by the model's member-anchor algorithm. */
	anchor: Schema.String,
	/** The member signature in its owner's context. */
	code: CodeText,
	/** The member's summary, cross-linked. */
	summary: Schema.optionalKey(Inline),
	/** The member's parameters, when it has any. */
	parameters: Schema.optionalKey(Schema.Array(ParameterRow)),
	/** The `@returns` description, cross-linked. */
	returns: Schema.optionalKey(Inline),
}) {}

/**
 * One example: its language, its code and whether it is type-checked.
 *
 * @remarks
 * A non-TypeScript example is never type-checked; emitters render its
 * `display` in a plain fence. A type-checked example carries the `@noErrors`
 * directive and the package import in `source`.
 *
 * @public
 */
export class Example extends Schema.Class<Example>("Example")({
	/** The fence language after normalization (`typescript` for TS/JS). */
	language: Schema.String,
	/** The formatted example. */
	code: CodeText,
	/** Whether the example is handed to Twoslash. */
	typeChecked: Schema.Boolean,
}) {}

/**
 * One entry in a namespace page's member index.
 *
 * @public
 */
export class MemberIndexEntry extends Schema.Class<MemberIndexEntry>("MemberIndexEntry")({
	/** The member's display name. */
	name: Schema.String,
	/** The route of the member's own page. */
	route: Schema.String,
	/** The member's summary, cross-linked. */
	summary: Schema.optionalKey(Inline),
}) {}

/**
 * The page title, with the release-tag badge and deprecation notice that
 * render beside it.
 *
 * @public
 */
export class Title extends Schema.Class<Title>("Title")({
	kind: Schema.tag("title"),
	/** The item's display name. */
	name: Schema.String,
	/** The release tag; emitters badge anything other than `Public`. */
	releaseTag: ReleaseTag,
	/** The `@deprecated` message, cross-linked, when present. */
	deprecation: Schema.optionalKey(Inline),
}) {}

/**
 * The "Available from" line for an item exported from several entry points.
 *
 * @public
 */
export class AvailableFrom extends Schema.Class<AvailableFrom>("AvailableFrom")({
	kind: Schema.tag("available-from"),
	/** The package name the entry points are spelled under. */
	packageName: Schema.String,
	/** Entry point names; `default` denotes the package root. */
	entryPoints: Schema.Array(Schema.String),
}) {}

/**
 * The role a prose block plays, which decides whether an emitter gives it a
 * heading and what the heading says.
 *
 * @public
 */
export const ProseRole = Schema.Literals(["summary", "remarks", "returns"]);

/**
 * A prose section: the summary, the remarks, a function's returns.
 *
 * @public
 */
export class ProseBlock extends Schema.Class<ProseBlock>("ProseBlock")({
	kind: Schema.tag("prose"),
	/** Which section this is. */
	role: ProseRole,
	/** The section body, cross-linked. */
	content: Prose,
}) {}

/**
 * The link to the item's source code.
 *
 * @public
 */
export class SourceLink extends Schema.Class<SourceLink>("SourceLink")({
	kind: Schema.tag("source-link"),
	/** The resolved source URL. */
	href: Schema.String,
}) {}

/**
 * The item's full signature block — a function signature, a class or
 * interface skeleton listing every member, an enum with its members.
 *
 * @public
 */
export class Signature extends Schema.Class<Signature>("Signature")({
	kind: Schema.tag("signature"),
	/** The signature text pair. */
	code: CodeText,
	/** Whether a parameters table follows directly (functions). */
	hasParameters: Schema.optionalKey(Schema.Boolean),
	/** Whether a members table follows directly (enums). */
	hasMembers: Schema.optionalKey(Schema.Boolean),
}) {}

/**
 * The inline "Base Class" section for a synthetic base declaration — the
 * unexported `Foo_base` an exported class extends.
 *
 * @remarks
 * The section heading slugs to `SyntheticBases.BASE_CLASS_ANCHOR` in
 * `@tsdoctor/model`, which is where the base name's cross-link route points.
 *
 * @public
 */
export class BaseClass extends Schema.Class<BaseClass>("BaseClass")({
	kind: Schema.tag("base-class"),
	/** The exported class. */
	className: Schema.String,
	/** The unexported base declaration's name. */
	baseName: Schema.String,
	/** The package the base is not exported from. */
	packageName: Schema.String,
	/** The base declaration's signature. */
	code: CodeText,
}) {}

/**
 * A heading group of members — "Constructors", "Static Methods",
 * "Properties", "Call Signatures" — in the order the page lists them.
 *
 * @public
 */
export class MemberGroup extends Schema.Class<MemberGroup>("MemberGroup")({
	kind: Schema.tag("member-group"),
	/** The group heading. */
	title: Schema.String,
	/** The members, in declaration order. */
	members: Schema.Array(Member),
}) {}

/**
 * A parameters table at page level — a function's parameters, adjacent to
 * its signature.
 *
 * @public
 */
export class ParameterTable extends Schema.Class<ParameterTable>("ParameterTable")({
	kind: Schema.tag("parameters"),
	/** The rows, in declaration order. */
	rows: Schema.Array(ParameterRow),
}) {}

/**
 * An enum's members table, adjacent to its signature.
 *
 * @public
 */
export class EnumMemberTable extends Schema.Class<EnumMemberTable>("EnumMemberTable")({
	kind: Schema.tag("enum-members"),
	/** The rows, in declaration order. */
	rows: Schema.Array(EnumMemberRow),
}) {}

/**
 * The "Examples" section.
 *
 * @public
 */
export class ExampleGroup extends Schema.Class<ExampleGroup>("ExampleGroup")({
	kind: Schema.tag("examples"),
	/** The examples, in TSDoc order. */
	items: Schema.Array(Example),
}) {}

/**
 * The "See Also" section — one cross-linked reference per `@see` tag.
 *
 * @public
 */
export class SeeAlso extends Schema.Class<SeeAlso>("SeeAlso")({
	kind: Schema.tag("see-also"),
	/** The references, in TSDoc order. */
	references: Schema.Array(Inline),
}) {}

/**
 * A namespace page's index of one member kind — "Classes", "Functions" —
 * linking to each member's own page.
 *
 * @public
 */
export class MemberIndex extends Schema.Class<MemberIndex>("MemberIndex")({
	kind: Schema.tag("member-index"),
	/** The section heading. */
	title: Schema.String,
	/** The entries, in declaration order. */
	entries: Schema.Array(MemberIndexEntry),
}) {}

/**
 * The closed vocabulary: every block a page may carry.
 *
 * @remarks
 * Narrow on `kind`. Construct the variant classes rather than the union's
 * inherited `make`, which typechecks against every member and yields a
 * many-branch error when it fails.
 *
 * @public
 */
export const Block = Schema.Union([
	Title,
	AvailableFrom,
	ProseBlock,
	SourceLink,
	Signature,
	BaseClass,
	MemberGroup,
	ParameterTable,
	EnumMemberTable,
	ExampleGroup,
	SeeAlso,
	MemberIndex,
]);

/**
 * A block instance — one member of the `Block` union.
 *
 * @public
 */
export type Block = typeof Block.Type;

/**
 * The discriminant values of the `Block` union.
 *
 * @public
 */
export type BlockKind = Block["kind"];
