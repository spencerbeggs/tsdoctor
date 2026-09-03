/**
 * The RSPress MDX emitter, pinned at the byte level against what the page
 * generators emitted for each construct. The golden gate over the fixture
 * sites covers what those sites exercise; this covers the constructs they
 * do not — deprecation notices, the source toolbar, non-TypeScript fences,
 * generics escaping, the underscore/ampersand shim — with hand-built IR.
 */

import { Markdown } from "@effected/markdown";
import type { Block } from "@tsdoctor/pages";
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
	NavEntry,
	Page,
	ParameterRow,
	ParameterTable,
	ProseBlock,
	SeeAlso,
	Signature,
	SourceLink,
	Title,
} from "@tsdoctor/pages";
import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { emitMdxBody, escapeMdxGenerics } from "../../src/emit/mdx.js";

const phrasing = (text: string) => [
	...Result.getOrThrow(Markdown.parsePhrasingResult(text, { dialect: "commonmark" })),
];
const flow = (text: string) => [...Result.getOrThrow(Markdown.parseResult(text, { dialect: "commonmark" })).children];
const code = (display: string, source = display) => CodeText.make({ display, source });

const nav = NavEntry.make({ categoryKey: "classes", label: "Foo", name: "foo", route: "/api/class/foo" });
const page = (kind: Page["kind"], blocks: ReadonlyArray<Block>): Page =>
	Page.make({
		kind,
		entityName: "Foo",
		singularName: "Class",
		description: "d",
		route: "/api/class/foo",
		headTags: [],
		blocks: [...blocks],
		nav,
	});
const emit = (kind: Page["kind"], blocks: ReadonlyArray<Block>, llmsEnabled = false): string =>
	Result.getOrThrow(emitMdxBody(page(kind, blocks), { apiScope: "api", llmsEnabled }));

const CLASS_IMPORTS =
	'import { SourceCode } from "@rspress/core/theme";\nimport { ParametersTable } from "rspress-plugin-api-extractor/runtime";\nimport { ApiSignature, ApiMember, ApiExample } from "rspress-plugin-api-extractor/runtime";\n\n';

describe("emitMdxBody — import lines per page kind", () => {
	it("class and interface pages import ApiMember", () => {
		expect(emit("class", [])).toBe(CLASS_IMPORTS);
		expect(emit("interface", [])).toBe(CLASS_IMPORTS);
	});

	it("function, type alias and variable pages import ParametersTable but not ApiMember", () => {
		const expected =
			'import { SourceCode } from "@rspress/core/theme";\nimport { ParametersTable } from "rspress-plugin-api-extractor/runtime";\nimport { ApiSignature, ApiExample } from "rspress-plugin-api-extractor/runtime";\n\n';
		for (const kind of ["function", "type-alias", "variable"] as const) expect(emit(kind, [])).toBe(expected);
	});

	it("enum pages import EnumMembersTable; namespace pages import only the code components", () => {
		expect(emit("enum", [])).toBe(
			'import { SourceCode } from "@rspress/core/theme";\nimport { EnumMembersTable } from "rspress-plugin-api-extractor/runtime";\nimport { ApiSignature, ApiExample } from "rspress-plugin-api-extractor/runtime";\n\n',
		);
		expect(emit("namespace", [])).toBe(
			'import { SourceCode } from "@rspress/core/theme";\nimport { ApiSignature, ApiExample } from "rspress-plugin-api-extractor/runtime";\n\n',
		);
	});
});

describe("emitMdxBody — title, badge, deprecation, summary", () => {
	it("renders the H1, a deprecation blockquote with escaped generics, and the release badge", () => {
		const out = emit("class", [
			Title.make({ name: "Foo", releaseTag: "Beta", deprecation: phrasing("Use Bar<T> or `Baz<U>` instead.") }),
			ProseBlock.make({ role: "summary", content: flow("A thing that does {stuff} with <T>.") }),
		]);
		expect(out).toBe(
			`${CLASS_IMPORTS}# Foo\n\n> ⚠️ **Deprecated:** Use Bar\`<T>\` or \`Baz<U>\` instead.\n\n\`Beta\`\n\nA thing that does {stuff} with <T>.\n\n`,
		);
	});

	it("emits an intraword underscore in the H1 raw — the kit escapes minimally, no shim", () => {
		const out = emit("variable", [Title.make({ name: "DEFAULT_PIPELINE_OPTIONS", releaseTag: "Public" })]);
		expect(out).toContain("# DEFAULT_PIPELINE_OPTIONS\n\n");
		expect(out).not.toContain("\\_");
	});

	it("emits an author-escaped intraword underscore raw: `\\_` parses to `_`, which cannot bind emphasis", () => {
		// Re-pinned on @effected/markdown@0.8.0: 0.7.0 re-escaped this as `snake\_case`.
		const out = emit("class", [ProseBlock.make({ role: "summary", content: flow("snake\\_case stays escaped") })]);
		expect(out).toContain("snake_case stays escaped");
		expect(out).not.toContain("\\_");
	});
});

describe("emitMdxBody — available from, source toolbar", () => {
	it("spells entry points as package specifiers", () => {
		const out = emit("class", [AvailableFrom.make({ packageName: "@x/y", entryPoints: ["default", "testing"] })]);
		expect(out).toBe(`${CLASS_IMPORTS}Available from: \`@x/y\`, \`@x/y/testing\`\n\n`);
	});

	it("renders the toolbar with the SourceCode link, and the LLMs slot only when enabled", () => {
		const blocks = [SourceLink.make({ href: "https://example.test/repo/blob/main/src/foo.ts#L10" })];
		expect(emit("class", blocks)).toBe(
			`${CLASS_IMPORTS}<div className="api-docs-toolbar">\n  <div className="api-docs-toolbar-left">\n    <SourceCode href="https://example.test/repo/blob/main/src/foo.ts#L10" />\n  </div>\n</div>\n\n`,
		);
		const withLlms = emit("class", blocks, true);
		expect(withLlms).toContain('<div className="api-docs-toolbar-right" />');
	});
});

describe("emitMdxBody — signatures and tables", () => {
	it("emits ApiSignature with code/source/apiScope, plus hasParameters when carried", () => {
		const out = emit("function", [
			Signature.make({
				code: code(
					"function f(a: string): void;",
					'import type { X } from "y";\n// ---cut---\nfunction f(a: string): void;',
				),
				hasParameters: true,
			}),
			ParameterTable.make({
				rows: [ParameterRow.make({ name: "a", type: "string", description: phrasing("A Map<K, V> of things") })],
			}),
			ProseBlock.make({ role: "returns", content: flow("A Promise<T>.") }),
		]);
		expect(out).toBe(
			`${CLASS_IMPORTS.replace("ApiSignature, ApiMember, ApiExample", "ApiSignature, ApiExample")}<ApiSignature code={"function f(a: string): void;"} source={"import type { X } from \\"y\\";\\n// ---cut---\\nfunction f(a: string): void;"} apiScope={"api"} hasParameters={true} />\n\n<ParametersTable parameters={[{"name":"a","type":"string","description":"A Map\`<K, V>\` of things"}]} />\n\n## Returns\n\nA Promise\`<T>\`.\n\n`,
		);
	});

	it("omits a parameter's type key when the declaration carries none", () => {
		const out = emit("function", [ParameterTable.make({ rows: [ParameterRow.make({ name: "a", description: [] })] })]);
		expect(out).toContain('<ParametersTable parameters={[{"name":"a","description":""}]} />');
	});

	it("keeps the enum members table adjacent to its signature with a single newline", () => {
		const out = emit("enum", [
			Signature.make({ code: code("enum E {\n    A = 1\n}"), hasMembers: true }),
			EnumMemberTable.make({
				rows: [
					EnumMemberRow.make({ name: "A", value: "1", description: phrasing("first") }),
					EnumMemberRow.make({ name: "B", description: [] }),
				],
			}),
		]);
		expect(out).toContain(
			'apiScope={"api"} hasMembers={true} />\n<EnumMembersTable members={[{"name":"A","value":"1","description":"first"},{"name":"B","description":""}]} />\n\n',
		);
	});

	it("an enum without members keeps the paragraph break after its signature", () => {
		const out = emit("enum", [Signature.make({ code: code("enum E {\n}"), hasMembers: false })]);
		expect(out).toMatch(/hasMembers=\{false\} \/>\n\n$/);
	});
});

describe("emitMdxBody — members", () => {
	// A member-level parameter description is NOT generics-escaped (the class
	// and interface generators never did), so the bare `<` reaches the kit,
	// which spells it `\<` — the same markdown, in the kit's canonical form.
	it("spells a constructor with a literal memberName and hasParameters, followed by its unescaped parameter table", () => {
		const out = emit("class", [
			MemberGroup.make({
				title: "Constructors",
				members: [
					Member.make({
						role: "constructor",
						name: "constructor",
						anchor: "constructor",
						code: code("constructor(a: T);", "class Foo {\nconstructor(a: T);\n}"),
						summary: phrasing("Makes a Foo<T>."),
						parameters: [ParameterRow.make({ name: "a", type: "T", description: phrasing("The Map<K, V>") })],
					}),
				],
			}),
		]);
		expect(out).toBe(
			`${CLASS_IMPORTS}## Constructors\n\n<ApiMember code={"constructor(a: T);"} source={"class Foo {\\nconstructor(a: T);\\n}"} apiScope={"api"} memberName="constructor" summary={"Makes a Foo\`<T>\`."} id={"constructor"} hasParameters={true} />\n\n<ParametersTable parameters={[{"name":"a","type":"T","description":"The Map\\\\<K, V>"}]} />\n\n`,
		);
	});

	it("spells a property without hasParameters and a method with its returns line", () => {
		const out = emit("class", [
			MemberGroup.make({
				title: "Getters & Setters",
				members: [
					Member.make({ role: "property", name: "size", anchor: "size", code: code("size: number;") }),
					Member.make({
						role: "method",
						name: "run",
						anchor: "instance-run",
						code: code("run(): Promise<void>;"),
						returns: phrasing("A Promise<T> when done"),
					}),
				],
			}),
		]);
		expect(out).toContain("## Getters & Setters\n\n");
		expect(out).toContain('memberName={"size"} id={"size"} />\n\n');
		expect(out).toContain(
			'memberName={"run"} id={"instance-run"} hasParameters={false} />\n\n**Returns:** A Promise`<T>` when done\n\n',
		);
	});

	it("spells interface signature members with their fixed literal names", () => {
		const out = emit("interface", [
			MemberGroup.make({
				title: "Call Signatures",
				members: [
					Member.make({
						role: "call-signature",
						name: "Call Signature",
						anchor: "call-signature",
						code: code("(x: number): void;"),
					}),
				],
			}),
		]);
		expect(out).toContain('memberName="Call Signature" id={"call-signature"} />');
	});
});

describe("emitMdxBody — base class, examples, see also, member index", () => {
	it("renders the base class section", () => {
		const out = emit("class", [
			BaseClass.make({
				className: "Person",
				baseName: "Person_base",
				packageName: "example",
				code: code("declare const Person_base: X;"),
			}),
		]);
		expect(out).toBe(
			`${CLASS_IMPORTS}## Base Class\n\n\`Person\` extends \`Person_base\`, a compiler-generated declaration that is not exported from \`example\`.\n\n<ApiSignature code={"declare const Person_base: X;"} source={"declare const Person_base: X;"} apiScope={"api"} />\n\n`,
		);
	});

	it("renders type-checked examples as ApiExample and others as plain fences", () => {
		const out = emit("class", [
			ExampleGroup.make({
				items: [
					Example.make({
						language: "typescript",
						code: code("const a = 1;", "// @noErrors\nconst a = 1;"),
						typeChecked: true,
					}),
					Example.make({ language: "bash", code: code("npm install foo"), typeChecked: false }),
				],
			}),
		]);
		expect(out).toBe(
			`${CLASS_IMPORTS}## Examples\n\n<ApiExample code={"const a = 1;"} source={"// @noErrors\\nconst a = 1;"} apiScope={"api"} />\n\n\`\`\`bash\nnpm install foo\n\`\`\`\n\n`,
		);
	});

	it("renders see-also as a list with escaped generics", () => {
		const out = emit("class", [
			SeeAlso.make({ references: [phrasing("[Bar](/api/class/bar) for Bar<T>"), phrasing("plain")] }),
		]);
		expect(out).toBe(`${CLASS_IMPORTS}## See Also\n\n- [Bar](/api/class/bar) for Bar\`<T>\`\n- plain\n\n`);
	});

	it("renders the member index with restored link text and an escaped summary", () => {
		const out = emit("namespace", [
			MemberIndex.make({
				title: "Functions",
				entries: [
					MemberIndexEntry.make({
						name: "get_value",
						route: "/api/function/ns.get_value",
						summary: phrasing("Reads a Map<K, V>"),
					}),
					MemberIndexEntry.make({ name: "plain", route: "/api/function/ns.plain" }),
				],
			}),
		]);
		expect(out).toContain(
			"## Functions\n\n- [get_value](/api/function/ns.get_value) - Reads a Map`<K, V>`\n- [plain](/api/function/ns.plain)\n\n",
		);
	});
});

describe("escapeMdxGenerics", () => {
	it("wraps generic parameter lists in backticks outside code spans", () => {
		expect(escapeMdxGenerics("Returns Promise<T>")).toBe("Returns Promise`<T>`");
		expect(escapeMdxGenerics("Map<K, V> extends...")).toBe("Map`<K, V>` extends...");
		expect(escapeMdxGenerics("Foo<T extends Bar>")).toBe("Foo`<T extends Bar>`");
	});

	it("leaves code spans and non-generic angle brackets alone", () => {
		expect(escapeMdxGenerics("`Pipeline<I, O>`")).toBe("`Pipeline<I, O>`");
		expect(escapeMdxGenerics("a < b and <div>")).toBe("a < b and <div>");
	});
});

describe("escapeMdxGenerics — bounded backtracking", () => {
	it("finishes in linear time on an unclosed generic list (CodeQL ReDoS finding)", () => {
		// `[^>]+` in the extends clause used to share `,` with the parameter
		// separator, so this shape backtracked exponentially in the repeat count.
		const pathological = `<A${",A extends X".repeat(60)}`;
		const started = performance.now();
		expect(escapeMdxGenerics(pathological)).toBe(pathological);
		expect(performance.now() - started).toBeLessThan(200);
	});

	it("still wraps constraints that carry no comma", () => {
		expect(escapeMdxGenerics("<T extends A | B>")).toBe("`<T extends A | B>`");
		expect(escapeMdxGenerics("<T extends Foo, U>")).toBe("`<T extends Foo, U>`");
	});
});
