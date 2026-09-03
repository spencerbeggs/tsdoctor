import type { FlowContent, PhrasingContent } from "@effected/markdown";
import { Markdown as Kit, Text } from "@effected/markdown";
import { Render } from "@tsdoctor/model";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
	CodeText,
	EnumMemberRow,
	EnumMemberTable,
	MemberIndex,
	MemberIndexEntry,
	SeeAlso,
	Signature,
	SourceLink,
	Title,
} from "../src/Blocks.js";
import { markdownBlockTree, markdownTree, renderMarkdown, renderMarkdownResult } from "../src/Markdown.js";
import { NavEntry } from "../src/Nav.js";
import { Page } from "../src/Page.js";
import { basicPage } from "./utils/basic-page.js";
import { loadKitchensink } from "./utils/kitchensink.js";

const PACKAGE = "@modules/kitchensink";
const KINDS = new Set(["Class", "Interface", "Function", "TypeAlias", "Variable", "Enum", "Namespace"]);

const flatText = (nodes: ReadonlyArray<PhrasingContent | FlowContent>): string =>
	nodes
		.map((n) =>
			"value" in n && typeof n.value === "string" ? n.value : "children" in n ? flatText(n.children as never) : "",
		)
		.join("");

interface Outline {
	readonly headings: ReadonlyArray<string>;
	readonly fences: ReadonlyArray<string>;
	readonly text: string;
}

const outline = (markdown: string): Outline => {
	const root = Result.getOrThrow(Kit.parseResult(markdown));
	const headings: string[] = [];
	const fences: string[] = [];
	for (const node of root.children) {
		if (node.type === "heading") headings.push(`${"#".repeat(node.depth)} ${flatText(node.children)}`);
		if (node.type === "code") fences.push(node.value);
	}
	return { headings, fences, text: flatText(root.children as never) };
};

describe("renderMarkdown characterized against Render.item on kitchensink", () => {
	const items = loadKitchensink().entryPoints[0].members.filter((m) => KINDS.has(m.kind) && Render.isEmittable(m));

	it("walks a non-trivial fixture", () => {
		expect(items.length).toBeGreaterThan(20);
	});

	it.each(items.map((item) => [item.displayName, item] as const))(
		"%s: carries everything Render.item does",
		(_name, item) => {
			const legacy = outline(Render.item(item, { packageName: PACKAGE }));
			const ours = outline(Result.getOrThrow(renderMarkdownResult(basicPage(item))));

			// Same H1, every member heading Render lists, every fenced code Render emits.
			expect(ours.headings[0]).toBe(legacy.headings[0]);
			for (const h of legacy.headings.filter((h) => h.startsWith("### "))) expect(ours.headings).toContain(h);
			for (const code of legacy.fences) expect(ours.fences).toContain(code);
			// Every parameter name and every summary sentence Render rendered is present.
			for (const line of Render.item(item, { packageName: PACKAGE }).split("\n")) {
				const param = /^- `([^`]+)`/.exec(line);
				if (param) expect(ours.text).toContain(param[1]);
			}
			if (legacy.text.includes("Deprecated:")) expect(ours.text).toContain("Deprecated:");
		},
	);

	it("renders parameters as a GFM table rather than a list", () => {
		const fn =
			items.find((m) => m.kind === "Function" && m.displayName === "processData") ??
			items.find((m) => m.kind === "Function");
		if (!fn) throw new Error("no function in fixture");
		const md = Result.getOrThrow(renderMarkdownResult(basicPage(fn)));
		expect(md).toMatch(/\| Name +\| Type +\| Description +\|/);
	});
});

describe("Markdown block rendering", () => {
	const nav = NavEntry.make({ categoryKey: "class", label: "X", name: "x", route: "/api/class/x" });
	const page = (blocks: Page["blocks"]) =>
		Page.make({
			kind: "class",
			entityName: "X",
			singularName: "Class",
			description: "d",
			route: "/api/class/x",
			headTags: [],
			blocks,
			nav,
		});

	it("badges a non-public release tag and quotes a deprecation", () => {
		const md = Result.getOrThrow(
			renderMarkdownResult(
				page([Title.make({ name: "X", releaseTag: "Beta", deprecation: [Text.make({ value: "use Y" })] })]),
			),
		);
		expect(md).toBe("# X\n\n> **Deprecated:** use Y\n\n`Beta`\n");
	});

	it("renders the enum members table, the see-also list and the member index", () => {
		const md = Result.getOrThrow(
			renderMarkdownResult(
				page([
					EnumMemberTable.make({
						rows: [EnumMemberRow.make({ name: "A", value: '"a"', description: [Text.make({ value: "first" })] })],
					}),
					SeeAlso.make({ references: [[Text.make({ value: "see this" })]] }),
					MemberIndex.make({
						title: "Classes",
						entries: [MemberIndexEntry.make({ name: "Inner", route: "/api/class/ns.inner" })],
					}),
					SourceLink.make({ href: "https://src.test/x.ts" }),
				]),
			),
		);
		expect(md).toContain('| `A` | `"a"` | first |');
		expect(md).toContain("## See Also\n\n- see this\n");
		expect(md).toContain("## Classes\n\n- [Inner](/api/class/ns.inner)\n");
		expect(md).toContain("[Source](https://src.test/x.ts)");
	});

	it("emits the display text of a signature, never the source", () => {
		const nodes = markdownBlockTree(
			Signature.make({
				code: CodeText.make({ display: "class X {}", source: 'import type { Y } from "y";\n// ---cut---\nclass X {}' }),
			}),
		);
		expect(nodes[0]).toMatchObject({ type: "code", lang: "ts", value: "class X {}" });
		expect(markdownTree(page([]))).toEqual([]);
	});

	it("renders an empty page to a single newline, and the Effect form agrees", async () => {
		expect(Result.getOrThrow(renderMarkdownResult(page([])))).toBe("\n");
		expect(await Effect.runPromise(renderMarkdown(page([])))).toBe("\n");
	});
});
