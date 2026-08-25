/**
 * The member-anchor invariant.
 *
 * Every route in `crossLinkData.routes` that carries a `#fragment` promises
 * that the generated page emits an element with the matching `id=`. Nothing
 * asserted that until Chunk 0, which is how two `sanitizeId` implementations
 * were able to drift apart: the page side kept `_` (it is in `\w`) and mapped
 * `$` to `-`, while `Routes.sanitizeId` mapped `_` to `-` and deleted `$`, so
 * `get_value` was linked as `#get-value` and rendered as `id="get_value"`.
 *
 * Task 1.1 made `Routes` the single algorithm and moved anchor computation
 * into `prepareWorkItems`, which hands the result to BOTH the route map and
 * the page generator. These tests are what hold that together.
 */

import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import type { ApiClass } from "@microsoft/api-extractor-model";
import { ApiModel } from "@microsoft/api-extractor-model";
import { prepareWorkItems } from "../../src/build-stages.js";
import { ClassPageGenerator } from "../../src/markdown/index.js";
import { DEFAULT_CATEGORIES } from "../../src/schemas/config.js";

const fixture = path.join(import.meta.dirname, "..", "__fixtures__", "anchor-collision", "anchor-collision.api.json");

function loadRegistry(): { apiPackage: ReturnType<ApiModel["loadPackage"]>; registry: ApiClass } {
	const model = new ApiModel();
	const apiPackage = model.loadPackage(fixture);
	const entryPoint = apiPackage.entryPoints[0];
	if (!entryPoint) throw new Error("fixture has no entry point");
	const registry = entryPoint.members.find((m) => m.displayName === "Registry" && m.kind === "Class");
	if (!registry) throw new Error("fixture has no Registry class");
	return { apiPackage, registry: registry as ApiClass };
}

/** Every `id={"..."}` the class page emits. */
function emittedIds(content: string): ReadonlySet<string> {
	return new Set([...content.matchAll(/id=\{"([^"]+)"\}/g)].map((m) => m[1] as string));
}

/** Every `Registry.member -> #anchor` fragment the cross-link route map declares. */
function declaredAnchors(routes: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
	const anchors = new Map<string, string>();
	for (const [name, route] of routes) {
		const hash = route.indexOf("#");
		if (hash !== -1) anchors.set(name, route.slice(hash + 1));
	}
	return anchors;
}

interface Collected {
	readonly ids: ReadonlySet<string>;
	readonly anchors: ReadonlyMap<string, string>;
	readonly content: string;
}

/**
 * Run the real pipeline: `prepareWorkItems` computes the anchors, then the
 * page generator renders with the same map. Passing the map is the contract
 * under test — a caller that drops it gets unprefixed anchors, which is why
 * the collision test below would catch that regression.
 */
async function collect(): Promise<Collected> {
	const { apiPackage, registry } = loadRegistry();
	const { workItems, crossLinkData } = prepareWorkItems({
		apiPackage,
		categories: DEFAULT_CATEGORIES,
		baseRoute: "/api",
		packageName: "anchors",
	});
	const workItem = workItems.find((w) => w.item.displayName === "Registry");
	if (!workItem) throw new Error("prepareWorkItems produced no Registry work item");
	const { content } = await new ClassPageGenerator().generate(
		registry,
		"/api",
		"anchors",
		"Class",
		"anchors",
		undefined,
		undefined,
		true,
		undefined,
		undefined,
		undefined,
		workItem.memberAnchors,
	);
	return { ids: emittedIds(content), anchors: declaredAnchors(crossLinkData.routes), content };
}

describe("member anchor invariant", () => {
	// Landed by Task 1.1. Was `it.fails` while the bug was open; the flip to a
	// plain `it` IS the fix's proof. Both sides now read one anchor map that
	// `prepareWorkItems` computes once.
	it("every declared #anchor route matches an id emitted on the page", async () => {
		const { ids, anchors } = await collect();
		const broken = [...anchors].filter(([, anchor]) => !ids.has(anchor));
		expect(broken).toEqual([]);
	});

	// Replaces the two characterization tests that pinned the defect. Same
	// inputs, asserting the fixed behaviour: the route and the page now agree.
	it("agrees on underscore and collision names that previously diverged", async () => {
		const { ids, anchors } = await collect();

		expect(anchors.get("Registry.get_value")).toBe("get-value");
		expect(ids.has("get-value")).toBe(true);

		expect(anchors.get("Registry.MY_CONST")).toBe("my-const");
		expect(ids.has("my-const")).toBe(true);

		// A name both sanitizers already agreed on, to prove the check discriminates.
		expect(anchors.get("Registry.toJSON")).toBe("tojson");
		expect(ids.has("tojson")).toBe(true);
	});

	it("gives each half of a static/instance collision its own anchor", async () => {
		const { ids } = await collect();

		// The static member keeps the bare anchor, matching the bare route key;
		// the instance member is prefixed.
		expect(ids.has("create")).toBe(true);
		expect(ids.has("instance-create")).toBe(true);
		expect(ids.has("flush")).toBe(true);
		expect(ids.has("instance-flush")).toBe(true);
	});

	it("resolves the bare Class.member key to the static member", async () => {
		const { anchors } = await collect();
		// `Registry.create` is the static access expression in TypeScript; the
		// instance one is `registry.create`.
		// And it resolves to the anchor that member owns — one naming decision.
		expect(anchors.get("Registry.create")).toBe("create");
		expect(anchors.get("Registry.flush")).toBe("flush");
	});

	it("emits TSDoc selector keys pointing at the anchors the page emits", async () => {
		const { ids, anchors } = await collect();

		expect(anchors.get("Registry.(create:instance)")).toBe("instance-create");
		expect(anchors.get("Registry.(create:static)")).toBe("create");
		expect(anchors.get("Registry.prototype.create")).toBe("instance-create");

		// Every selector key resolves to an anchor the page actually rendered.
		for (const key of ["Registry.(create:instance)", "Registry.(create:static)", "Registry.prototype.create"]) {
			const anchor = anchors.get(key);
			expect(anchor).toBeDefined();
			expect(ids.has(anchor as string)).toBe(true);
		}
	});

	it("emits no selector keys for a member that does not collide", async () => {
		const { anchors } = await collect();
		expect([...anchors.keys()].filter((k) => k.includes("get_value") || k.includes("get-value"))).toEqual([
			"Registry.get_value",
		]);
	});

	// Was a characterization test asserting duplicates EXISTED. Now the
	// invariant: one page, no id used twice.
	it("emits no duplicate HTML ids", async () => {
		const { content } = await collect();
		const all = [...content.matchAll(/id=\{"([^"]+)"\}/g)].map((m) => m[1] as string);
		expect(all.filter((id, i) => all.indexOf(id) !== i)).toEqual([]);
	});
});
