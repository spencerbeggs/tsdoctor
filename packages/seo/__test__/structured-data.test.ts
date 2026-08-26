import { PackageManifest } from "@effected/package-json";
import { Conformance } from "@effected/schema-org/validate";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { attributionFacts } from "../src/Attribution.js";
import type { PackageNodeInput, PageNodeInput } from "../src/StructuredData.js";
import { derive, deriveScriptBody, packageContext } from "../src/StructuredData.js";

const decode = (raw: Record<string, unknown>): Promise<PackageManifest> =>
	Effect.runPromise(PackageManifest.decode(raw));

const pkgInput = async (
	raw: Record<string, unknown>,
	overrides: Partial<PackageNodeInput> = {},
): Promise<PackageNodeInput> => {
	const manifest = await decode(raw);
	return {
		siteUrl: "https://docs.test",
		baseRoute: "/pkg/api",
		packageName: String(raw.name),
		...(manifest.version != null ? { version: manifest.version.toString() } : {}),
		...(manifest.description != null ? { description: manifest.description } : {}),
		attribution: attributionFacts(manifest),
		...overrides,
	};
};

const PAGE: PageNodeInput = {
	pageRoute: "/pkg/api/class/pipeline",
	symbolName: "Pipeline",
	description: "A composable processing pipeline.",
	section: "Classes",
	publishedTime: "2026-01-15T12:00:00.000Z",
	modifiedTime: "2026-02-01T09:30:00.000Z",
};

/** Every fixture the conformance gate runs over. */
const FIXTURES: ReadonlyArray<readonly [string, Record<string, unknown>]> = [
	[
		"a fully populated manifest",
		{
			name: "@scope/pkg",
			version: "1.2.3",
			description: "Does the thing.",
			homepage: "https://pkg.test",
			keywords: ["docs", "api"],
			license: "MIT",
			author: "Ada Lovelace <ada@x.test> (https://ada.test)",
			maintainers: [{ name: "Grace Hopper" }],
			repository: { type: "git", url: "github:owner/repo", directory: "packages/pkg" },
		},
	],
	["a bare manifest", { name: "bare", version: "0.0.0" }],
	["a dual-licensed manifest", { name: "dual", version: "2.0.0", license: "MIT AND Apache-2.0" }],
	["a non-SPDX license", { name: "closed", version: "1.0.0", license: "UNLICENSED" }],
	[
		"an author who is also a maintainer",
		{
			name: "dup",
			version: "1.0.0",
			author: { name: "Ada Lovelace" },
			maintainers: [{ name: "Ada Lovelace" }],
		},
	],
];

describe("StructuredData conformance", () => {
	// The CI gate the roadmap's "validates against schema.org tooling" promise
	// resolves to: offline, over the vendored vocabulary, on every fixture.
	// `check` is total, so an empty array is the whole assertion.
	for (const [label, raw] of FIXTURES) {
		it(`emits a conformant graph for ${label}`, async () => {
			const graph = Result.getOrThrow(derive(packageContext(await pkgInput(raw)), PAGE));
			expect(Conformance.check(graph)).toEqual([]);
		});
	}

	it("stays conformant with a root-relative site url", async () => {
		const pkg = packageContext(await pkgInput(FIXTURES[0][1], { siteUrl: "" }));
		const graph = Result.getOrThrow(derive(pkg, PAGE));
		expect(Conformance.check(graph)).toEqual([]);
	});

	// The default posture reports an unknown term without failing; a closed-world
	// caller asks for strict. Both must pass on our own graphs.
	it("passes strict validation, where an invented term would fail", async () => {
		const graph = Result.getOrThrow(derive(packageContext(await pkgInput(FIXTURES[0][1])), PAGE));
		expect(Result.isSuccess(Conformance.validateResult(graph, { unknownTerms: "fail" }))).toBe(true);
	});
});

describe("packageContext", () => {
	it("credits the author and every maintainer as distinct person nodes", async () => {
		const pkg = packageContext(await pkgInput(FIXTURES[0][1]));
		const names = pkg.nodes.filter((n) => n["@type"] === "Person").map((n) => n.name);
		expect(names).toEqual(["Ada Lovelace", "Grace Hopper"]);
	});

	it("does not credit the same person twice when author and maintainer coincide", async () => {
		const pkg = packageContext(await pkgInput(FIXTURES[4][1]));
		const people = pkg.nodes.filter((n) => n["@type"] === "Person");
		expect(people).toHaveLength(1);
	});

	it("prefers the package's own subdirectory url over the repository root", async () => {
		const pkg = packageContext(await pkgInput(FIXTURES[0][1]));
		const source = pkg.nodes.find((n) => n["@type"] === "SoftwareSourceCode");
		expect(source?.codeRepository).toBe("https://github.com/owner/repo/tree/HEAD/packages/pkg");
	});

	it("carries version on `version`, never on `softwareVersion`", async () => {
		const pkg = packageContext(await pkgInput(FIXTURES[0][1]));
		const source = pkg.nodes.find((n) => n["@type"] === "SoftwareSourceCode");
		expect(source?.version).toBe("1.2.3");
		expect(source).not.toHaveProperty("softwareVersion");
	});

	it("omits license rather than fabricating a url for a non-SPDX spelling", async () => {
		const pkg = packageContext(await pkgInput(FIXTURES[3][1]));
		const source = pkg.nodes.find((n) => n["@type"] === "SoftwareSourceCode");
		expect(source?.license).toBeUndefined();
	});

	// FORBIDS reading only the primary license: an AND expression has none, so
	// a dual-licensed package would silently emit no `license` at all.
	it("names every license of an AND expression, which has no primary", async () => {
		const pkg = packageContext(await pkgInput(FIXTURES[2][1]));
		const source = pkg.nodes.find((n) => n["@type"] === "SoftwareSourceCode");
		expect(source?.license).toEqual([
			"https://spdx.org/licenses/MIT.html",
			"https://spdx.org/licenses/Apache-2.0.html",
		]);
	});

	it("is derived once and reused, so two pages share one package id", async () => {
		const pkg = packageContext(await pkgInput(FIXTURES[0][1]));
		const a = Result.getOrThrow(derive(pkg, PAGE));
		const b = Result.getOrThrow(derive(pkg, { ...PAGE, pageRoute: "/pkg/api/class/other", symbolName: "Other" }));
		for (const graph of [a, b]) {
			const article = graph["@graph"].find((n) => n["@type"] === "TechArticle");
			expect(article?.isPartOf?.[0]?.["@id"]).toBe("https://docs.test/pkg/api#source");
		}
	});
});

describe("derive", () => {
	it("links the article to the package and to the symbol it documents", async () => {
		const graph = Result.getOrThrow(derive(packageContext(await pkgInput(FIXTURES[0][1])), PAGE));
		const article = graph["@graph"].find((n) => n["@type"] === "TechArticle");
		const symbol = graph["@graph"].find((n) => n["@type"] === "APIReference");

		expect(article?.mainEntity?.["@id"]).toBe(symbol?.["@id"]);
		expect(article?.isPartOf?.[0]?.["@id"]).toBe("https://docs.test/pkg/api#source");
		expect(symbol?.isPartOf?.[0]?.["@id"]).toBe("https://docs.test/pkg/api#source");
		expect(article?.["@id"]).not.toBe(symbol?.["@id"]);
	});

	it("carries the page's own timestamps, not the package's", async () => {
		const graph = Result.getOrThrow(derive(packageContext(await pkgInput(FIXTURES[0][1])), PAGE));
		const article = graph["@graph"].find((n) => n["@type"] === "TechArticle");
		expect(article?.datePublished).toBe("2026-01-15T12:00:00.000Z");
		expect(article?.dateModified).toBe("2026-02-01T09:30:00.000Z");
	});

	it("fails typed rather than throwing when an id is malformed", async () => {
		// Whitespace is what `NodeRef.isValidId` rejects. The page route is the one
		// caller-supplied component of a page id, so this is the reachable path.
		const result = derive(packageContext(await pkgInput(FIXTURES[0][1])), {
			...PAGE,
			pageRoute: "/pkg/api/class/bad name",
		});
		expect(Result.isFailure(result)).toBe(true);
		if (Result.isFailure(result)) expect(result.failure._tag).toBe("InvalidNodeIdError");
	});
});

describe("deriveScriptBody", () => {
	it("is idempotent under the adapter re-escaping it", async () => {
		const pkg = packageContext(
			await pkgInput({ ...FIXTURES[0][1], description: "A </script> and a <!-- comment -->." }),
		);
		const body = Result.getOrThrow(deriveScriptBody(pkg, PAGE));
		// The property underneath the guarantee: none of the three characters
		// the escape matches survives in the output, so a second pass is a no-op.
		expect(body).not.toMatch(/[<>&]/);
	});

	it("parses back as JSON carrying a @context and a @graph", async () => {
		const body = Result.getOrThrow(deriveScriptBody(packageContext(await pkgInput(FIXTURES[0][1])), PAGE));
		const parsed = JSON.parse(body) as Record<string, unknown>;
		expect(parsed["@context"]).toBe("https://schema.org");
		expect(Array.isArray(parsed["@graph"])).toBe(true);
	});

	it("propagates the identity failure rather than returning a partial body", async () => {
		const result = deriveScriptBody(packageContext(await pkgInput(FIXTURES[0][1])), {
			...PAGE,
			pageRoute: "/bad route",
		});
		expect(Result.isFailure(result)).toBe(true);
	});
});
