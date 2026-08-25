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

describe("sanitizeId divergence matrix", () => {
	// These five inputs are the ones that made the adapter's second sanitizer
	// disagree with this one. Measured against both implementations before
	// Task 1.1 removed the duplicate; the "was" column is what the adapter's
	// page-side helper produced.
	it.each([
		{ input: "get_value", anchor: "get-value", adapterWas: "get_value" },
		{ input: "MY_CONST", anchor: "my-const", adapterWas: "my_const" },
		{ input: "foo$bar", anchor: "foobar", adapterWas: "foo-bar" },
		{ input: "a.b", anchor: "ab", adapterWas: "a-b" },
		{ input: "toJSON", anchor: "tojson", adapterWas: "tojson" },
	])("$input sanitizes to $anchor", ({ input, anchor }) => {
		expect(Routes.sanitizeId(input)).toBe(anchor);
	});

	it("prefixes with a hyphen", () => {
		expect(Routes.sanitizeId("create", "static")).toBe("static-create");
	});
});

describe("memberAnchors", () => {
	const ref = (id: string, displayName: string, slot: Routes.MemberSlot): Routes.MemberRef => ({
		id,
		displayName,
		slot,
	});

	it("leaves a non-colliding member unprefixed", () => {
		const anchors = Routes.memberAnchors([ref("a", "get_value", "instance-method")]);
		expect(anchors.get("a")).toBe("get-value");
	});

	it("gives both halves of a static/instance collision DISTINCT anchors", () => {
		const anchors = Routes.memberAnchors([
			ref("static", "create", "static-method"),
			ref("instance", "create", "instance-method"),
		]);
		// Static keeps the bare anchor, matching the bare cross-link key.
		expect(anchors.get("static")).toBe("create");
		expect(anchors.get("instance")).toBe("instance-create");
		// The defect this replaces: both used to resolve to one anchor.
		expect(anchors.get("instance")).not.toBe(anchors.get("static"));
	});

	it("prefixes a static property colliding with an instance method", () => {
		const anchors = Routes.memberAnchors([
			ref("sp", "flush", "static-property"),
			ref("im", "flush", "instance-method"),
		]);
		expect(anchors.get("sp")).toBe("flush");
		expect(anchors.get("im")).toBe("instance-flush");
	});

	it("prefixes an instance property colliding with an instance method", () => {
		const anchors = Routes.memberAnchors([
			ref("ip", "value", "instance-property"),
			ref("im", "value", "instance-method"),
		]);
		// Both are instance slots, so the method leads and the property is
		// displaced — the prefix marks the non-canonical side either way.
		expect(anchors.get("im")).toBe("value");
		expect(anchors.get("ip")).toBe("instance-value");
	});

	it("never emits the same anchor twice for one class", () => {
		const anchors = Routes.memberAnchors([
			ref("1", "create", "static-method"),
			ref("2", "create", "instance-method"),
			ref("3", "flush", "static-property"),
			ref("4", "flush", "instance-method"),
			ref("5", "get_value", "instance-method"),
			ref("6", "MY_CONST", "static-property"),
			ref("7", "toJSON", "instance-method"),
		]);
		const values = [...anchors.values()];
		expect(new Set(values).size).toBe(values.length);
	});
});

describe("memberRouteKeys", () => {
	const ref = (id: string, displayName: string, slot: Routes.MemberSlot): Routes.MemberRef => ({
		id,
		displayName,
		slot,
	});

	it("emits only the bare key when nothing collides", () => {
		const keys = Routes.memberRouteKeys("Registry", [ref("m", "create", "instance-method")]);
		expect([...keys.keys()]).toEqual(["Registry.create"]);
		expect(keys.get("Registry.create")).toBe("m");
	});

	it("resolves the bare key to the STATIC member on a collision", () => {
		const keys = Routes.memberRouteKeys("Registry", [
			ref("i", "create", "instance-method"),
			ref("s", "create", "static-method"),
		]);
		// `Registry.create` is the static access expression; the instance one
		// is `registry.create`.
		expect(keys.get("Registry.create")).toBe("s");
	});

	it("emits selector and prototype keys on a collision", () => {
		const keys = Routes.memberRouteKeys("Registry", [
			ref("i", "create", "instance-method"),
			ref("s", "create", "static-method"),
		]);
		expect(keys.get("Registry.(create:static)")).toBe("s");
		expect(keys.get("Registry.(create:instance)")).toBe("i");
		expect(keys.get("Registry.prototype.create")).toBe("i");
	});

	it("never emits the JSDoc hash form", () => {
		const keys = Routes.memberRouteKeys("Registry", [
			ref("i", "create", "instance-method"),
			ref("s", "create", "static-method"),
		]);
		// `#` is the URL fragment delimiter, and in modern TypeScript it means
		// a private field.
		expect([...keys.keys()].filter((k) => k.includes("#"))).toEqual([]);
	});

	it("does not emit selector keys for non-colliding members of a colliding class", () => {
		const keys = Routes.memberRouteKeys("Registry", [
			ref("i", "create", "instance-method"),
			ref("s", "create", "static-method"),
			ref("q", "quiet", "instance-method"),
		]);
		expect([...keys.keys()].filter((k) => k.includes("quiet"))).toEqual(["Registry.quiet"]);
	});
});
