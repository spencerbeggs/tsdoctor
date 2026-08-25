/**
 * Metric-registry reachability for `ConfigService.resolve`.
 *
 * @remarks
 * **In its own file deliberately.** `BuildMetrics.externalPackagesTotal` is an
 * attribute-free module-level constant, and Effect resolves such a metric's
 * registry entry ONCE and caches the hook on the metric object for the life of
 * the process (see the registry-scoping limit in
 * `render-phase-instrumentation.md`). Any earlier test in the same process that
 * touches it binds it to whichever registry ran first, after which no later
 * test can observe it in a registry of its own — the assertion below fails for
 * a reason that has nothing to do with the code under test.
 *
 * That process-wide caching is exactly why this file exists rather than another
 * `describe` block in `config-service.test.ts`, where it failed against an
 * empty snapshot even with the production code correct.
 */
import path from "node:path";
import { Effect, Layer, Metric } from "effect";
import { describe, expect, it } from "vitest";
import { makeMetricStore } from "../src/layers/build-metrics.js";
import type { PluginOptions } from "../src/schemas/config.js";
import { ConfigService } from "../src/services/ConfigService.js";
import { PluginConfig } from "../src/services/PluginConfig.js";
import { TwoslashEnvironments } from "../src/services/TwoslashEnvironments.js";
import { MockTwoslashCacheServiceLayer, MockTypeRegistryServiceLayer } from "./utils/layers.js";

const fixtureModel = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");

describe("ConfigService.layer.resolve — metrics reach the build's own registry", () => {
	it("records external.packages.total in a snapshot taken through metrics.layer", async () => {
		const options: PluginOptions = {
			api: {
				packageName: "example-module",
				model: fixtureModel,
				baseRoute: "/example-module",
				externalPackages: [{ name: "zod", version: "3.0.0" }],
			},
		};

		const metrics = makeMetricStore();
		const testLayer = Layer.provideMerge(
			ConfigService.layer,
			Layer.mergeAll(
				MockTypeRegistryServiceLayer,
				MockTwoslashCacheServiceLayer,
				TwoslashEnvironments.layer,
				Layer.succeed(PluginConfig, options),
			),
		);

		const program = Effect.gen(function* () {
			const config = yield* ConfigService;
			yield* config.resolve({});
			return yield* Metric.snapshot;
		}).pipe(Effect.scoped);

		const snapshots = await Effect.runPromise(program.pipe(Effect.provide(Layer.mergeAll(testLayer, metrics.layer))));

		// FORBIDS the `Effect.runSync(Metric.update(...))` this replaced: run
		// outside the fiber, that resolved the MetricRegistry Reference DEFAULT,
		// so the series never appeared in a snapshot taken through this layer.
		// A `Metric.value` assertion cannot forbid it — it reads the right number
		// either way.
		expect(snapshots.map((s) => s.id)).toContain("external.packages.total");
	});
});
