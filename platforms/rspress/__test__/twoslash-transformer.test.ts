import { decodeCompilerOptions } from "@tsdoctor/vfs";
import { describe, expect, it } from "vitest";
import { PluginEvent } from "../src/observability/events.js";
import { installSyncEmitterUnsafe } from "../src/observability/sync-emitter.js";
import { TwoslashEnvironmentRegistry, addTypeRoutes, clearTypeRoutes } from "../src/twoslash-transformer.js";

describe("twoslash error events", () => {
	it("emits TwoslashDiagnostic + TwoslashCheckFailed via the injected emitter", () => {
		const seen: PluginEvent[] = [];
		installSyncEmitterUnsafe((e) => seen.push(e));
		new TwoslashEnvironmentRegistry().reportErrorForTest(
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

	// A fresh registry per test, by construction. The old shape needed a static
	// `TwoslashManager.reset()` here because the instance was a process-wide
	// singleton; now isolation is what `new` already means.
	function freshManager() {
		return new TwoslashEnvironmentRegistry();
	}

	it("has no transformer before any environment is initialized", () => {
		expect(freshManager().transformerFor("pkg")).toBeNull();
	});

	it("gives a scope the environment built for its own configuration", () => {
		const manager = freshManager();
		manager.registerEnvironment({ vfs, compilerOptions: strict });
		manager.registerEnvironment({ vfs, compilerOptions: loose });
		manager.registerScope("strict-pkg", strict);
		manager.registerScope("loose-pkg", loose);

		const a = manager.transformerFor("strict-pkg");
		const b = manager.transformerFor("loose-pkg");

		expect(a).not.toBeNull();
		expect(b).not.toBeNull();
		// Two configurations, two environments — this is the whole point: a package
		// documented under `strict: false` must not be checked under `strict: true`.
		expect(a).not.toBe(b);
	});

	it("shares one environment between scopes that agree on their configuration", () => {
		const manager = freshManager();
		manager.registerEnvironment({ vfs, compilerOptions: strict });
		manager.registerScope("one", strict);
		manager.registerScope("two", strict);

		expect(manager.transformerFor("one")).toBe(manager.transformerFor("two"));
	});

	it("treats configurations differing only in key order as the same environment", () => {
		const manager = freshManager();
		manager.registerEnvironment({ vfs, compilerOptions: { strict: true, target: "ES2020" } as never });
		manager.registerScope("a", { strict: true, target: "ES2020" } as never);
		manager.registerScope("b", { target: "ES2020", strict: true } as never);

		expect(manager.transformerFor("a")).toBe(manager.transformerFor("b"));
	});

	it("falls back to the first environment for a block outside any documented scope", () => {
		const manager = freshManager();
		manager.registerEnvironment({ vfs, compilerOptions: strict });
		manager.registerEnvironment({ vfs, compilerOptions: loose });

		// A `with-api` fence on a page that belongs to no package still gets checked.
		expect(manager.transformerFor(undefined)).toBe(manager.transformerFor("strict-pkg"));
		expect(manager.transformerFor("never-registered")).not.toBeNull();
	});

	it("drops every environment on clear", () => {
		const manager = freshManager();
		manager.registerEnvironment({ vfs, compilerOptions: strict });
		manager.registerScope("pkg", strict);
		manager.clear();

		expect(manager.transformerFor("pkg")).toBeNull();
	});
});

describe("environment deduplication across compiler-option spellings", () => {
	it("builds ONE environment for two APIs writing the same config differently", () => {
		const manager = new TwoslashEnvironmentRegistry();
		const vfs = new Map<string, string>([["node_modules/x/index.d.ts", "export declare const x: number;"]]);

		// The same configuration in the two spellings a user may write it: the
		// short tsconfig form, and the lib file-name form. They must end up in ONE
		// environment — two would be a silent cache regression costing a full
		// extra type-check pass per multi-API site.
		//
		// The convergence now happens at DECODE rather than at fingerprint time:
		// `decodeCompilerOptions` normalizes both to the canonical spelling, so
		// this asserts the property end to end, through the door a user's options
		// actually come in by.
		const decode = (input: Record<string, unknown>) => {
			const result = decodeCompilerOptions(input);
			if (result._tag === "Failure") throw new Error(String(result.failure));
			return result.success;
		};
		const tsconfigSpelling = decode({ target: "ESNext", lib: ["ESNext", "DOM"] });
		const fileNameSpelling = decode({ target: 99, lib: ["lib.esnext.d.ts", "lib.dom.d.ts"] });

		manager.registerEnvironment({ vfs, compilerOptions: tsconfigSpelling });
		manager.registerScope("alpha", tsconfigSpelling);
		manager.registerEnvironment({ vfs, compilerOptions: fileNameSpelling });
		manager.registerScope("beta", fileNameSpelling);

		const alpha = manager.transformerFor("alpha");
		const beta = manager.transformerFor("beta");
		expect(alpha).not.toBeNull();
		expect(beta).toBe(alpha);
	});

	it("still builds separate environments for genuinely different configs", () => {
		const manager = new TwoslashEnvironmentRegistry();
		const vfs = new Map<string, string>();

		manager.registerEnvironment({ vfs, compilerOptions: { target: "esnext" as const, strict: false } });
		manager.registerScope("lenient", { target: "esnext" as const, strict: false });
		manager.registerEnvironment({ vfs, compilerOptions: { target: "esnext" as const, strict: true } });
		manager.registerScope("strict", { target: "esnext" as const, strict: true });

		expect(manager.transformerFor("strict")).not.toBe(manager.transformerFor("lenient"));
	});
});

describe("type route lifecycle", () => {
	it("clearTypeRoutes keeps the per-scope environments that reset() would drop", () => {
		// This is the whole reason `config()` calls `clearTypeRoutes` rather than
		// `reset()`. Routes are per-build state; the environments are built once
		// per distinct compiler config and discarding them would rebuild every
		// TypeScript environment on each dev rebuild.
		//
		// The routes map itself has no public reader, so this asserts the
		// property that IS observable and that a careless "just use reset()"
		// would break. Route clearing is exercised end to end by the plugin
		// calling it in `config()`.
		const manager = new TwoslashEnvironmentRegistry();
		manager.registerEnvironment({ vfs: new Map(), compilerOptions: { target: "esnext" as const } });
		manager.registerScope("alpha", { target: "esnext" as const });
		addTypeRoutes(new Map([["StaleType", "/api/class/staletype"]]));

		const before = manager.transformerFor("alpha");
		expect(before).not.toBeNull();

		clearTypeRoutes();
		expect(manager.transformerFor("alpha")).toBe(before);

		// The contrast that used to need a singleton `reset()`: a DIFFERENT
		// registry has its own environments. That is now what providing a
		// different layer gives you, rather than a static side effect.
		expect(new TwoslashEnvironmentRegistry().transformerFor("alpha")).toBeNull();
	});
});
