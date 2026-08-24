// packages/model/__test__/render.test.ts
import { describe, expect, it } from "vitest";

import { isEmittable, renderItem, renderPackage } from "../src/render.js";

// Minimal ApiFunction-shaped fixture. The renderer reads: kind, displayName,
// excerpt.{text,spannedTokens}, and (via tsdoc helpers) instanceof checks that
// fail gracefully → empty summary/params for a plain object.
// Note: spannedTokens mimics real API Extractor structure where the first token
// contains the full "export declare <keyword> " prefix so TypeSignatureFormatter
// can strip it in one pass.
// `isExported` mirrors ApiExportedMixin: a compiler-synthetic forgotten export
// carries `isExported: false`; a normal export omits it (treated as exported).
const fn = (name: string, sig: string, isExported?: boolean) => ({
	kind: "Function",
	displayName: name,
	excerpt: { text: sig, spannedTokens: [{ text: sig }] },
	members: [],
	...(isExported === undefined ? {} : { isExported }),
});

describe("renderItem", () => {
	it("renders an H1 and a fenced signature (no frontmatter, no crosslinks)", () => {
		const md = renderItem(fn("doThing", "export declare function doThing(): void") as never, {
			packageName: "@x/y",
		});
		expect(md).toMatch(/^# doThing/m);
		expect(md).toMatch(/```ts\nfunction doThing\(\): void\n```/);
	});
});

describe("renderPackage", () => {
	const pkg = {
		entryPoints: [{ members: [fn("doThing", "export declare function doThing(): void")] }],
	};

	it("produces one RenderedDoc per top-level member with a kind slug", () => {
		const docs = renderPackage(pkg as never, { packageName: "@x/y" });
		expect(docs).toHaveLength(1);
		expect(docs[0]).toMatchObject({ name: "doThing", kind: "function", slug: "dothing" });
		expect(docs[0].markdown).toMatch(/# doThing/);
	});

	it("prepends injected frontmatter and assembles it onto the body", () => {
		const docs = renderPackage(pkg as never, {
			packageName: "@x/y",
			frontmatter: (meta) => `---\nid: ${meta.kind}/${meta.slug}\n---\n\n`,
		});
		expect(docs[0].markdown.startsWith("---\nid: function/dothing\n---\n\n# doThing")).toBe(true);
	});

	it("excludes forgotten exports (isExported === false) by default", () => {
		const mixed = {
			entryPoints: [
				{
					members: [
						fn("doThing", "export declare function doThing(): void"),
						fn("Schema_base", "declare function Schema_base(): void", false),
					],
				},
			],
		};
		const docs = renderPackage(mixed as never, { packageName: "@x/y" });
		expect(docs).toHaveLength(1);
		expect(docs.map((d) => d.name)).toEqual(["doThing"]);
	});

	it("lets a custom filter fully replace the default rule", () => {
		const mixed = {
			entryPoints: [
				{
					members: [
						fn("doThing", "export declare function doThing(): void"),
						fn("Schema_base", "declare function Schema_base(): void", false),
					],
				},
			],
		};
		// A pass-through filter re-includes the forgotten export the default would drop...
		const all = renderPackage(mixed as never, { packageName: "@x/y", filter: () => true });
		expect(all.map((d) => d.name)).toEqual(["doThing", "Schema_base"]);
		// ...and an arbitrary predicate replaces the default entirely.
		const onlyBase = renderPackage(mixed as never, {
			packageName: "@x/y",
			filter: (item) => item.displayName.endsWith("_base"),
		});
		expect(onlyBase.map((d) => d.name)).toEqual(["Schema_base"]);
	});
});

describe("isEmittable", () => {
	it("drops forgotten exports and keeps everything else", () => {
		expect(isEmittable(fn("Schema_base", "x", false) as never)).toBe(false);
		expect(isEmittable(fn("doThing", "x", true) as never)).toBe(true);
		// A member with no isExported field (e.g. a real export) is kept.
		expect(isEmittable(fn("doThing", "x") as never)).toBe(true);
	});
});
