import { Text } from "@effected/markdown";
import { CodeText, Member, MemberGroup, NavEntry, Page, Title } from "@tsdoctor/pages";
import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { TWOSLASH_META, emitMarkdownBody, markdownBlockTree } from "../src/emit/markdown.js";
import { buildFixturePages } from "./utils/fixtures.js";

const render = (page: Page): string => {
	const result = emitMarkdownBody(page);
	if (Result.isFailure(result)) throw result.failure;
	return result.success;
};

const page = (blocks: Page["blocks"]): Page =>
	Page.make({
		kind: "class",
		entityName: "X",
		singularName: "Class",
		description: "d",
		route: "/api/class/x",
		headTags: [],
		blocks,
		nav: NavEntry.make({ categoryKey: "classes", label: "X", name: "x", route: "/api/class/x" }),
	});

describe("emitMarkdownBody", () => {
	it("spells a member as a custom-anchored heading over a twoslash fence carrying the source", () => {
		const member = Member.make({
			role: "method",
			name: "get_value",
			anchor: "get-value",
			code: CodeText.make({
				display: "get_value(): number;",
				source: 'import type { A } from "b";\n// ---cut---\nget_value(): number;',
			}),
			summary: [Text.make({ value: "Reads it." })],
		});
		const out = render(page([MemberGroup.make({ kind: "member-group", title: "Methods", members: [member] })]));
		// The anchor is the IR's, spelled the way @mdit/plugin-attrs reads it:
		// raw bytes, no `\#`, no `\_` — the kit (0.8.0) serializes a `{#id}`
		// suffix and an intraword `_` unescaped on a non-MDX tree, and nothing
		// here post-processes them.
		expect(out).toContain("### get_value {#get-value}");
		// The fence carries `source` (imports + cut marker intact) under the
		// twoslash trigger, with error rendering off for a declaration excerpt.
		expect(out).toContain(
			`\`\`\`ts ${TWOSLASH_META}\n// @noErrors\nimport type { A } from "b";\n// ---cut---\nget_value(): number;\n\`\`\``,
		);
		expect(out).not.toContain("display");
	});

	it("does not add a second @noErrors when the source already carries one", () => {
		const tree = markdownBlockTree({
			kind: "signature",
			code: CodeText.make({ display: "x", source: "// @noErrors\nx" }),
		} as never);
		const fence = tree[1] as { value: string };
		expect(fence.value.match(/@noErrors/g)).toHaveLength(1);
	});

	it("keeps a non-type-checked example in a plain fence of its own language", async () => {
		const pages = await buildFixturePages("kitchensink");
		let plain = 0;
		let checked = 0;
		for (const p of pages.values()) {
			for (const block of p.blocks) {
				if (block.kind !== "examples") continue;
				for (const item of block.items) {
					if (item.typeChecked) checked += 1;
					else plain += 1;
				}
			}
		}
		// The control: the fixture has type-checked examples, so the assertion
		// below cannot pass vacuously.
		expect(checked).toBeGreaterThan(0);
		for (const p of pages.values()) {
			const out = render(p);
			const fences = out.match(/^```[^\n]*$/gm) ?? [];
			for (const fence of fences) {
				if (fence === "```") continue;
				expect(fence === `\`\`\`ts ${TWOSLASH_META}` || !fence.includes(TWOSLASH_META)).toBe(true);
			}
		}
		void plain;
	});

	it("renders parameter and enum tables as GFM tables from the typed rows", async () => {
		const pages = await buildFixturePages("kitchensink");
		const enumPage = pages.get("PipelineStatus");
		expect(enumPage).toBeDefined();
		const out = render(enumPage as Page);
		expect(out).toContain("| Name | Value | Description |");
		expect(out).toContain("| --- | --- | --- |");
		const fn = pages.get("createPipeline");
		expect(fn).toBeDefined();
		expect(render(fn as Page)).toContain("| Name | Type | Description |");
	});

	it("leaves the release-tag badge off a Public item and an intraword underscore raw", () => {
		const out = render(page([Title.make({ kind: "title", name: "DEFAULT_PIPELINE_OPTIONS", releaseTag: "Public" })]));
		expect(out).toBe("# DEFAULT_PIPELINE_OPTIONS\n");
	});

	it("renders every fixture page without a stringify failure", async () => {
		const pages = await buildFixturePages("kitchensink");
		expect(pages.size).toBeGreaterThan(30);
		for (const [name, p] of pages) {
			const result = emitMarkdownBody(p);
			expect(Result.isSuccess(result), name).toBe(true);
		}
	});

	it("puts the synthetic base class inline under a Base Class heading", async () => {
		const pages = await buildFixturePages("synthetic-base");
		const withBase = [...pages.values()].find((p) => p.blocks.some((b) => b.kind === "base-class"));
		expect(withBase).toBeDefined();
		const out = render(withBase as Page);
		expect(out).toContain("## Base Class\n");
		expect(out).toMatch(
			/a compiler-generated declaration that is not exported from `[^`]+`\.\n\n```ts twoslash\n\/\/ @noErrors\n/,
		);
	});
});
