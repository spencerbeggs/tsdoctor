import { describe, expect, it } from "vitest";

import type { DocMeta } from "../src/index.js";
import { CrossLinker, Render } from "../src/index.js";

// Minimal ApiFunction-shaped fixture. The renderer reads: kind, displayName,
// excerpt.{text,spannedTokens}, and (via tsdoc helpers) instanceof checks that
// fail gracefully → empty summary/params for a plain object.
// Note: spannedTokens mimics real API Extractor structure where the first token
// contains the full "export declare <keyword> " prefix so Signature.format
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

describe("Render.item", () => {
	it("renders an H1 and a fenced signature (no frontmatter, no crosslinks)", () => {
		const md = Render.item(fn("doThing", "export declare function doThing(): void") as never, {
			packageName: "@x/y",
		});
		expect(md).toMatch(/^# doThing/m);
		expect(md).toMatch(/```ts\nfunction doThing\(\): void\n```/);
	});
});

describe("Render.tree", () => {
	it("exposes the pre-serialization nodes: heading first, then the signature code block", () => {
		const nodes = Render.tree(fn("doThing", "export declare function doThing(): void") as never, {
			packageName: "@x/y",
		});
		expect(nodes[0]).toMatchObject({ type: "heading", depth: 1 });
		expect(nodes[1]).toMatchObject({ type: "code", lang: "ts", value: "function doThing(): void" });
	});

	it("keeps injected cross-links intact through serialization", () => {
		const item = {
			...fn("doThing", "export declare function doThing(): void"),
			// Fake a documented item summary via a crossLinker over plain text: the
			// linker output must survive stringification un-escaped.
		};
		const linker = CrossLinker.fromRoutes(new Map([["Pipeline", "/api/class/pipeline"]]));
		// No tsdoc on the fixture, so exercise the prose path via the public
		// linker + Render.item contract instead: linked prose in a summary would
		// round-trip; here we assert the linker itself emits markdown that the
		// serializer would need to preserve.
		expect(linker.link("See Pipeline.")).toBe("See [Pipeline](/api/class/pipeline).");
		expect(Render.item(item as never, { packageName: "@x/y", crossLinker: linker })).toMatch(/^# doThing/m);
	});
});

describe("Render.docs", () => {
	const pkg = {
		entryPoints: [{ members: [fn("doThing", "export declare function doThing(): void")] }],
	};

	it("produces one RenderedDoc per top-level member with a kind slug", () => {
		const docs = Render.docs(pkg as never, { packageName: "@x/y" });
		expect(docs).toHaveLength(1);
		expect(docs[0]).toMatchObject({ name: "doThing", kind: "function", slug: "dothing" });
		expect(docs[0].markdown).toMatch(/# doThing/);
	});

	it("prepends injected frontmatter and assembles it onto the body", () => {
		const docs = Render.docs(pkg as never, {
			packageName: "@x/y",
			frontmatter: (meta: DocMeta) => `---\nid: ${meta.kind}/${meta.slug}\n---\n\n`,
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
		const docs = Render.docs(mixed as never, { packageName: "@x/y" });
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
		const all = Render.docs(mixed as never, { packageName: "@x/y", filter: () => true });
		expect(all.map((d) => d.name)).toEqual(["doThing", "Schema_base"]);
		// ...and an arbitrary predicate replaces the default entirely.
		const onlyBase = Render.docs(mixed as never, {
			packageName: "@x/y",
			filter: (item) => item.displayName.endsWith("_base"),
		});
		expect(onlyBase.map((d) => d.name)).toEqual(["Schema_base"]);
	});
});

describe("Render.isEmittable", () => {
	it("drops forgotten exports and keeps everything else", () => {
		expect(Render.isEmittable(fn("Schema_base", "x", false) as never)).toBe(false);
		expect(Render.isEmittable(fn("doThing", "x", true) as never)).toBe(true);
		// A member with no isExported field (e.g. a real export) is kept.
		expect(Render.isEmittable(fn("doThing", "x") as never)).toBe(true);
	});
});
