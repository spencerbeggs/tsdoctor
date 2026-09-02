/**
 * A cache that cannot be opened degrades, and says that it degraded.
 *
 * @remarks
 * **This lives in its own file deliberately.** The same test inside
 * `cache-acquisition.test.ts` passed in isolation and failed when the
 * acquisition test ran first: something in the XDG resolution path is cached
 * for the life of the module instance, so a healthy cache home resolved by an
 * earlier test is reused here and the deliberately-broken one is never seen.
 * Vitest isolates by file, so a file of its own is what makes the fixture real.
 *
 * That ordering effect is also why the version of this test that existed before
 * was passing vacuously: it accepted an empty map as evidence of degradation,
 * and an empty map is exactly what a HEALTHY cold cache returns. It asserted
 * nothing that a working cache would not also satisfy.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import { Effect, ManagedRuntime } from "effect";
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

describe("TwoslashCacheService degradation", () => {
	it("degrades to an always-missing cache, and says so, when the cache dir is unusable", async () => {
		await withIsolatedXdg(async (cacheHome) => {
			// A FILE where the cache directory should be: opening the database
			// cannot succeed. This is the real environment failure the posture
			// exists for, not a substituted layer.
			fs.writeFileSync(path.join(cacheHome, TSDOCTOR_NAMESPACE), "not a directory");

			const runtime = ManagedRuntime.make(TwoslashCacheService.layer);
			const { restored, degraded } = await runtime.runPromise(
				Effect.gen(function* () {
					const svc = yield* TwoslashCacheService;
					return { restored: yield* svc.load("env-a"), degraded: svc.degraded };
				}),
			);

			// Construction MUST NOT fail. An earlier version of this test also
			// accepted a construction failure, which `Cache.degrading` now
			// forbids — that hedge was weaker than the contract it was guarding.
			expect(restored.size).toBe(0);

			// And the degradation must be reportable. A degraded cache and a cold
			// one behave identically, so without this flag a broken cache reads as
			// "no cached results yet" on every build, forever.
			expect(degraded).toBe(true);

			await runtime.dispose().catch(() => undefined);
		});
	});
});
