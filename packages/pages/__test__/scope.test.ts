import { describe, expect, it } from "vitest";
import { apiScopeOf, normalizeBaseRoute, unscopedName } from "../src/Scope.js";

describe("unscopedName", () => {
	it("strips scope from scoped packages", () => {
		expect(unscopedName("@spencerbeggs/foobar")).toBe("foobar");
	});
	it("returns unscoped names as-is", () => {
		expect(unscopedName("foobar")).toBe("foobar");
	});
});

describe("normalizeBaseRoute", () => {
	it("adds leading slash", () => {
		expect(normalizeBaseRoute("foobar")).toBe("/foobar");
	});
	it("strips trailing slash", () => {
		expect(normalizeBaseRoute("/foobar/")).toBe("/foobar");
	});
	it("preserves clean routes", () => {
		expect(normalizeBaseRoute("/foobar")).toBe("/foobar");
	});
	it("preserves root route", () => {
		expect(normalizeBaseRoute("/")).toBe("/");
	});
	it("handles empty string input", () => {
		expect(normalizeBaseRoute("")).toBe("/");
	});
});

describe("apiScopeOf", () => {
	// Load-bearing and previously duplicated in two files, each carrying a
	// comment asserting they must agree with nothing enforcing it. Divergence
	// is SILENT: config resolution registers a scope's Twoslash environment
	// under this key and the build program looks it up by the same key, so a
	// mismatch means every lookup misses, getTransformer falls back to the
	// build-wide environment, and per-scope type-checking quietly stops
	// happening with no error and no visible change in the output.
	it.each([
		["/example-module", "pkg", "example-module"],
		["/example-module/api", "pkg", "example-module"],
		["/", "kitchensink", "kitchensink"],
		["", "kitchensink", "kitchensink"],
		["/scope/nested/deep", "pkg", "scope"],
	])("derives %j -> %j", (baseRoute, packageName, expected) => {
		expect(apiScopeOf(baseRoute, packageName)).toBe(expected);
	});

	it("agrees with the scope the build program would compute for a derived route", () => {
		// The two former copies both ran on a route that had already been through
		// normalizeBaseRoute, so the pin exercises the same composition.
		for (const [raw, pkg] of [
			["example-module", "pkg"],
			["/", "kitchensink"],
			["/a/b", "pkg"],
		] as const) {
			const normalized = normalizeBaseRoute(raw);
			expect(apiScopeOf(normalized, pkg)).toBe(normalized.replace(/^\//, "").split("/")[0] || pkg);
		}
	});
});
