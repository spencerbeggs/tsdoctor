/**
 * The `ApiItem` → `Page` builders, characterized against the generators
 * they were lifted from: block order per kind, the member grouping, the
 * anchors as data, the display/source split, the Prettier fallback and the
 * facts a page carries. The byte-level oracle is the RSPress golden gate;
 * these pin the IR's SHAPE so a later emitter cannot be fed something the
 * generators never produced.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiClass, ApiInterface, ApiItem, ApiPackage } from "@microsoft/api-extractor-model";
import { ApiModel } from "@microsoft/api-extractor-model";
import { ApiItems, CrossLinker } from "@tsdoctor/model";
import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";

import type { Block } from "../src/Blocks.js";
import type { BuildPageInput } from "../src/Build.js";
import { INDEX_PAGE_TITLE, NO_DESCRIPTION, buildIndexPage, buildPage, isPageKind } from "../src/Build.js";
import { ExampleFormatError } from "../src/Examples.js";
import type { Page } from "../src/Page.js";
import { loadKitchensink } from "./utils/kitchensink.js";

const here = dirname(fileURLToPath(import.meta.url));
const loadFixture = (name: string): ApiPackage =>
	new ApiModel().loadPackage(join(here, "fixtures", `${name}.api.json`));

const members = (pkg: ApiPackage): readonly ApiItem[] => pkg.entryPoints[0]?.members ?? [];
const find = <T extends ApiItem>(pkg: ApiPackage, name: string, kind: string): T => {
	const item = members(pkg).find((m) => m.displayName === name && m.kind === kind);
	if (!item) throw new Error(`fixture has no ${kind} named ${name}`);
	return item as T;
};

const kinds = (page: Page): ReadonlyArray<Block["kind"]> => page.blocks.map((block) => block.kind);
const block = <K extends Block["kind"]>(page: Page, kind: K): Extract<Block, { kind: K }> => {
	const found = page.blocks.find((b): b is Extract<Block, { kind: K }> => b.kind === kind);
	if (!found) throw new Error(`page has no ${kind} block`);
	return found;
};

const baseInput = (item: ApiItem, folderName: string, singularName: string): BuildPageInput => ({
	item,
	categoryKey: `${folderName}s`,
	singularName,
	folderName,
	baseRoute: "/api",
	packageName: "@modules/kitchensink",
	linker: CrossLinker.empty,
});

const build = (input: BuildPageInput): Promise<Page> =>
	Effect.runPromise(buildPage(input)).then((page) => {
		if (Option.isNone(page)) throw new Error("buildPage produced no page");
		return page.value;
	});

describe("buildPage — page facts", () => {
	it("carries the title parts, description, route and nav entry", async () => {
		const pkg = loadKitchensink();
		const page = await build({ ...baseInput(find(pkg, "Pipeline", "Class"), "class", "Class"), apiName: "Kitchen" });
		expect(page.kind).toBe("class");
		expect(page.title).toBe("Pipeline | Class | API | Kitchen");
		expect(page.route).toBe("/api/class/pipeline");
		expect(page.description).not.toBe(NO_DESCRIPTION);
		expect(page.nav).toMatchObject({
			categoryKey: "classs",
			label: "Pipeline",
			name: "pipeline",
			route: "/api/class/pipeline",
		});
		expect(page.headTags).toEqual([]);
	});

	it("routes a namespace member by its qualified name and labels the nav entry with it", async () => {
		const pkg = loadKitchensink();
		const codecs = find<ApiItem>(pkg, "Codecs", "Namespace");
		const json = codecs.members.find((m) => m.displayName === "json");
		if (!json) throw new Error("Codecs has no json member");
		const page = await build({
			...baseInput(json, "function", "Function"),
			namespaceMember: { qualifiedName: "Codecs.json" },
		});
		expect(page.route).toBe("/api/function/codecs.json");
		expect(page.nav.label).toBe("Codecs.json");
		expect(page.nav.name).toBe("codecs.json");
		// The title still names the bare symbol.
		expect(page.entityName).toBe("json");
	});

	it("uses the configured folder for the route, not the item kind", async () => {
		const pkg = loadKitchensink();
		const page = await build(baseInput(find(pkg, "Pipeline", "Class"), "classes-folder", "Class"));
		expect(page.route).toBe("/api/classes-folder/pipeline");
	});

	it("returns none for an item kind that gets no page", async () => {
		const pkg = loadKitchensink();
		const pipeline = find<ApiClass>(pkg, "Pipeline", "Class");
		const ctor = pipeline.members.find((m) => m.kind === "Constructor");
		if (!ctor) throw new Error("Pipeline has no constructor");
		expect(isPageKind(ctor.kind)).toBe(false);
		expect(Option.isNone(await Effect.runPromise(buildPage(baseInput(ctor, "class", "Class"))))).toBe(true);
	});
});

describe("buildPage — block layout per kind", () => {
	it("class: title, summary, signature, member groups in the generators' order, examples, see also", async () => {
		const pkg = loadKitchensink();
		const page = await build(baseInput(find(pkg, "Pipeline", "Class"), "class", "Class"));
		expect(kinds(page).slice(0, 3)).toEqual(["title", "prose", "signature"]);
		const groups = page.blocks.filter((b) => b.kind === "member-group").map((b) => b.title);
		expect(groups).toEqual(["Constructors", "Static Methods", "Properties", "Methods"]);
		expect(kinds(page).at(-1)).toBe("see-also");
		expect(kinds(page)).toContain("examples");
	});

	it("class skeleton lists constructors, statics, instance members with four-space indentation", async () => {
		const pkg = loadKitchensink();
		const page = await build(baseInput(find(pkg, "Pipeline", "Class"), "class", "Class"));
		const signature = block(page, "signature");
		const lines = signature.code.display.split("\n");
		expect(lines[0]).toMatch(/^class Pipeline/);
		expect(lines[1]).toMatch(/^ {4}constructor\(/);
		expect(lines.at(-1)).toBe("}");
		expect(signature.hasParameters).toBeUndefined();
		expect(signature.hasMembers).toBeUndefined();
	});

	it("interface: call signatures lead, then properties and methods", async () => {
		const pkg = loadKitchensink();
		const iface = members(pkg).find(
			(m): m is ApiInterface => m.kind === "Interface" && m.members.some((x) => x.kind === "CallSignature"),
		);
		if (!iface) throw new Error("kitchensink has no callable interface");
		const page = await build(baseInput(iface, "interface", "Interface"));
		const groups = page.blocks.filter((b) => b.kind === "member-group");
		expect(groups[0]?.title).toBe("Call Signatures");
		expect(groups[0]?.members[0]).toMatchObject({
			role: "call-signature",
			name: "Call Signature",
			anchor: "call-signature",
		});
	});

	it("function: signature carries hasParameters, then the parameter table, then the returns prose", async () => {
		const pkg = loadKitchensink();
		const fn = members(pkg).find((m) => m.kind === "Function" && ApiItems.sourceLink(m) === null);
		if (!fn) throw new Error("kitchensink has no function");
		const page = await build(baseInput(fn, "function", "Function"));
		const signature = block(page, "signature");
		expect(typeof signature.hasParameters).toBe("boolean");
		if (signature.hasParameters) {
			expect(kinds(page)).toContain("parameters");
			const table = block(page, "parameters");
			expect(table.rows[0]?.name).toBeTruthy();
		}
	});

	it("enum: signature has hasMembers and the members table carries initializer values", async () => {
		const pkg = loadKitchensink();
		const page = await build(baseInput(find(pkg, "DataFormat", "Enum"), "enum", "Enum"));
		const signature = block(page, "signature");
		expect(signature.hasMembers).toBe(true);
		expect(signature.code.display).toContain('    JSON = "json",');
		const table = block(page, "enum-members");
		expect(table.rows[0]).toMatchObject({ name: "JSON", value: '"json"' });
		expect(kinds(page).indexOf("enum-members")).toBe(kinds(page).indexOf("signature") + 1);
	});

	it("namespace: abbreviated skeleton and a member index per kind, routed into the default folders", async () => {
		const pkg = loadKitchensink();
		const page = await build(baseInput(find(pkg, "Codecs", "Namespace"), "namespace", "Namespace"));
		expect(block(page, "signature").code.display.split("\n")[0]).toBe("namespace Codecs {");
		const index = block(page, "member-index");
		expect(index.title).toBe("Functions");
		expect(index.entries.map((e) => e.route)).toContain("/api/function/codecs.json");
	});

	it("type alias and variable: title, summary, signature only", async () => {
		const pkg = loadKitchensink();
		const alias = members(pkg).find((m) => m.kind === "TypeAlias");
		const variable = members(pkg).find((m) => m.kind === "Variable");
		if (!alias || !variable) throw new Error("kitchensink lacks a type alias or variable");
		for (const [item, folder, singular] of [
			[alias, "type", "Type"],
			[variable, "variable", "Variable"],
		] as const) {
			const page = await build(baseInput(item, folder, singular));
			expect(kinds(page).slice(0, 3)).toEqual(["title", "prose", "signature"]);
			expect(kinds(page).filter((k) => k === "member-group" || k === "parameters")).toEqual([]);
		}
	});
});

describe("buildPage — members", () => {
	it("carries the anchor from the work item's map, never recomputing it", async () => {
		const pkg = loadFixture("anchor-collision");
		const registry = find<ApiClass>(pkg, "Registry", "Class");
		const anchors = ApiItems.memberAnchors(registry);
		const page = await build({ ...baseInput(registry, "class", "Class"), memberAnchors: anchors });
		const emitted = page.blocks.flatMap((b) => (b.kind === "member-group" ? b.members.map((m) => m.anchor) : []));
		expect(emitted).toContain("create");
		expect(emitted).toContain("instance-create");
		expect(emitted).toContain("get-value");
		// A poisoned map proves the page reads the map rather than its own algorithm.
		const poisoned = new Map([...anchors].map(([k, v]) => [k, `x-${v}`]));
		const poisonedPage = await build({ ...baseInput(registry, "class", "Class"), memberAnchors: poisoned });
		const poisonedAnchors = poisonedPage.blocks.flatMap((b) =>
			b.kind === "member-group" ? b.members.filter((m) => m.role !== "constructor").map((m) => m.anchor) : [],
		);
		expect(poisonedAnchors.every((a) => a.startsWith("x-"))).toBe(true);
	});

	it("splits display (the bare member signature) from source (the class context with hidden imports)", async () => {
		const pkg = loadKitchensink();
		const page = await build(baseInput(find(pkg, "Pipeline", "Class"), "class", "Class"));
		const ctor = block(page, "member-group").members[0];
		if (!ctor) throw new Error("no constructor member");
		expect(ctor.role).toBe("constructor");
		expect(ctor.name).toBe("constructor");
		expect(ctor.anchor).toBe("constructor");
		expect(ctor.code.display).toMatch(/^constructor\(/);
		expect(ctor.code.source).toMatch(/class Pipeline[^\n]*\{\nconstructor\(.*\n\}$/s);
		expect(ctor.parameters?.length ?? 0).toBeGreaterThan(0);
	});

	it("cross-links member prose with the supplied linker", async () => {
		const pkg = loadKitchensink();
		const linker = CrossLinker.fromRoutes(new Map([["DataSource", "/api/interface/datasource"]]));
		const page = await build({ ...baseInput(find(pkg, "Pipeline", "Class"), "class", "Class"), linker });
		const linked = page.blocks.some(
			(b) =>
				b.kind === "member-group" &&
				b.members.some((m) =>
					JSON.stringify([m.summary, m.parameters, m.returns]).includes("/api/interface/datasource"),
				),
		);
		expect(linked).toBe(true);
	});
});

describe("buildPage — synthetic base, available-from, source link", () => {
	it("inlines the synthetic base after the signature", async () => {
		const pkg = loadFixture("synthetic-base");
		const person = find<ApiClass>(pkg, "Person", "Class");
		const base = find<ApiItem>(pkg, "Person_base", "Variable");
		const page = await build({ ...baseInput(person, "class", "Class"), packageName: "example", syntheticBase: base });
		const ks = kinds(page);
		expect(ks.indexOf("base-class")).toBe(ks.indexOf("signature") + 1);
		expect(block(page, "base-class")).toMatchObject({
			className: "Person",
			baseName: "Person_base",
			packageName: "example",
		});
		expect(block(page, "base-class").code.display).toContain("Person_base: Schema.Class<Person");
	});

	it("emits an available-from block only for more than one entry point", async () => {
		const pkg = loadKitchensink();
		const item = find(pkg, "Pipeline", "Class");
		const one = await build({ ...baseInput(item, "class", "Class"), availableFrom: ["default"] });
		expect(kinds(one)).not.toContain("available-from");
		const two = await build({ ...baseInput(item, "class", "Class"), availableFrom: ["default", "testing"] });
		expect(block(two, "available-from")).toMatchObject({
			packageName: "@modules/kitchensink",
			entryPoints: ["default", "testing"],
		});
	});

	it("emits a source link only when a source target resolves", async () => {
		const pkg = loadKitchensink();
		const item = find(pkg, "Pipeline", "Class");
		const without = await build(baseInput(item, "class", "Class"));
		expect(kinds(without)).not.toContain("source-link");
		const withSource = await build({
			...baseInput(item, "class", "Class"),
			source: { url: "https://example.test/repo" },
		});
		const expected = ApiItems.sourceLink(item, { url: "https://example.test/repo" });
		if (expected) expect(block(withSource, "source-link").href).toBe(expected);
		else expect(kinds(withSource)).not.toContain("source-link");
	});
});

describe("buildPage — examples", () => {
	it("type-checks TypeScript examples with the package import and @noErrors, splitting display from source", async () => {
		const pkg = loadKitchensink();
		const page = await build(baseInput(find(pkg, "Pipeline", "Class"), "class", "Class"));
		const examples = block(page, "examples");
		const first = examples.items[0];
		if (!first) throw new Error("no example");
		expect(first.typeChecked).toBe(true);
		expect(first.language).toBe("typescript");
		expect(first.code.source).toMatch(/^\/\/ @noErrors\n/);
		expect(first.code.display).not.toContain("@noErrors");
	});

	it("falls back to the unformatted code and reports when Prettier cannot format", async () => {
		const pkg = loadKitchensink();
		const item = find(pkg, "Pipeline", "Class");
		const seen: ExampleFormatError[] = [];
		// Poison Prettier's input by handing it a package name it must format around: the
		// fixture examples are valid TypeScript, so exercise the hook with a malformed item instead.
		const malformed = Object.create(item, {
			tsdocComment: {
				value: {
					summarySection: (item as { tsdocComment?: { summarySection?: unknown } }).tsdocComment?.summarySection,
					customBlocks: [
						{
							blockTag: { tagNameWithUpperCase: "@EXAMPLE" },
							content: { nodes: [{ kind: "FencedCode", language: "ts", code: "const = ;" }] },
						},
					],
				},
			},
		}) as ApiItem;
		const page = await build({
			...baseInput(malformed, "class", "Class"),
			onExampleFormatError: (error) => Effect.sync(() => void seen.push(error)),
		});
		expect(seen).toHaveLength(1);
		expect(seen[0]).toBeInstanceOf(ExampleFormatError);
		const example = block(page, "examples").items[0];
		expect(example?.code.source).toContain("const = ;");
	});
});

describe("buildIndexPage", () => {
	it("builds the landing page facts", () => {
		const index = buildIndexPage({ packageName: "@modules/kitchensink", baseRoute: "/api" });
		expect(index).toMatchObject({
			route: "/api/index",
			title: INDEX_PAGE_TITLE,
			description: "Auto-generated API documentation for @modules/kitchensink",
		});
	});
});
