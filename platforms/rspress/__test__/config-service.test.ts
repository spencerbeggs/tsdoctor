import path from "node:path";
import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { ConfigValidationError, TypeRegistryError } from "../src/errors.js";
import type { PluginOptions } from "../src/schemas/config.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { PluginConfig } from "../src/services/PluginConfig.js";
import { TwoslashEnvironments } from "../src/services/TwoslashEnvironments.js";
import { TypeRegistryService } from "../src/services/TypeRegistryService.js";
import { MockTwoslashCacheServiceLayer, MockTypeRegistryServiceLayer } from "./utils/layers.js";

const fixtureModel = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");

const makeTestLayer = (options: PluginOptions) =>
	Layer.provideMerge(
		ConfigService.layer,
		Layer.mergeAll(
			MockTypeRegistryServiceLayer,
			MockTwoslashCacheServiceLayer,
			TwoslashEnvironments.layer,
			Layer.succeed(PluginConfig, options),
		),
	);

describe("ConfigService.layer.resolve", () => {
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

	it("derives siteUrl from RSPress siteOrigin + base, and threads ogImage", async () => {
		const options: PluginOptions = {
			api: {
				packageName: "example-module",
				model: fixtureModel,
				baseRoute: "/example-module",
			},
			ogImage: "/images/og.png",
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			// The canonical URL is RSPress's to declare, not the plugin's: the
			// former `siteUrl` plugin option is gone.
			return yield* config.resolve({ siteOrigin: "https://example.com", base: "/docs/" });
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));
		// OG resolution is a service now, not a context field, so what resolve()
		// still owns is threading siteUrl and ogImage onto the API config that
		// `writeSingleFile` gates on.
		expect(result[0].siteUrl).toBe("https://example.com/docs");
		expect(result[0].ogImage).toBe("/images/og.png");
	});

	it("falls back to a root-relative siteUrl when RSPress declares no siteOrigin", async () => {
		// FORBIDS inventing a placeholder origin, which would advertise a host
		// that does not serve the site. Root-relative is RSPress's own documented
		// fallback and keeps the tags inspectable in dev on localhost.
		const options: PluginOptions = {
			api: { packageName: "example-module", model: fixtureModel, baseRoute: "/example-module" },
			ogImage: "/images/og.png",
		};

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({ base: "/docs/" });
		}).pipe(Effect.scoped);

		const result = await Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));
		expect(result[0].siteUrl).toBe("/docs");
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
		// Only `loadPackages` is overridden; `resolveVersions` keeps the double's
		// pass-through default, so this test states the one behaviour it is about.
		const FailingTypeRegistryLayer = TypeRegistryService.layerTest({
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
			ConfigService.layer,
			Layer.mergeAll(
				FailingTypeRegistryLayer,
				MockTwoslashCacheServiceLayer,
				TwoslashEnvironments.layer,
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

/**
 * The three user-facing misconfigurations that used to become untyped defects.
 *
 * @remarks
 * Each of these throws from inside what was an `Effect.promise` body, so before
 * Task 5.2 it escaped the error channel entirely: the build died with an
 * unhandled rejection and wrote no `issues.json` entry, because a defect is not
 * a failure and the issues sink only ever sees events. They are the errors
 * users actually hit — a typo in a tsconfig path, a moved `package.json`, a
 * version that disagrees with `peerDependencies` — and none of the three had
 * any test at all.
 *
 * Asserted through `Effect.flip`, so a test that stops failing because the
 * error became a defect again fails here rather than passing vacuously.
 */
describe("ConfigService.layer.resolve — typed configuration failures", () => {
	const runFailure = (options: PluginOptions) => {
		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			return yield* config.resolve({});
		}).pipe(Effect.scoped, Effect.flip);
		return Effect.runPromise(program.pipe(Effect.provide(makeTestLayer(options))));
	};

	it("fails typed when a declared tsconfig cannot be parsed", async () => {
		const error = await runFailure({
			api: {
				packageName: "example-module",
				model: fixtureModel,
				baseRoute: "/example-module",
				tsconfig: path.join(import.meta.dirname, "__fixtures__/does-not-exist/tsconfig.json"),
			},
		});

		expect(error).toBeInstanceOf(ConfigValidationError);
		expect((error as ConfigValidationError).field).toBe("tsconfig");
		expect((error as ConfigValidationError).reason).toMatch(/does-not-exist/);
	});

	it("fails typed when a declared package.json is missing", async () => {
		const error = await runFailure({
			api: {
				packageName: "example-module",
				model: fixtureModel,
				baseRoute: "/example-module",
				packageJson: path.join(import.meta.dirname, "__fixtures__/does-not-exist/package.json"),
			},
		});

		expect(error).toBeInstanceOf(ConfigValidationError);
		expect((error as ConfigValidationError).field).toBe("packageJson");
		expect((error as ConfigValidationError).reason).toMatch(/not found/i);
	});

	it("fails typed when externalPackages conflicts with peerDependencies", async () => {
		const error = await runFailure({
			api: {
				packageName: "example-module",
				model: fixtureModel,
				baseRoute: "/example-module",
				packageJson: path.join(import.meta.dirname, "__fixtures__/conflicting-peers/package.json"),
				externalPackages: [{ name: "zod", version: "3.0.0" }],
			},
		});

		expect(error).toBeInstanceOf(ConfigValidationError);
		expect((error as ConfigValidationError).field).toBe("externalPackages");
		// Names both sides of the conflict, so the message is actionable.
		expect((error as ConfigValidationError).reason).toMatch(/zod/);
		expect((error as ConfigValidationError).reason).toMatch(/4\.0\.0/);
	});
});
