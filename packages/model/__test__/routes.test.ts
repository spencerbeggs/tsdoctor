import { describe, expect, it } from "vitest";

import { Routes } from "../src/index.js";

function c(
	over: Partial<ConstructorParameters<typeof Routes.RouteCandidate>[0]> & { id: string },
): Routes.RouteCandidate {
	return new Routes.RouteCandidate({
		displayName: over.id,
		folder: "variable",
		baseName: "foo",
		kind: "Variable",
		canonicalRef: over.id,
		...over,
	});
}

describe("Routes.detectCollisions", () => {
	it("returns no collisions for companion pairs (different folders)", () => {
		const collisions = Routes.detectCollisions([
			c({ id: "Foo::Variable", displayName: "Foo", folder: "variable", baseName: "foo", kind: "Variable" }),
			c({ id: "Foo::TypeAlias", displayName: "Foo", folder: "type", baseName: "foo", kind: "TypeAlias" }),
		]);
		expect(collisions).toEqual([]);
	});

	it("returns no collisions when all routes are unique", () => {
		const collisions = Routes.detectCollisions([
			c({ id: "A", displayName: "A", folder: "class", baseName: "a", kind: "Class" }),
			c({ id: "B", displayName: "B", folder: "class", baseName: "b", kind: "Class" }),
		]);
		expect(collisions).toEqual([]);
	});

	it("detects a case-only clash (same folder + baseName + kind)", () => {
		const collisions = Routes.detectCollisions([
			c({
				id: "Foo::Variable",
				displayName: "Foo",
				folder: "variable",
				baseName: "foo",
				kind: "Variable",
				canonicalRef: "pkg!Foo:var",
			}),
			c({
				id: "foo::Variable",
				displayName: "foo",
				folder: "variable",
				baseName: "foo",
				kind: "Variable",
				canonicalRef: "pkg!foo:var",
			}),
		]);
		expect(collisions).toHaveLength(1);
		expect(collisions[0]?.route).toBe("variable/foo");
		expect(collisions[0]?.items.map((i) => i.displayName).sort()).toEqual(["Foo", "foo"]);
	});

	it("detects a custom merged-category collision (same folder, different kinds)", () => {
		const collisions = Routes.detectCollisions([
			c({
				id: "run::Variable",
				displayName: "run",
				folder: "values",
				baseName: "run",
				kind: "Variable",
				canonicalRef: "pkg!run:var",
			}),
			c({
				id: "run::Function",
				displayName: "run",
				folder: "values",
				baseName: "run",
				kind: "Function",
				canonicalRef: "pkg!run:func",
			}),
		]);
		expect(collisions).toHaveLength(1);
		expect(collisions[0]?.items).toHaveLength(2);
	});

	it("returns multiple independent collisions deterministically", () => {
		const collisions = Routes.detectCollisions([
			c({ id: "b1", displayName: "B", folder: "class", baseName: "b", kind: "Class", canonicalRef: "3" }),
			c({ id: "b2", displayName: "b", folder: "class", baseName: "b", kind: "Class", canonicalRef: "4" }),
			c({ id: "a1", displayName: "A", folder: "type", baseName: "a", kind: "TypeAlias", canonicalRef: "1" }),
			c({ id: "a2", displayName: "a", folder: "type", baseName: "a", kind: "TypeAlias", canonicalRef: "2" }),
		]);
		expect(collisions.map((x) => x.route)).toEqual(["class/b", "type/a"]);
	});
});

describe("Routes.RouteCollisionError", () => {
	it("message includes each item's name, kind, canonicalRef, the shared route, and guidance", () => {
		const error = new Routes.RouteCollisionError({
			baseRoute: "/api",
			collisions: [
				{
					route: "variable/foo",
					items: [
						c({
							id: "Foo::Variable",
							displayName: "Foo",
							folder: "variable",
							baseName: "foo",
							kind: "Variable",
							canonicalRef: "pkg!Foo:var",
						}),
						c({
							id: "foo::Variable",
							displayName: "foo",
							folder: "variable",
							baseName: "foo",
							kind: "Variable",
							canonicalRef: "pkg!foo:var",
						}),
					],
				},
			],
		});
		expect(error._tag).toBe("RouteCollisionError");
		expect(error).toBeInstanceOf(Error);
		expect(error.message).toContain("/api/variable/foo");
		expect(error.message).toContain("Foo (Variable)");
		expect(error.message).toContain("foo (Variable)");
		expect(error.message).toContain("pkg!Foo:var");
		expect(error.message).toMatch(/unique per category folder/i);
		expect(error.message).toMatch(/Route collision/);
	});
});

describe("Routes.sanitizeId", () => {
	it("lowercases and hyphenates spaces and underscores", () => {
		expect(Routes.sanitizeId("My Member_Name")).toBe("my-member-name");
	});

	it("strips special characters and trims hyphens", () => {
		expect(Routes.sanitizeId("_weird$name!")).toBe("weirdname");
	});

	it("prepends the optional prefix", () => {
		expect(Routes.sanitizeId("create", "static")).toBe("static-create");
	});
});
