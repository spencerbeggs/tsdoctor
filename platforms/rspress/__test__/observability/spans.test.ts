import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";
import { Thresholds } from "../../src/BuildEnv.js";
import { makeEventBusLayer } from "../../src/observability/EventBus.js";
import type { PluginEvent } from "../../src/observability/events.js";
import { withPhase } from "../../src/observability/spans.js";
import type { ResolvedObservability } from "../../src/schemas/observability.js";

const FULL_THRESHOLDS: ResolvedObservability["thresholds"] = {
	slowCodeBlock: 100,
	slowPageGeneration: 500,
	slowApiLoad: 1000,
	slowFileOperation: 50,
	slowDbOperation: 100,
};

describe("withPhase", () => {
	it("emits PhaseStarted then PhaseCompleted around the effect", async () => {
		const seen: PluginEvent[] = [];
		const layer = makeEventBusLayer([{ minLevel: "trace", handle: (e) => seen.push(e) }]);
		await Effect.runPromise(
			withPhase("generate", { buildId: "b1" }, Effect.succeed(1)).pipe(
				Effect.provide(layer),
				Effect.provide(Layer.succeed(Thresholds, FULL_THRESHOLDS)),
			),
		);
		expect(seen.map((e) => e._tag)).toEqual(["PhaseStarted", "PhaseCompleted"]);
	});

	it("returns the effect's value", async () => {
		const layer = makeEventBusLayer([{ minLevel: "trace", handle: () => {} }]);
		const result = await Effect.runPromise(
			withPhase("generate", { buildId: "b1" }, Effect.succeed(42)).pipe(
				Effect.provide(layer),
				Effect.provide(Layer.succeed(Thresholds, FULL_THRESHOLDS)),
			),
		);
		expect(result).toBe(42);
	});

	it("emits SlowOperation when durationMs exceeds the phase threshold", async () => {
		const seen: PluginEvent[] = [];
		const layer = makeEventBusLayer([{ minLevel: "trace", handle: (e) => seen.push(e) }]);
		// Use a very low threshold so any real execution breaches it
		const thresholds: ResolvedObservability["thresholds"] = { ...FULL_THRESHOLDS, slowPageGeneration: 0 };
		await Effect.runPromise(
			withPhase("generate", { buildId: "b1" }, Effect.succeed(1)).pipe(
				Effect.provide(layer),
				Effect.provide(Layer.succeed(Thresholds, thresholds)),
			),
		);
		const tags = seen.map((e) => e._tag);
		expect(tags).toContain("SlowOperation");
		expect(tags.indexOf("SlowOperation")).toBeGreaterThan(tags.indexOf("PhaseStarted"));
	});

	it("works without an EventBus in context (no-op)", async () => {
		// emit is serviceOption-based so withPhase must not fail without a bus
		await expect(Effect.runPromise(withPhase("generate", { buildId: "b1" }, Effect.succeed("ok")))).resolves.toBe("ok");
	});
});
