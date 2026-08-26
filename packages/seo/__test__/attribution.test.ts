import { PackageManifest } from "@effected/package-json";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import { attributionFacts } from "../src/Attribution.js";

const decode = (raw: Record<string, unknown>): Promise<PackageManifest> =>
	Effect.runPromise(PackageManifest.decode(raw));

describe("attributionFacts", () => {
	it("reads author, homepage, keywords and a normalized repository url", async () => {
		const manifest = await decode({
			name: "@scope/pkg",
			version: "1.2.3",
			homepage: "https://pkg.test",
			keywords: ["docs", "api"],
			license: "MIT",
			author: "Ada Lovelace <ada@x.test> (https://ada.test)",
			repository: { type: "git", url: "github:owner/repo" },
		});
		const facts = attributionFacts(manifest);
		expect(facts.authorName).toBe("Ada Lovelace");
		expect(facts.authorUrl).toBe("https://ada.test");
		expect(facts.homepage).toBe("https://pkg.test");
		expect(facts.keywords).toEqual(["docs", "api"]);
		expect(facts.repositoryUrl).toBe("https://github.com/owner/repo");
		expect(facts.primaryLicenseId).toBe("MIT");
		expect(facts.licenseIds).toEqual(["MIT"]);
	});

	// FORBIDS building a license URL by concatenation: a LicenseRef has no
	// catalog page, so it must drop out of licenseUrls rather than appear as a
	// fabricated https://spdx.org/licenses/LicenseRef-x.html.
	it("names a url per catalogued license and drops the ones with none", async () => {
		const both = attributionFacts(await decode({ name: "dual", version: "1.0.0", license: "MIT AND Apache-2.0" }));
		expect(both.licenseIds).toEqual(["MIT", "Apache-2.0"]);
		expect(both.licenseUrls).toEqual([
			"https://spdx.org/licenses/MIT.html",
			"https://spdx.org/licenses/Apache-2.0.html",
		]);
		// An AND has no primary, which is exactly why the plural field exists.
		expect(both.primaryLicenseId).toBeUndefined();
		expect(both.licenseUrl).toBeUndefined();

		const ref = attributionFacts(await decode({ name: "ref", version: "1.0.0", license: "LicenseRef-Custom" }));
		expect(ref.licenseIds).toEqual(["LicenseRef-Custom"]);
		expect(ref.licenseUrls).toEqual([]);
	});

	it("returns empty facts for a manifest carrying nothing", async () => {
		const facts = attributionFacts(await decode({ name: "bare", version: "0.0.0" }));
		expect(facts.authorName).toBeUndefined();
		expect(facts.authorUrl).toBeUndefined();
		expect(facts.repositoryUrl).toBeUndefined();
		expect(facts.homepage).toBeUndefined();
		expect(facts.licenseIds).toEqual([]);
		expect(facts.primaryLicenseId).toBeUndefined();
		expect(facts.licenseUrl).toBeUndefined();
		expect(facts.maintainerNames).toEqual([]);
		expect(facts.keywords).toEqual([]);
	});

	it("drops npm's two non-SPDX license spellings rather than emitting them", async () => {
		for (const license of ["UNLICENSED", "SEE LICENSE IN LICENSE.txt"]) {
			const facts = attributionFacts(await decode({ name: "p", version: "1.0.0", license }));
			expect(facts.licenseIds).toEqual([]);
			expect(facts.primaryLicenseId).toBeUndefined();
			expect(facts.licenseUrl).toBeUndefined();
		}
	});

	it("takes the leftmost license of an OR", async () => {
		const facts = attributionFacts(await decode({ name: "p", version: "1.0.0", license: "MIT OR Apache-2.0" }));
		expect(facts.primaryLicenseId).toBe("MIT");
		expect(facts.licenseIds).toEqual(["MIT", "Apache-2.0"]);
	});

	it("has no primary license for an AND, but lists both", async () => {
		// primaryLicense returns none for a conjunction: every term binds at
		// once, so naming one would silently drop a license that legally
		// applies. licensesOf is the pairing, and schema.org's `license`
		// accepts an array — so an AND emits both rather than degrading.
		const facts = attributionFacts(await decode({ name: "p", version: "1.0.0", license: "MIT AND Apache-2.0" }));
		expect(facts.primaryLicenseId).toBeUndefined();
		expect(facts.licenseIds).toEqual(["MIT", "Apache-2.0"]);
	});

	it("lists maintainer names", async () => {
		const facts = attributionFacts(
			await decode({
				name: "p",
				version: "1.0.0",
				maintainers: ["Grace Hopper <grace@x.test>", { name: "Alan Turing" }],
			}),
		);
		expect(facts.maintainerNames).toEqual(["Grace Hopper", "Alan Turing"]);
	});

	it("resolves the spdx reference page for a catalog license", async () => {
		const facts = attributionFacts(await decode({ name: "p", version: "1.0.0", license: "Apache-2.0" }));
		expect(facts.licenseUrl).toBe("https://spdx.org/licenses/Apache-2.0.html");
	});

	it("keeps a deprecated identifier, page and all", async () => {
		const facts = attributionFacts(await decode({ name: "p", version: "1.0.0", license: "GPL-3.0" }));
		expect(facts.licenseIds).toEqual(["GPL-3.0"]);
		expect(facts.primaryLicenseId).toBe("GPL-3.0");
		expect(facts.licenseUrl).toBe("https://spdx.org/licenses/GPL-3.0.html");
	});

	it("names a LicenseRef but gives it no reference page", async () => {
		// A LicenseRef names a license living in the consuming document, not on
		// spdx.org, so `License.referenceUrl` is none. Templating the URL from
		// the id would hand a crawler a confidently broken link.
		const facts = attributionFacts(await decode({ name: "p", version: "1.0.0", license: "LicenseRef-Acme" }));
		expect(facts.licenseIds).toEqual(["LicenseRef-Acme"]);
		expect(facts.primaryLicenseId).toBe("LicenseRef-Acme");
		expect(facts.licenseUrl).toBeUndefined();
	});

	it("names the license of a WITH exception expression", async () => {
		const facts = attributionFacts(
			await decode({ name: "p", version: "1.0.0", license: "GPL-2.0-only WITH Classpath-exception-2.0" }),
		);
		expect(facts.primaryLicenseId).toBe("GPL-2.0-only");
		expect(facts.licenseIds).toEqual(["GPL-2.0-only"]);
	});

	it("distinguishes two monorepo members of one repository", async () => {
		// browseUrl ignores `directory`, so both siblings would report the
		// repository root — the very field a crawler uses to tell them apart.
		const seo = attributionFacts(
			await decode({
				name: "@scope/seo",
				version: "1.0.0",
				repository: { type: "git", url: "github:owner/repo", directory: "packages/seo" },
			}),
		);
		const model = attributionFacts(
			await decode({
				name: "@scope/model",
				version: "1.0.0",
				repository: { type: "git", url: "github:owner/repo", directory: "packages/model" },
			}),
		);
		expect(seo.repositoryUrl).toBe("https://github.com/owner/repo/tree/HEAD/packages/seo");
		expect(model.repositoryUrl).toBe("https://github.com/owner/repo/tree/HEAD/packages/model");
		expect(seo.repositoryUrl).not.toBe(model.repositoryUrl);
	});

	it("falls back to the repository root when the host's subdirectory convention is unknown", async () => {
		// directoryUrl is none for a self-hosted forge rather than fabricating a
		// path. The root is a *true* location for the package — less precise,
		// not wrong — and beats omitting codeRepository entirely.
		const facts = attributionFacts(
			await decode({
				name: "p",
				version: "1.0.0",
				repository: { url: "https://git.example.com/o/r.git", directory: "packages/x" },
			}),
		);
		expect(facts.repositoryUrl).toBe("https://git.example.com/o/r");
	});

	it("has no repository url when the reference is not a form the model recognizes", async () => {
		const facts = attributionFacts(
			await decode({ name: "p", version: "1.0.0", repository: { url: "not a repository" } }),
		);
		expect(facts.repositoryUrl).toBeUndefined();
	});

	it("reads the structured author object as well as the shorthand", async () => {
		const facts = attributionFacts(
			await decode({
				name: "p",
				version: "1.0.0",
				author: { name: "Ada Lovelace", email: "ada@x.test" },
			}),
		);
		expect(facts.authorName).toBe("Ada Lovelace");
		expect(facts.authorUrl).toBeUndefined();
	});
});
