/**
 * Characterization snapshots for every page generator.
 *
 * These exist to freeze the generators' current MDX output before the adapter
 * refactor moves them (Chunk 2 extracts a dispatch table; phase 5 extracts
 * `@tsdoctor/pages`). A snapshot diff during those moves means the refactor
 * changed rendered output, which it must not.
 *
 * Each case pins something a later chunk touches:
 * - the static/instance prefix rule that Task 1.1 relocates into
 *   `prepareWorkItems`
 * - the member anchor spelling that Task 1.1 changes
 * - the synthetic-base section anchored at `SyntheticBases.BASE_CLASS_ANCHOR`
 * - the "Available from" line for multi-entry items
 *
 * Imported from `@effect/vitest` rather than `vitest` so this workspace stops
 * being the only one off the shared runner. Nothing here is Effect-shaped —
 * the generators return plain Promises — so `it.effect` is deliberately not
 * used; wrapping a Promise in an Effect purely to satisfy a convention would
 * be ceremony, not discipline.
 */

import path from "node:path";
import { beforeEach, describe, expect, it } from "@effect/vitest";
import type {
	ApiClass,
	ApiEnum,
	ApiFunction,
	ApiInterface,
	ApiItem,
	ApiNamespace,
	ApiTypeAlias,
	ApiVariable,
} from "@microsoft/api-extractor-model";
import { ApiModel } from "@microsoft/api-extractor-model";
import { parseFrontmatter } from "../../../src/frontmatter.js";
import { ClassPageGenerator } from "../../../src/markdown/page-generators/class-page.js";
import { EnumPageGenerator } from "../../../src/markdown/page-generators/enum-page.js";
import { FunctionPageGenerator } from "../../../src/markdown/page-generators/function-page.js";
import { MainIndexPageGenerator } from "../../../src/markdown/page-generators/index-pages.js";
import { InterfacePageGenerator } from "../../../src/markdown/page-generators/interface-page.js";
import { NamespacePageGenerator } from "../../../src/markdown/page-generators/namespace-page.js";
import { TypeAliasPageGenerator } from "../../../src/markdown/page-generators/type-alias-page.js";
import { VariablePageGenerator } from "../../../src/markdown/page-generators/variable-page.js";
import { clearProseLinker } from "../../../src/markdown/prose-linker.js";

const fixturesDir = path.join(import.meta.dirname, "..", "..", "__fixtures__");

function loadMembers(fixture: string, file: string): readonly ApiItem[] {
	const model = new ApiModel();
	const pkg = model.loadPackage(path.join(fixturesDir, fixture, file));
	const entryPoint = pkg.entryPoints[0];
	if (!entryPoint) throw new Error(`fixture ${fixture} has no entry point`);
	return entryPoint.members;
}

const kitchensink = loadMembers("kitchensink", "kitchensink.api.json");
const syntheticBase = loadMembers("synthetic-base", "synthetic-base.api.json");
const anchorCollision = loadMembers("anchor-collision", "anchor-collision.api.json");

function find<T extends ApiItem>(members: readonly ApiItem[], name: string, kind: string): T {
	const item = members.find((m) => m.displayName === name && m.kind === kind);
	if (!item) throw new Error(`fixture has no ${kind} named ${name}`);
	return item as T;
}

// The prose linker is module-level state shared across generators. Reset it so
// these snapshots record generator output, not whatever a previous test
// installed. (That the linker is module-level at all is a known adapter
// finding; it is forced by generators running outside any fiber.)
beforeEach(() => {
	clearProseLinker();
});

describe("page generator output (characterization)", () => {
	it("ClassPageGenerator renders a class with members", async () => {
		const result = await new ClassPageGenerator().generate(
			find<ApiClass>(kitchensink, "Pipeline", "Class"),
			"/api",
			"kitchensink",
			"Class",
			"kitchensink",
		);
		expect(result.routePath).toBe("/api/class/pipeline");
		expect(result.content).toMatchSnapshot();
	});

	it("ClassPageGenerator renders static/instance name collisions with disambiguating ids", async () => {
		const result = await new ClassPageGenerator().generate(
			find<ApiClass>(anchorCollision, "Registry", "Class"),
			"/api",
			"anchors",
			"Class",
			"anchors",
		);
		expect(result.content).toMatchSnapshot();
	});

	it("ClassPageGenerator renders an inline Base Class section for a synthetic base", async () => {
		const person = find<ApiClass>(syntheticBase, "Person", "Class");
		const base = syntheticBase.find((m) => m.displayName === "Person_base");
		if (!base) throw new Error("fixture has no Person_base");
		const result = await new ClassPageGenerator().generate(
			person,
			"/api",
			"example",
			"Class",
			"example",
			undefined,
			undefined,
			true,
			undefined,
			undefined,
			base,
		);
		expect(result.content).toMatchSnapshot();
	});

	it("InterfacePageGenerator renders an interface", async () => {
		const result = await new InterfacePageGenerator().generate(
			find<ApiInterface>(kitchensink, "PipelineOptions", "Interface"),
			"/api",
			"kitchensink",
			"Interface",
			"kitchensink",
		);
		expect(result.routePath).toBe("/api/interface/pipelineoptions");
		expect(result.content).toMatchSnapshot();
	});

	it("NamespacePageGenerator renders a namespace", async () => {
		const result = await new NamespacePageGenerator().generate(
			find<ApiNamespace>(kitchensink, "Codecs", "Namespace"),
			"/api",
			"kitchensink",
			"Namespace",
			"kitchensink",
		);
		expect(result.content).toMatchSnapshot();
	});

	it("EnumPageGenerator renders an enum", async () => {
		const result = await new EnumPageGenerator().generate(
			find<ApiEnum>(kitchensink, "DataFormat", "Enum"),
			"/api",
			"kitchensink",
			"Enum",
			"kitchensink",
		);
		expect(result.content).toMatchSnapshot();
	});

	it("FunctionPageGenerator renders a function", async () => {
		const result = await new FunctionPageGenerator().generate(
			find<ApiFunction>(kitchensink, "createPipeline", "Function"),
			"/api",
			"kitchensink",
			"Function",
			"kitchensink",
		);
		expect(result.content).toMatchSnapshot();
	});

	it("VariablePageGenerator renders a variable", async () => {
		const result = await new VariablePageGenerator().generate(
			find<ApiVariable>(kitchensink, "VERSION", "Variable"),
			"/api",
			"kitchensink",
			"Variable",
			"kitchensink",
		);
		expect(result.content).toMatchSnapshot();
	});

	it("TypeAliasPageGenerator renders a type alias", async () => {
		const result = await new TypeAliasPageGenerator().generate(
			find<ApiTypeAlias>(kitchensink, "Middleware", "TypeAlias"),
			"/api",
			"kitchensink",
			"TypeAlias",
			"kitchensink",
		);
		expect(result.content).toMatchSnapshot();
	});
});

describe("multi-entry rendering", () => {
	it('renders an "Available from" line when an item is exported from several entry points', async () => {
		const result = await new FunctionPageGenerator().generate(
			find<ApiFunction>(kitchensink, "createPipeline", "Function"),
			"/api",
			"kitchensink",
			"Function",
			"kitchensink",
			undefined,
			undefined,
			true,
			undefined,
			["default", "testing"],
		);
		expect(result.content).toContain("Available from:");
		expect(result.content).toContain("`kitchensink`");
		expect(result.content).toContain("`kitchensink/testing`");
		expect(result.content).toMatchSnapshot();
	});

	it('renders no "Available from" line for a single-entry item', async () => {
		const result = await new FunctionPageGenerator().generate(
			find<ApiFunction>(kitchensink, "createPipeline", "Function"),
			"/api",
			"kitchensink",
			"Function",
			"kitchensink",
			undefined,
			undefined,
			true,
			undefined,
			["default"],
		);
		expect(result.content).not.toContain("Available from:");
	});
});

describe("MainIndexPageGenerator", () => {
	it("renders the index frontmatter for a plain package name", () => {
		const result = new MainIndexPageGenerator().generate("kitchensink", "/api", {});
		expect(result.routePath).toBe("/api/index");
		expect(result.content).toMatchSnapshot();
	});

	// The hand-rolled escaper quoted any string CONTAINING a YAML indicator
	// character. The real emitter quotes only where YAML requires it — `@` is
	// reserved at the start of a scalar, not inside one. Asserting a specific
	// spelling would pin the old over-quoting, so these assert the property
	// that matters: what the frontmatter parses back to.
	it.each(["@scope/pkg", "plain-pkg", "weird: colon", "- leading dash", "@leading"])(
		"round-trips a package name through frontmatter: %j",
		(packageName) => {
			const { content } = new MainIndexPageGenerator().generate(packageName, "/api", {});
			const { data } = parseFrontmatter(content);
			expect(data.description).toBe(`Auto-generated API documentation for ${packageName}`);
			expect(data.title).toBe("API Reference");
			expect(data.overview).toBe(true);
		},
	);

	it("quotes only when YAML requires it", () => {
		// A colon-space inside the value forces quoting; a mid-string `@` does not.
		expect(new MainIndexPageGenerator().generate("weird: colon", "/api", {}).content).toMatch(/description: ['"]/);
		expect(new MainIndexPageGenerator().generate("@scope/pkg", "/api", {}).content).toContain(
			"description: Auto-generated API documentation for @scope/pkg",
		);
	});

	it("renders the scoped-package index", () => {
		expect(new MainIndexPageGenerator().generate("@scope/pkg", "/api", {}).content).toMatchSnapshot();
	});
});
