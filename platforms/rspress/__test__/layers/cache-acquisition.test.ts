/**
 * The cache-backed layers must acquire their sqlite database once per runtime,
 * not once per method call.
 *
 * @remarks
 * Both `TypeRegistryService.layer` and `TwoslashCacheService.layer` used to call
 * `Effect.provide(TheLayer)` *inside* each service method. Layer memoization is
 * by reference through a MemoMap, and `Effect.provide` builds into a forked map
 * whose parent has never built that layer — so each call constructed the whole
 * stack and then tore it down at the end of its own scope. The registry stack
 * (XDG dirs, `metadata.sqlite`, an undici HTTP client, the type cache) was
 * built and destroyed twice per build; the Twoslash cache likewise.
 *
 * Nothing caught that. The rest of the suite substitutes mock layers for both
 * services, so a regression here is invisible to every other test — which is
 * why this file drives the REAL layers and counts the files that appear on
 * disk.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Cache } from "@effected/store";
import { Cause, Effect, Exit, Layer, ManagedRuntime, Option } from "effect";
import { TSDOCTOR_NAMESPACE } from "../../src/layers/xdg.js";
import { TwoslashCacheService } from "../../src/services/TwoslashCacheService.js";

/**
 * Run `body` with XDG pointed at a scratch directory, then clean up.
 *
 * @remarks
 * **One XDG-resolving test per file.** The resolution is cached for the life of
 * the module instance, so a second test in the same file gets the FIRST test's
 * cache home rather than its own — silently, and only when the order puts it
 * second. That is how the degradation test came to pass in isolation and fail
 * in place. Vitest isolates by file, so a new file is the unit of isolation
 * here; adding a second caller below would reintroduce the trap.
 */
async function withIsolatedXdg<A>(body: (cacheHome: string) => Promise<A>): Promise<A> {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), "tsdoctor-xdg-"));
	const previous = process.env.XDG_CACHE_HOME;
	process.env.XDG_CACHE_HOME = root;
	try {
		return await body(root);
	} finally {
		if (previous === undefined) delete process.env.XDG_CACHE_HOME;
		else process.env.XDG_CACHE_HOME = previous;
		fs.rmSync(root, { recursive: true, force: true });
	}
}

/** Every `*.sqlite` under `dir`, recursively. */
function sqliteFiles(dir: string): string[] {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { recursive: true, encoding: "utf8" })
		.filter((name) => name.endsWith(".sqlite"))
		.sort();
}

describe("TwoslashCacheService.layer acquisition", () => {
	it("opens one database for many calls, and releases it with the runtime", async () => {
		await withIsolatedXdg(async (cacheHome) => {
			const runtime = ManagedRuntime.make(TwoslashCacheService.layer);

			// Several round trips through both methods. With the layer provided
			// per method this still "works" — it just rebuilds the stack each
			// time — so the observable difference is the acquisition, not the
			// result.
			await runtime.runPromise(
				Effect.gen(function* () {
					const svc = yield* TwoslashCacheService;
					yield* svc.load("env-a");
					yield* svc.save("env-a", new Map());
					yield* svc.load("env-a");
					yield* svc.save("env-b", new Map());
				}),
			);

			// Proves the stack works end to end and lands where the shared
			// namespace says. It does NOT prove single acquisition: sqlite
			// reopening one path is idempotent, so the filesystem looks identical
			// whether the layer was built once or four times. The structural
			// assertion below is what actually discriminates.
			const dbs = sqliteFiles(path.join(cacheHome, TSDOCTOR_NAMESPACE));
			expect(dbs).toEqual(["twoslash.sqlite"]);

			await runtime.dispose();
		});
	});
});

describe("Cache.degrading, the posture both cache layers now rely on", () => {
	// `@effected/store`'s combinator replaced a hand-written `Layer.catchCause`
	// at both sites. That version was right about defects — `SqliteClient.layer`
	// reports a driver construction failure as a DEFECT, so a failure-only catch
	// would miss the case the posture exists for — and wrong about interruption,
	// which it also swallowed. Handing a working cache back to a fiber that was
	// being shut down is not a degraded build; it is an ignored interrupt.
	//
	// These drive the kit directly rather than our services, because neither
	// service exposes an injectable inner layer to break — the same shape as the
	// upstream fixture. What they add is that they run against the build we have
	// actually linked here.
	it("substitutes an always-missing cache when construction FAILS", async () => {
		const Broken = Layer.effect(Cache, Effect.fail(new Error("no cache for you")));
		const probe = Effect.gen(function* () {
			const cache = yield* Cache;
			return yield* cache.get("any-key");
		});
		const result = await Effect.runPromise(Effect.provide(probe, Cache.degrading(Broken)));
		expect(Option.isNone(result)).toBe(true);
	});

	it("substitutes an always-missing cache when construction DIES", async () => {
		const Broken = Layer.effect(Cache, Effect.die(new Error("driver blew up")));
		const probe = Effect.gen(function* () {
			const cache = yield* Cache;
			return yield* cache.get("any-key");
		});
		const result = await Effect.runPromise(Effect.provide(probe, Cache.degrading(Broken)));
		expect(Option.isNone(result)).toBe(true);
	});

	it("propagates INTERRUPTION rather than substituting a cache", async () => {
		const Interrupted = Layer.effect(Cache, Effect.interrupt);
		const exit = await Effect.runPromiseExit(Effect.provide(Effect.void, Cache.degrading(Interrupted)));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect(Cause.hasInterrupts(exit.cause)).toBe(true);
		}
	});

	it("pins the defect: a hand-written catchCause swallows the interrupt", async () => {
		// This is what both services did before adopting the combinator, and it
		// is why the fix belonged upstream rather than in a docs recipe: the
		// version that gets defects right gets this wrong, and nothing in the
		// build's output distinguishes "cache degraded" from "shutdown ignored".
		// If this ever starts failing, `Layer.catchCause` grew interruption
		// awareness and the combinator's interruption half stopped being load-
		// bearing — worth knowing either way.
		const Interrupted = Layer.effect(Cache, Effect.interrupt);
		const swallowing = Interrupted.pipe(
			Layer.catchCause(() =>
				Layer.effect(
					Cache,
					Effect.sync(() => ({}) as unknown as typeof Cache.Service),
				),
			),
		);
		const exit = await Effect.runPromiseExit(Effect.provide(Effect.void, swallowing));
		expect(Exit.isSuccess(exit)).toBe(true);
	});
});

describe("re-raising an interrupt preserves who did the interrupting", () => {
	// `TypeRegistryService` keeps a hand-written interruption-aware catch,
	// because its construction can fail outside the cache — the XDG root and the
	// type cache are independent failure sources that `Cache.degrading` does not
	// reach. That makes it the one place in this tree still carrying the pattern
	// by hand, so the trap gets pinned here.
	//
	// `Effect.interrupt` mints a FRESH interrupt reporting the current fiber as
	// the interruptor, discarding the fiber that actually cancelled the build.
	// Rebuilding from the original cause's interruptors keeps it.
	const reRaise = (cause: Cause.Cause<unknown>) =>
		Layer.effectContext(Effect.failCause(Cause.interrupt([...Cause.interruptors(cause)][0])));

	it("carries the original interruptor through, not this fiber", async () => {
		const original = Cause.interrupt(4242);
		const layer = Layer.effectContext(Effect.failCause(original)).pipe(Layer.catchCause(reRaise));
		const exit = await Effect.runPromiseExit(Effect.provide(Effect.void, layer));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			expect([...Cause.interruptors(exit.cause)]).toEqual([4242]);
		}
	});

	it("pins what the discarded form did: it MISATTRIBUTES, it does not erase", async () => {
		// `Effect.interrupt` — the form this site used before — reports the
		// CURRENT fiber as the interruptor. Measured against rc.109 it yields
		// `[1]`, not `[]`. The distinction matters: an empty interruptor set
		// looks like "no attribution available", while a populated one that
		// names the wrong fiber is a confident lie, and confident lies are the
		// harder failure to notice in a shutdown trace.
		//
		// (`Cause.interrupt()` with no argument IS the erasing form, and it is a
		// different construct — worth keeping straight, because mutating to it
		// makes the test above fail for the wrong reason.)
		const original = Cause.interrupt(4242);
		const layer = Layer.effectContext(Effect.failCause(original)).pipe(
			Layer.catchCause(() => Layer.effectContext(Effect.interrupt)),
		);
		const exit = await Effect.runPromiseExit(Effect.provide(Effect.void, layer));
		expect(Exit.isFailure(exit)).toBe(true);
		if (Exit.isFailure(exit)) {
			const ids = [...Cause.interruptors(exit.cause)];
			expect(ids).not.toEqual([4242]);
			expect(ids.length).toBeGreaterThan(0);
		}
	});
});

describe("the XDG namespace has one definition", () => {
	it("is the single source both cache layers resolve under", () => {
		// A drifted copy of this literal is silent and permanent: the caches move
		// to a different directory, every lookup misses, and a build that should
		// hit a warm Twoslash cache goes cold forever with no error. The house
		// rule asks for the absence of a second spelling to be pinned, so this
		// asserts no source file names the namespace as a bare literal.
		const sources = ["src/services/TypeRegistryService.ts", "src/services/TwoslashCacheService.ts"];
		for (const rel of sources) {
			const text = fs.readFileSync(path.join(import.meta.dirname, "..", "..", rel), "utf8");
			expect(text).not.toMatch(/namespace:\s*"tsdoctor"/);
		}
		expect(TSDOCTOR_NAMESPACE).toBe("tsdoctor");
	});
});

describe("Layer composition shape", () => {
	// The regression this chunk fixes has no cheap runtime observable — sqlite
	// reopening one path leaves the same single file, and both shapes typecheck
	// to the same `R = never`. What differs is the SOURCE: a per-call provide
	// puts `Effect.provide` inside the returned service object. Asserting over
	// source text is the sanctioned tool for a structural property like this,
	// and it is the shape a regression would actually take.
	const sources = {
		"TwoslashCacheService.ts": "src/services/TwoslashCacheService.ts",
		"TypeRegistryService.ts": "src/services/TypeRegistryService.ts",
	} as const;

	for (const [label, rel] of Object.entries(sources)) {
		it(`${label} acquires its stack at layer construction, not per method`, () => {
			const text = fs.readFileSync(path.join(import.meta.dirname, "..", "..", rel), "utf8");

			// `Layer.provide` on the composite — the correct shape.
			expect(text).toMatch(/\)\.pipe\(Layer\.provide\(/);

			// `Effect.provide` anywhere in the file is the regression. These two
			// layers have no legitimate use for it: everything they need is
			// discharged by the composite above.
			const effectProvides = text.match(/Effect\.provide\(/g) ?? [];
			expect(effectProvides).toEqual([]);
		});
	}

	it("exposes a fully-discharged layer that cannot fail construction", () => {
		// Both layers wrap their cache-backed form in `Layer.catchCause`, so an
		// unusable cache degrades instead of aborting the ManagedRuntime build.
		// Hoisting acquisition is what made this necessary: while the stack was
		// provided per method, a construction failure surfaced as that method's
		// failure and the in-method handler absorbed it.
		const built: Layer.Layer<TwoslashCacheService, never, never> = TwoslashCacheService.layer;
		expect(built).toBeDefined();
	});
});
