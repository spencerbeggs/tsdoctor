/**
 * The render-pass holder over `TwoslashEnvironments`.
 *
 * @remarks
 * Two failure modes, neither of which produces an error: an UNINSTALLED holder
 * (the render pass gets `null` and every code block renders untype-checked)
 * and a STALE one (a dev HMR rebuild hands out transformers built against
 * declarations that have since changed). Both are asserted directly, because
 * a passing site build shows neither.
 *
 * Note what a weak version of these tests would look like: asserting that
 * `twoslashTransformerFor` "returns something". It does — the fallback
 * environment — for a completely mis-wired holder. Every assertion here
 * distinguishes a SPECIFIC environment from the fallback.
 */

import { readFileSync } from "node:fs";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { TwoslashEnvironmentsLive } from "../src/layers/TwoslashEnvironmentsLive.js";
import type { TwoslashEnvironmentsShape } from "../src/services/TwoslashEnvironments.js";
import { TwoslashEnvironments } from "../src/services/TwoslashEnvironments.js";
import {
	clearTwoslashAccess,
	installTwoslashAccess,
	setTwoslashFile,
	twoslashTransformerFor,
} from "../src/twoslash-access.js";

const VFS = new Map([["node_modules/pkg/index.d.ts", "export declare const a: number;"]]);
const STRICT = { target: 99, strict: true };
const LOOSE = { target: 99, strict: false };

/** Build a registry through the real layer, populate it, and install it. */
function installed(register: (svc: TwoslashEnvironmentsShape) => void): TwoslashEnvironmentsShape {
	const svc = Effect.runSync(Effect.provide(TwoslashEnvironments, TwoslashEnvironmentsLive));
	register(svc);
	installTwoslashAccess(svc);
	return svc;
}

afterEach(() => {
	clearTwoslashAccess();
});

describe("twoslash-access holder", () => {
	// FORBIDS: forgetting to install (the inert path, or a wiring mistake that
	// moves the install out of the Effect program). Must degrade, not throw —
	// a user-authored `with-api` fence still has to render.
	it("degrades to null before installation rather than throwing", () => {
		clearTwoslashAccess();
		expect(() => twoslashTransformerFor("pkg")).not.toThrow();
		expect(twoslashTransformerFor("pkg")).toBeNull();
		expect(() => setTwoslashFile("some/page.md")).not.toThrow();
	});

	// FORBIDS: installing a snapshot/copy instead of the live service. The
	// holder must see registrations that happen AFTER the install, because
	// `plugin.ts` installs before `ConfigService.resolve()` populates anything.
	it("sees environments registered after installation", () => {
		const svc = installed(() => {});
		expect(twoslashTransformerFor("alpha")).toBeNull();

		svc.registerEnvironment({ vfs: VFS, compilerOptions: STRICT });
		svc.registerScope("alpha", STRICT);

		expect(twoslashTransformerFor("alpha")).not.toBeNull();
	});

	// FORBIDS: the holder resolving every scope to the fallback. This is the
	// assertion shape that matters — two DISTINCT environments, and the scope
	// getting its OWN. A holder wired to a different registry, or one that
	// dropped scope routing, would still return a non-null transformer here.
	it("routes a known scope to its OWN environment, not the fallback", () => {
		const svc = installed((s) => {
			s.registerEnvironment({ vfs: VFS, compilerOptions: STRICT });
			s.registerEnvironment({ vfs: VFS, compilerOptions: LOOSE });
			s.registerScope("strict-pkg", STRICT);
			s.registerScope("loose-pkg", LOOSE);
		});

		const fallback = svc.transformerFor();
		const strict = twoslashTransformerFor("strict-pkg");
		const loose = twoslashTransformerFor("loose-pkg");

		expect(strict).not.toBeNull();
		expect(loose).not.toBeNull();
		expect(strict).not.toBe(loose);
		// The fallback is the FIRST environment registered, so `loose-pkg` must
		// differ from it. If scope routing regressed, both would equal this.
		expect(loose).not.toBe(fallback);
	});

	// FORBIDS: dropping `clearTwoslashAccess` from the per-build reset. A dev
	// HMR session reuses the process, so without it the second build's render
	// pass reads the FIRST build's transformers.
	it("clearing between builds stops the previous build's environments leaking", () => {
		const first = installed((s) => {
			s.registerEnvironment({ vfs: VFS, compilerOptions: STRICT });
			s.registerScope("alpha", STRICT);
		});
		const firstTransformer = twoslashTransformerFor("alpha");
		expect(firstTransformer).not.toBeNull();

		// A new build starts: plugin.ts clears, then installs the new registry.
		clearTwoslashAccess();
		expect(twoslashTransformerFor("alpha")).toBeNull();

		const second = installed((s) => {
			s.registerEnvironment({ vfs: VFS, compilerOptions: STRICT });
			s.registerScope("alpha", STRICT);
		});
		expect(second).not.toBe(first);
		// Same configuration, but a genuinely new environment — not the stale
		// transformer the previous build built.
		expect(twoslashTransformerFor("alpha")).not.toBe(firstTransformer);
	});

	// FORBIDS: a no-op `setTwoslashFile`. Diagnostics attributed to "unknown"
	// still appear in issues.json, just with no file to open — which reads as
	// working.
	// FORBIDS: a no-op `setTwoslashFile`. Diagnostics attributed to "unknown"
	// still appear in issues.json, just with no file to open — which reads as
	// working.
	it("delivers the current file to the installed service", () => {
		const svc = installed((s) => {
			s.registerEnvironment({ vfs: VFS, compilerOptions: STRICT });
		});

		let delivered: string | null = null;
		installTwoslashAccess({
			...svc,
			setCurrentFile: (p: string) => {
				delivered = p;
			},
		});
		setTwoslashFile("kitchensink/api/class/plugin.md");
		expect(delivered).toBe("kitchensink/api/class/plugin.md");
	});
});

describe("layer isolation", () => {
	// FORBIDS: Layer.succeed instead of Layer.sync. A succeed would capture ONE
	// registry shared by every graph referencing this const — in a test run,
	// every test file in the process.
	it("gives each layer build its own registry", () => {
		const build = (): TwoslashEnvironmentsShape =>
			Effect.runSync(Effect.provide(TwoslashEnvironments, TwoslashEnvironmentsLive));

		const a = build();
		const b = build();
		a.registerEnvironment({ vfs: VFS, compilerOptions: STRICT });
		a.registerScope("alpha", STRICT);

		expect(a.transformerFor("alpha")).not.toBeNull();
		expect(b.transformerFor("alpha")).toBeNull();
	});

	// The probe recorded in twoslash-access.ts, as an executable assertion:
	// one layer reference across two runtimes builds two instances. This is
	// why the holder cannot be runtime-bound.
	it("one layer reference across two layer graphs builds two registries", () => {
		const one = Effect.runSync(Effect.provide(TwoslashEnvironments, Layer.mergeAll(TwoslashEnvironmentsLive)));
		const two = Effect.runSync(Effect.provide(TwoslashEnvironments, Layer.mergeAll(TwoslashEnvironmentsLive)));
		expect(one).not.toBe(two);
	});
});

describe("inert builds", () => {
	// The inert path (`api: null` / `apis: []`) skips the doc-generation Effect
	// program entirely, so `installTwoslashAccess` never runs. A user-authored
	// `with-api` fence still reaches the remark plugin — it must render without
	// type information rather than crash the build.
	it("hands the render pass null without throwing when nothing was installed", () => {
		clearTwoslashAccess();
		expect(() => {
			setTwoslashFile("guides/getting-started.md");
			const transformer = twoslashTransformerFor("some-scope");
			expect(transformer).toBeNull();
		}).not.toThrow();
	});
});

describe("plugin.ts wires the holder", () => {
	/**
	 * A structural pin, in the same category as the Task 2.4 layer-acquisition
	 * pin and for the same reason: the property is "the call site exists", which
	 * is structural, and no behavioural test can reach it — reaching it means
	 * driving RSPress's MDX pipeline from a unit test.
	 *
	 * **What this proves:** `plugin.ts` still installs and still clears, in the
	 * shape that reads the service out of the Effect program.
	 *
	 * **What it does NOT prove:** that the install happens before any read, that
	 * the service behind it is correct, or that the call is reachable. The tests
	 * above cover the holder's behaviour; the site build covers ordering and
	 * reachability — a build whose `(unscoped)` line reports `0 typechecked` has
	 * a live wiring fault this pin cannot see.
	 *
	 * The pin exists because deleting the install line is invisible to
	 * everything else: typecheck stays clean, the suite stays green, the build
	 * succeeds, and every user-authored `with-api` fence silently stops being
	 * type-checked. Chunk 5's layer tiering is the change most likely to drop it.
	 */
	const pluginSource = readFileSync(new URL("../src/plugin.ts", import.meta.url), "utf8");

	it("installs the holder from inside the Effect program", () => {
		// The exact shape, not a bare substring: the argument must come from
		// yielding the service, which is what ties the holder to the runtime's
		// registry rather than to some other object that happens to typecheck.
		expect(pluginSource).toContain("installTwoslashAccess(yield* TwoslashEnvironments)");
	});

	it("clears the holder between builds", () => {
		expect(pluginSource).toContain("clearTwoslashAccess()");
	});
});
