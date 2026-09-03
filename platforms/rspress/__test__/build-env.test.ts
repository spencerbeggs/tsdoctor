/**
 * The `Context.Reference` tier: what each Reference must actually do.
 *
 * @remarks
 * A Reference carries a default, so nothing fails when wiring is wrong — the
 * default silently applies. That is this subsystem's recurring failure shape
 * and it is why every test here provides a NON-default value and asserts the
 * provided one is observed. A test that provides the default proves nothing:
 * it passes identically whether the value was plumbed or fabricated.
 *
 * Each test names the edit it forbids, and each was watched failing under that
 * edit before being kept.
 */

import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { BuildId, Thresholds } from "../src/BuildEnv.js";
import { emit, makeEventBusLayer } from "../src/observability/EventBus.js";
import type { PluginEvent } from "../src/observability/events.js";
import { PluginEvent as PE } from "../src/observability/events.js";
import { withPhase } from "../src/observability/spans.js";
import {
	clearSyncEmitter,
	emitSync,
	installSyncEmitter,
	syncBuildId,
	syncSlowCodeBlockMs,
} from "../src/observability/sync-emitter.js";
import type { ResolvedObservability } from "../src/schemas/observability.js";

const THRESHOLDS: ResolvedObservability["thresholds"] = {
	slowCodeBlock: 100,
	slowPageGeneration: 500,
	slowApiLoad: 1000,
	slowFileOperation: 50,
	slowDbOperation: 100,
};

/** A bus that records everything, plus the layer providing it. */
function recordingBus(): { seen: PluginEvent[]; layer: Layer.Layer<never> } {
	const seen: PluginEvent[] = [];
	return {
		seen,
		layer: makeEventBusLayer([{ minLevel: "trace", handle: (e) => seen.push(e) }]) as unknown as Layer.Layer<never>,
	};
}

describe("emit fills ctx.buildId from the Reference", () => {
	// FORBIDS: removing the buildId fill from `emit`. Twenty-four sites stopped
	// passing a buildId on the strength of this behaviour; without it they all
	// silently emit `undefined` and every artifact loses its correlation key.
	it("populates an omitted buildId", async () => {
		const { seen, layer } = recordingBus();
		await Effect.runPromise(
			emit(PE.BuildStarted({ ctx: {}, level: "info", mode: "prod", apiCount: 1 })).pipe(
				Effect.provide(layer),
				Effect.provide(Layer.succeed(BuildId, "build-abc")),
			),
		);
		expect(seen).toHaveLength(1);
		expect(seen[0]?.ctx.buildId).toBe("build-abc");
	});

	it("preserves a buildId the caller set explicitly", async () => {
		const { seen, layer } = recordingBus();
		await Effect.runPromise(
			emit(PE.BuildStarted({ ctx: { buildId: "explicit" }, level: "info", mode: "prod", apiCount: 1 })).pipe(
				Effect.provide(layer),
				Effect.provide(Layer.succeed(BuildId, "build-abc")),
			),
		);
		expect(seen[0]?.ctx.buildId).toBe("explicit");
	});

	it("keeps the rest of the context intact while filling", async () => {
		const { seen, layer } = recordingBus();
		await Effect.runPromise(
			emit(
				PE.ItemSkipped({
					ctx: { packageName: "pkg", route: "/r" },
					item: "X",
					kind: "Class",
					reason: "x",
					level: "warn",
				}),
			).pipe(Effect.provide(layer), Effect.provide(Layer.succeed(BuildId, "build-abc"))),
		);
		expect(seen[0]?.ctx).toMatchObject({ buildId: "build-abc", packageName: "pkg", route: "/r" });
	});
});

describe("withPhase reads Thresholds from context", () => {
	// FORBIDS: reverting withPhase to a threshold parameter, or having it fall
	// back to the Reference default. Both leave the SlowOperation boundary at
	// 500ms for `generate` regardless of what the build configured.
	it("fires SlowOperation at the PROVIDED boundary, not the default", async () => {
		const { seen, layer } = recordingBus();
		// Default slowPageGeneration is 500ms; a trivial effect never breaches it.
		// Provided as 0, every run breaches. If the default applied, no
		// SlowOperation would appear.
		await Effect.runPromise(
			withPhase("generate", { packageName: "p" }, Effect.succeed(1)).pipe(
				Effect.provide(layer),
				Effect.provide(Layer.succeed(Thresholds, { ...THRESHOLDS, slowPageGeneration: 0 })),
			),
		);
		expect(seen.map((e) => e._tag)).toContain("SlowOperation");
	});

	it("does not fire at a boundary the build did not breach", async () => {
		const { seen, layer } = recordingBus();
		await Effect.runPromise(
			withPhase("generate", { packageName: "p" }, Effect.succeed(1)).pipe(
				Effect.provide(layer),
				Effect.provide(Layer.succeed(Thresholds, { ...THRESHOLDS, slowPageGeneration: 60_000 })),
			),
		);
		expect(seen.map((e) => e._tag)).not.toContain("SlowOperation");
	});

	it("reports the provided threshold in the event, not the default", async () => {
		const { seen, layer } = recordingBus();
		await Effect.runPromise(
			withPhase("modelLoad", { packageName: "p" }, Effect.succeed(1)).pipe(
				Effect.provide(layer),
				Effect.provide(Layer.succeed(Thresholds, { ...THRESHOLDS, slowApiLoad: 0 })),
			),
		);
		const slow = seen.find((e) => e._tag === "SlowOperation");
		expect(slow).toBeDefined();
		expect((slow as { threshold: number }).threshold).toBe(0);
	});
});

describe("installSyncEmitter reads its configuration from the runtime", () => {
	// FORBIDS: reintroducing threaded parameters on the sync seam, or reading
	// the References per emit instead of at install. The first is the shape
	// that had already begun to decay (two of seven seams had grown a third
	// parameter); the second would make an emit depend on ambient context that
	// a sync callback does not have.
	it("picks up BuildId and the slow-block threshold with no arguments", async () => {
		const { seen, layer } = recordingBus();
		const { ManagedRuntime } = await import("effect");
		const runtime = ManagedRuntime.make(
			Layer.mergeAll(
				layer,
				Layer.succeed(BuildId, "sync-build"),
				Layer.succeed(Thresholds, { ...THRESHOLDS, slowCodeBlock: 42 }),
			),
		);
		try {
			installSyncEmitter(runtime);
			expect(syncBuildId()).toBe("sync-build");
			expect(syncSlowCodeBlockMs()).toBe(42);

			emitSync(PE.PrettierError({ ctx: { buildId: syncBuildId() }, file: "f", reason: "r", level: "warn" }));
			expect(seen.map((e) => e._tag)).toContain("PrettierError");
			expect(seen[0]?.ctx.buildId).toBe("sync-build");
		} finally {
			clearSyncEmitter();
			await runtime.dispose();
		}
	});

	it("is a no-op before installation rather than a crash", () => {
		clearSyncEmitter();
		expect(() => emitSync(PE.PrettierError({ ctx: {}, file: "f", reason: "r", level: "warn" }))).not.toThrow();
		expect(syncBuildId()).toBe("");
	});
});
