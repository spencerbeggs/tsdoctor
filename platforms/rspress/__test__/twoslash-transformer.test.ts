import { describe, expect, it } from "vitest";
import { PluginEvent } from "../src/observability/events.js";
import { TwoslashManager, setEventEmitter } from "../src/twoslash-transformer.js";

describe("twoslash error events", () => {
	it("emits TwoslashDiagnostic + TwoslashCheckFailed via the injected emitter", () => {
		const seen: PluginEvent[] = [];
		setEventEmitter((e) => seen.push(e));
		TwoslashManager.getInstance().handleTwoslashErrorForTest(
			new Error("TS2353: Object literal may only specify known properties"),
			"Plugin({ console: {} })",
			"kitchensink/api/class/plugin.md",
		);
		const tags = seen.map((e) => e._tag);
		expect(tags).toContain("TwoslashDiagnostic");
		expect(tags).toContain("TwoslashCheckFailed");

		const diag = seen.find(PluginEvent.$is("TwoslashDiagnostic"));
		expect(diag?.code).toBe(2353); // verifies the /TS(\d+)/ parse

		const failed = seen.find(PluginEvent.$is("TwoslashCheckFailed"));
		expect(Array.isArray(failed?.fsMapKeys)).toBe(true); // snapshot field reaches the payload
	});
});

describe("per-scope Twoslash environments", () => {
	const vfs = new Map([["node_modules/pkg/index.d.ts", "export declare const a: number;"]]);
	const strict = { strict: true, target: "ES2020" } as never;
	const loose = { strict: false, target: "ES2020" } as never;

	function freshManager() {
		TwoslashManager.reset();
		return TwoslashManager.getInstance();
	}

	it("has no transformer before any environment is initialized", () => {
		expect(freshManager().getTransformer("pkg")).toBeNull();
	});

	it("gives a scope the environment built for its own configuration", () => {
		const manager = freshManager();
		manager.initialize(vfs, undefined, undefined, undefined, strict);
		manager.initialize(vfs, undefined, undefined, undefined, loose);
		manager.registerScope("strict-pkg", strict);
		manager.registerScope("loose-pkg", loose);

		const a = manager.getTransformer("strict-pkg");
		const b = manager.getTransformer("loose-pkg");

		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		// Two configurations, two environments — this is the whole point: a package
		// documented under `strict: false` must not be checked under `strict: true`.
		expect(a).not.toBe(b);
	});

	it("shares one environment between scopes that agree on their configuration", () => {
		const manager = freshManager();
		manager.initialize(vfs, undefined, undefined, undefined, strict);
		manager.registerScope("one", strict);
		manager.registerScope("two", strict);

		expect(manager.getTransformer("one")).toBe(manager.getTransformer("two"));
	});

	it("treats configurations differing only in key order as the same environment", () => {
		const manager = freshManager();
		manager.initialize(vfs, undefined, undefined, undefined, { strict: true, target: "ES2020" } as never);
		manager.registerScope("a", { strict: true, target: "ES2020" } as never);
		manager.registerScope("b", { target: "ES2020", strict: true } as never);

		expect(manager.getTransformer("a")).toBe(manager.getTransformer("b"));
	});

	it("falls back to the first environment for a block outside any documented scope", () => {
		const manager = freshManager();
		manager.initialize(vfs, undefined, undefined, undefined, strict);
		manager.initialize(vfs, undefined, undefined, undefined, loose);

		// A `with-api` fence on a page that belongs to no package still gets checked.
		expect(manager.getTransformer(undefined)).toBe(manager.getTransformer("strict-pkg"));
		expect(manager.getTransformer("never-registered")).not.toBeNull();
	});

	it("drops every environment on clear", () => {
		const manager = freshManager();
		manager.initialize(vfs, undefined, undefined, undefined, strict);
		manager.registerScope("pkg", strict);
		manager.clear();

		expect(manager.getTransformer("pkg")).toBeNull();
	});
});
