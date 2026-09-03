import { Code, Heading, InlineCode, Link, Paragraph, Text } from "@effected/markdown";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
	AvailableFrom,
	BaseClass,
	Block,
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
} from "../src/Blocks.js";

const inline = [
	Text.make({ value: "Builds a " }),
	Link.make({ url: "/api/class/pipeline", children: [Text.make({ value: "Pipeline" })] }),
	Text.make({ value: " from " }),
	InlineCode.make({ value: "Config<T>" }),
];

const code = CodeText.make({
	display: "class Foo {}",
	source: 'import type { X } from "y";\n// ---cut---\nclass Foo {}',
});

/**
 * One instance of every variant, so the round-trip below covers the whole
 * closed vocabulary rather than the members someone remembered to list.
 */
const oneOfEach: ReadonlyArray<Block> = [
	Title.make({ name: "Foo", releaseTag: "Beta", deprecation: inline }),
	AvailableFrom.make({ packageName: "@scope/pkg", entryPoints: ["default", "testing"] }),
	ProseBlock.make({
		role: "summary",
		content: [Paragraph.make({ children: inline }), Heading.make({ depth: 3, children: [Text.make({ value: "h" })] })],
	}),
	SourceLink.make({ href: "https://example.test/src/foo.ts#L1" }),
	Signature.make({ code, hasParameters: true }),
	BaseClass.make({ className: "Foo", baseName: "Foo_base", packageName: "@scope/pkg", code }),
	MemberGroup.make({
		title: "Methods",
		members: [
			Member.make({
				role: "method",
				name: "run",
				anchor: "instance-run",
				code,
				summary: inline,
				parameters: [ParameterRow.make({ name: "input", type: "string", description: inline })],
				returns: inline,
			}),
			Member.make({ role: "constructor", name: "constructor", anchor: "constructor", code }),
		],
	}),
	ParameterTable.make({ rows: [ParameterRow.make({ name: "a", type: "number", description: [] })] }),
	EnumMemberTable.make({
		rows: [
			EnumMemberRow.make({ name: "A", value: '"a"', description: inline }),
			EnumMemberRow.make({ name: "B", description: [] }),
		],
	}),
	ExampleGroup.make({
		items: [
			Example.make({ language: "typescript", code, typeChecked: true }),
			Example.make({ language: "bash", code: CodeText.make({ display: "ls", source: "ls" }), typeChecked: false }),
		],
	}),
	SeeAlso.make({ references: [inline, [Text.make({ value: "plain" })]] }),
	MemberIndex.make({
		title: "Classes",
		entries: [MemberIndexEntry.make({ name: "Inner", route: "/api/class/ns.inner", summary: inline })],
	}),
];

describe("Block union", () => {
	it("covers every variant exactly once", () => {
		const kinds = oneOfEach.map((b) => b.kind);
		expect(new Set(kinds).size).toBe(kinds.length);
		expect(kinds.length).toBe(Block.members.length);
	});

	it.each(oneOfEach.map((b) => [b.kind, b] as const))("round-trips %s through encode/decode", (_kind, block) => {
		const encoded = Schema.encodeSync(Block)(block);
		expect(encoded).not.toBeInstanceOf(Title);
		expect(JSON.parse(JSON.stringify(encoded))).toEqual(encoded);
		const decoded = Schema.decodeUnknownSync(Block)(encoded);
		expect(decoded.constructor).toBe(block.constructor);
		expect(decoded).toEqual(block);
		expect(Schema.encodeSync(Block)(decoded)).toEqual(encoded);
	});

	it("decodes mdast prose back into kit node classes", () => {
		const encoded = Schema.encodeSync(Block)(oneOfEach[2]);
		const decoded = Schema.decodeUnknownSync(Block)(encoded);
		if (decoded.kind !== "prose") throw new Error("expected prose");
		expect(decoded.content[0]).toBeInstanceOf(Paragraph);
		expect((decoded.content[0] as Paragraph).children[1]).toBeInstanceOf(Link);
	});

	it("narrows on kind without ceremony", () => {
		const block: Block = Signature.make({ code });
		if (block.kind === "signature") {
			expect(block.code.display).toBe("class Foo {}");
		} else {
			throw new Error("narrowing failed");
		}
	});

	it("rejects a mismatched discriminant", () => {
		const encoded = Schema.encodeSync(Block)(SourceLink.make({ href: "x" }));
		expect(() => Schema.decodeUnknownSync(Block)({ ...encoded, kind: "signature" })).toThrow();
	});

	it("keeps an absent optional key absent rather than undefined", () => {
		const encoded = Schema.encodeSync(Block)(Signature.make({ code }));
		expect("hasParameters" in encoded).toBe(false);
	});

	it("carries a code fence through prose unchanged", () => {
		const block = ProseBlock.make({ role: "remarks", content: [Code.make({ lang: "ts", value: "const x = 1;" })] });
		const decoded = Schema.decodeUnknownSync(Block)(Schema.encodeSync(Block)(block));
		expect(decoded).toEqual(block);
	});
});
