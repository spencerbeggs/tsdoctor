import path from "node:path";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { TypeRegistryError } from "../src/errors.js";
import { ConfigServiceLive } from "../src/layers/ConfigServiceLive.js";
import { TwoslashEnvironmentsLive } from "../src/layers/TwoslashEnvironmentsLive.js";
import type { PluginOptions } from "../src/schemas/index.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { PluginConfig } from "../src/services/PluginConfig.js";
import { TypeRegistryService } from "../src/services/TypeRegistryService.js";
import { MockTwoslashCacheServiceLayer, MockTypeRegistryServiceLayer } from "./utils/layers.js";

const fixtureModel = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");

const makeTestLayer = (options: PluginOptions) =>
	Layer.provideMerge(
		ConfigServiceLive,
		Layer.mergeAll(
			MockTypeRegistryServiceLayer,
			MockTwoslashCacheServiceLayer,
			TwoslashEnvironmentsLive,
			Layer.succeed(PluginConfig, options),
		),
	);

describe("ConfigServiceLive.resolve", () => {
	it("resolves single-API config with fixture model", async () => {
		const options: PluginOptions = {
			api: {
				packageName: "example-module",
				model: fixtureModel,
				baseRoute: "/example-module",
			},
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));

		expect(result).toHaveLength(1);
		expect(result[0].packageName).toBe("example-module");
		expect(result[0].baseRoute).toBe("/example-module/api");
	});

	it("mounts single-API at /api when baseRoute is omitted (api.fromDir default)", async () => {
		const options: PluginOptions = {
			api: { packageName: "example-module", model: fixtureModel },
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));

		expect(result).toHaveLength(1);
		expect(result[0].baseRoute).toBe("/api");
	});

	it("auto-namespaces multi-API by package when baseRoute is omitted (apis.fromDir default)", async () => {
		const options: PluginOptions = {
			apis: [
				{ packageName: "api-a", model: fixtureModel },
				{ packageName: "@scope/api-b", model: fixtureModel },
			],
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));

		expect(result).toHaveLength(2);
		const routes = result.map((c) => c.baseRoute).sort();
		expect(routes).toEqual(["/api-a/api", "/api-b/api"]);
	});

	it("fails with ConfigValidationError when both api and apis provided", async () => {
		const options: PluginOptions = {
			api: { packageName: "foo", model: fixtureModel },
			apis: [{ packageName: "bar", model: fixtureModel }],
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromiseExit(program.pipe(Effect.provide(makeTestLayer(options))));

		expect(result._tag).toBe("Failure");
	});

	it("fails when neither api nor apis provided", async () => {
		const options: PluginOptions = {};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromiseExit(program.pipe(Effect.provide(makeTestLayer(options))));

		expect(result._tag).toBe("Failure");
	});

	it.each([
		["apis: []", { apis: [] } satisfies PluginOptions],
		["apis: null", { apis: null } satisfies PluginOptions],
		["api: null", { api: null } satisfies PluginOptions],
	])("resolves to an empty build context when disabled with %s", async (_label, options) => {
		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));

		expect(result).toEqual([]);
	});

	it("resolves multi-API config", async () => {
		const options: PluginOptions = {
			apis: [
				{ packageName: "api-a", model: fixtureModel, baseRoute: "/api-a" },
				{ packageName: "api-b", model: fixtureModel, baseRoute: "/api-b" },
			],
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));

		expect(result).toHaveLength(2);
	});

	it("resolves versioned single-API config", async () => {
		const options: PluginOptions = {
			api: {
				packageName: "example-module",
				versions: {
					"1.0.0": fixtureModel,
					"2.0.0": { model: fixtureModel },
				},
			},
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({
				multiVersion: { default: "2.0.0", versions: ["1.0.0", "2.0.0"] },
			});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));

		expect(result).toHaveLength(2);
	});

	it("fails when multiVersion active but no versions provided", async () => {
		const options: PluginOptions = {
			api: { packageName: "foo", model: fixtureModel },
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({
				multiVersion: { default: "1.0.0", versions: ["1.0.0"] },
			});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromiseExit(program.pipe(Effect.provide(makeTestLayer(options))));
		expect(result._tag).toBe("Failure");
	});

	it("fails when version keys don't match multiVersion versions", async () => {
		const options: PluginOptions = {
			api: {
				packageName: "foo",
				versions: { "1.0.0": { model: fixtureModel } },
			},
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({
				multiVersion: { default: "2.0.0", versions: ["1.0.0", "2.0.0"] },
			});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromiseExit(program.pipe(Effect.provide(makeTestLayer(options))));
		expect(result._tag).toBe("Failure");
	});

	it("resolves with siteUrl and ogImage", async () => {
		const options: PluginOptions = {
			api: {
				packageName: "example-module",
				model: fixtureModel,
				baseRoute: "/example-module",
			},
			siteUrl: "https://example.com",
			ogImage: "/images/og.png",
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));
		// OG resolution is a service now, not a context field, so what resolve()
		// still owns is threading siteUrl and ogImage onto the API config that
		// `writeSingleFile` gates on.
		expect(result[0].siteUrl).toBe("https://example.com");
		expect(result[0].ogImage).toBe("/images/og.png");
	});

	it("resolves with custom categories", async () => {
		const options: PluginOptions = {
			api: {
				packageName: "example-module",
				model: fixtureModel,
				baseRoute: "/example-module",
				categories: {
					classes: {
						displayName: "Custom Classes",
						singularName: "Custom Class",
						folderName: "custom-class",
						collapsible: true,
						collapsed: true,
						overviewHeaders: [2],
					},
				},
			},
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));
		expect(result[0].categories.classes.displayName).toBe("Custom Classes");
	});

	it("recovers from TypeRegistryError", async () => {
		const FailingTypeRegistryLayer = Layer.succeed(TypeRegistryService, {
			resolveVersions: (packages) => Effect.succeed(packages),
			loadPackages: () =>
				Effect.fail(
					new TypeRegistryError({
						packageName: "zod",
						version: "3.0.0",
						reason: "Network error",
					}),
				),
		});

		const options: PluginOptions = {
			api: {
				packageName: "example-module",
				model: fixtureModel,
				baseRoute: "/example-module",
				externalPackages: [{ name: "zod", version: "3.0.0" }],
			},
		};

		const testLayer = Layer.provideMerge(
			ConfigServiceLive,
			Layer.mergeAll(
				FailingTypeRegistryLayer,
				MockTwoslashCacheServiceLayer,
				TwoslashEnvironmentsLive,
				Layer.succeed(PluginConfig, options),
			),
		);

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));
		// The build degrades rather than aborting: the API is still resolved and
		// its pages will render, just without Twoslash type information.
		expect(result).toHaveLength(1);
		expect(result[0].packageName).toBe("example-module");
	});
});
