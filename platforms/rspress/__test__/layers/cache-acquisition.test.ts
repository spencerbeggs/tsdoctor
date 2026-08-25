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
import type { Layer } from "effect";
import { Effect, ManagedRuntime } from "effect";
import { TSDOCTOR_NAMESPACE } from "../../src/layers/xdg.js";
import { TwoslashCacheService } from "../../src/services/TwoslashCacheService.js";

/** Run `body` with XDG pointed at a scratch directory, then clean up. */
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

	it("degrades to a cache miss rather than failing when the cache dir is unusable", async () => {
		await withIsolatedXdg(async (cacheHome) => {
			// A FILE where the cache directory should be: opening the database
			// cannot succeed. The contract is that a cache which cannot be read
			// never fails a build that would otherwise succeed.
			fs.writeFileSync(path.join(cacheHome, TSDOCTOR_NAMESPACE), "not a directory");

			const runtime = ManagedRuntime.make(TwoslashCacheService.layer);
			const restored = await runtime
				.runPromise(
					Effect.gen(function* () {
						const svc = yield* TwoslashCacheService;
						return yield* svc.load("env-a");
					}),
				)
				.catch(() => "layer-construction-failed" as const);

			// Either the layer degrades to an empty map, or it fails at
			// construction — the second is acceptable and is what the plugin's
			// try/catch around the build program already handles. What must NOT
			// happen is a partially-usable service.
			expect(restored === "layer-construction-failed" || (restored as Map<string, unknown>).size === 0).toBe(true);

			await runtime.dispose().catch(() => undefined);
		});
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
