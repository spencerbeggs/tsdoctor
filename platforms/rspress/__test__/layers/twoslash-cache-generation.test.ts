/**
 * `TwoslashCacheService.open` / `persist` — the build's generation.
 *
 * @remarks
 * These two members exist because the render pass runs AFTER `config()`
 * returns, so the live cache has to survive that boundary. It used to do so as
 * two fields on `ResolvedBuildContext` plus a mutable `twoslashCacheHandle` in
 * `plugin.ts`; Task 4.5 moved it to the service that persists it, which is what
 * let `ResolvedBuildContext` be deleted.
 *
 * The failure modes are silent in both directions: a `persist` that never
 * writes leaves every build cold (a ~40x render-phase regression that still
 * reports success), and one that always writes churns the store on every
 * all-hit build.
 */

import { Effect, Option } from "effect";
import { describe, expect, it } from "vitest";
import { TwoslashCacheService } from "../../src/services/TwoslashCacheService.js";
import type { TwoslashCacheValue } from "../../src/twoslash-cache.js";

const value = (code: string): TwoslashCacheValue => ({ nodes: [], code });

describe("TwoslashCacheService generation", () => {
	// The live layer builds open/persist over its own load/save, so exercise the
	// real composition rather than the hand-written stub above.
	const realLayer = async () => {
		const { TwoslashCacheServiceLive } = await import("../../src/layers/TwoslashCacheServiceLive.js");
		return TwoslashCacheServiceLive;
	};

	// FORBIDS: `persist` returning Some when nothing was opened. plugin.ts emits
	// a TwoslashCacheSaved event on Some, so a bogus Some reports a save that
	// never happened — on an inert build, which opens nothing at all.
	it("persists nothing when no generation was opened", async () => {
		const layer = await realLayer();
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const svc = yield* TwoslashCacheService;
				return yield* svc.persist();
			}).pipe(Effect.provide(layer)),
		);
		expect(Option.isNone(result)).toBe(true);
	});

	// FORBIDS: `open` returning a detached cache, AND `persist` not writing.
	// Asserting the returned report is not enough — the report can be correct
	// while nothing reaches the store, which is the ~40x cold-render regression
	// that still reports success. Only the round trip distinguishes them.
	it("round-trips a written entry through persist and back", async () => {
		const layer = await realLayer();
		// Unique per run: a previous run's XDG generation must not decide this.
		const env = `gen-test-${Date.now()}-${Math.random().toString(36).slice(2)}`;

		const restored = await Effect.runPromise(
			Effect.gen(function* () {
				const svc = yield* TwoslashCacheService;
				const cache = yield* svc.open(env);
				cache.write?.({ hash: "k1" } as never, value("const a = 1") as never);
				const report = yield* svc.persist();
				expect(Option.isSome(report)).toBe(true);
				if (Option.isSome(report)) {
					expect(report.value.envHash).toBe(env);
					expect(report.value.dirty).toBe(true);
				}
				// Re-open the SAME generation: this goes through save → load, so it
				// is empty unless persist actually wrote.
				const reopened = yield* svc.open(env);
				return reopened.entries().size;
			}).pipe(Effect.provide(layer)),
		);

		expect(restored).toBe(1);
	});

	// FORBIDS: writing unconditionally. An all-hit build has nothing to add and
	// rewriting an identical blob churns the store for nothing.
	it("reports a clean generation without marking it dirty", async () => {
		const layer = await realLayer();
		const report = await Effect.runPromise(
			Effect.gen(function* () {
				const svc = yield* TwoslashCacheService;
				yield* svc.open("clean-env");
				return yield* svc.persist();
			}).pipe(Effect.provide(layer)),
		);
		expect(Option.isSome(report)).toBe(true);
		if (Option.isSome(report)) expect(report.value.dirty).toBe(false);
	});
});
