/**
 * The service test doubles' one guarantee: an unstubbed member is loud.
 *
 * @remarks
 * These pin the difference between `makeTest` and the hand-written
 * `Layer.succeed` doubles it replaced. A `Layer.succeed` double is TOTAL — every
 * member is supplied, so a member the test never meant to exercise still
 * answers, and answers with whatever the double's author happened to write. A
 * test can then pass while exercising a stub instead of the wiring it claims to
 * cover, which is not a failure any assertion in that test can see.
 *
 * Services whose every member has a safe, meaningful default (the registry, the
 * Twoslash cache) get defaults instead; only the two whose defaults would be
 * *indistinguishable from a real answer* die unstubbed. That distinction is the
 * point, so both halves are asserted here.
 */
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigService } from "../../src/services/ConfigService.js";
import { OgService } from "../../src/services/OgService.js";
import { TwoslashCacheService } from "../../src/services/TwoslashCacheService.js";
import { TypeRegistryService } from "../../src/services/TypeRegistryService.js";

describe("service test doubles", () => {
	it("OgService.makeTest throws naming the member when resolveImage is unstubbed", () => {
		const double = OgService.makeTest();
		expect(() => double.resolveImage({ config: undefined, siteUrl: "https://example.com", packageName: "x" })).toThrow(
			/OgService\.makeTest: resolveImage\(\) was called but not stubbed/,
		);
	});

	it("ConfigService.makeTest throws naming the member when resolve is unstubbed", () => {
		const double = ConfigService.makeTest();
		expect(() => double.resolve({})).toThrow(/ConfigService\.makeTest: resolve\(\) was called but not stubbed/);
	});

	it("an override replaces only that member, leaving the others at their defaults", async () => {
		// FORBIDS a makeTest that spreads overrides over a fixed object in the
		// wrong order, or that drops the defaults once any override is supplied.
		const double = TypeRegistryService.makeTest({
			loadPackages: () => Effect.succeed({ vfs: new Map([["a.d.ts", "declare const a: 1;"]]) }),
		});

		const loaded = await Effect.runPromise(double.loadPackages([]));
		expect(loaded.vfs.size).toBe(1);

		// Untouched by the override above.
		const resolved = await Effect.runPromise(double.resolveVersions([{ name: "zod", version: "3.0.0" }]));
		expect(resolved).toEqual([{ name: "zod", version: "3.0.0" }]);
	});

	it("TwoslashCacheService.makeTest hands out a real in-memory generation", async () => {
		// Not a stub, deliberately: registerEnvironment gives this object to the
		// Twoslash transformers, so one that could not be read or written would
		// change the render path's shape rather than merely dropping persistence.
		const double = TwoslashCacheService.makeTest();
		const cache = await Effect.runPromise(double.open("env-hash"));
		expect(cache.entries().size).toBe(0);
		expect(typeof cache.stats).toBe("function");
	});
});
