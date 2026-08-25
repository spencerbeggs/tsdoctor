/**
 * The highlighter's lifetime is the runtime's, not `resolve()`'s.
 *
 * @remarks
 * Two properties, each with a failure mode that produces no error:
 * acquiring more than once leaks a WASM instance per rebuild (the
 * `[Shiki] N instances have been created` console leak), and disposing before
 * the render pass leaves code blocks rendering as unhighlighted `<pre>`.
 * Neither shows up in a passing suite, so both are asserted directly.
 */

import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, ManagedRuntime, References } from "effect";
import { describe, expect, it } from "vitest";
import { HighlighterServiceLive } from "../../src/layers/HighlighterServiceLive.js";
import { DEFAULT_SHIKI_THEMES } from "../../src/markdown/shiki-utils.js";
import { HighlighterService } from "../../src/services/HighlighterService.js";

const Silent = Layer.succeed(References.MinimumLogLevel, "None");

describe("HighlighterServiceLive", () => {
	// FORBIDS: moving the acquire back inside a per-call effect (or calling the
	// factory twice in one graph). Either yields a fresh highlighter per use,
	// which is the leak the service exists to fix and which nothing else
	// reports.
	it("acquires ONE highlighter no matter how many times it is used", async () => {
		const layer = HighlighterServiceLive([DEFAULT_SHIKI_THEMES.light, DEFAULT_SHIKI_THEMES.dark]);
		const runtime = ManagedRuntime.make(Layer.mergeAll(layer, NodeFileSystem.layer, Silent));
		try {
			const read = Effect.map(HighlighterService, (s) => s.highlighter);
			const first = await runtime.runPromise(read);
			const second = await runtime.runPromise(read);
			expect(first).toBe(second);
		} finally {
			await runtime.dispose();
		}
	});

	// FORBIDS: dropping the `Effect.acquireRelease` release (the state this
	// replaced — a highlighter created with `Effect.promise` and never
	// disposed). A live highlighter still highlights, so only reaching into it
	// after dispose distinguishes the two.
	it("disposes the highlighter when the runtime is disposed, and not before", async () => {
		const layer = HighlighterServiceLive([DEFAULT_SHIKI_THEMES.light, DEFAULT_SHIKI_THEMES.dark]);
		const runtime = ManagedRuntime.make(Layer.mergeAll(layer, NodeFileSystem.layer, Silent));
		const highlighter = await runtime.runPromise(Effect.map(HighlighterService, (s) => s.highlighter));

		// Alive: still renders while the runtime is up — this is the property the
		// render pass depends on, since it runs after `config()` returns.
		expect(highlighter.getLoadedThemes()).toContain(DEFAULT_SHIKI_THEMES.light);

		await runtime.dispose();

		// Disposed: the internal registry is gone, so a render now throws.
		expect(() =>
			highlighter.codeToHast("const a = 1", { lang: "typescript", theme: DEFAULT_SHIKI_THEMES.light }),
		).toThrow();
	});

	// FORBIDS: hardcoding the default themes in the layer and ignoring the
	// argument — every custom-themed API would then render against the wrong
	// theme, silently.
	it("loads the themes it was given", async () => {
		const layer = HighlighterServiceLive([DEFAULT_SHIKI_THEMES.light, DEFAULT_SHIKI_THEMES.dark, "nord"]);
		const runtime = ManagedRuntime.make(Layer.mergeAll(layer, NodeFileSystem.layer, Silent));
		try {
			const loaded = await runtime.runPromise(Effect.map(HighlighterService, (s) => s.highlighter.getLoadedThemes()));
			expect(loaded).toContain("nord");
		} finally {
			await runtime.dispose();
		}
	});
});
