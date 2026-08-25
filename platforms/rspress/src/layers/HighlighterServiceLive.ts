import { Effect, Layer } from "effect";
import { createHighlighter } from "shiki";
import type { ShikiThemeInput } from "../markdown/shiki-utils.js";
import { SHIKI_LANGS } from "../markdown/shiki-utils.js";
import { emit } from "../observability/EventBus.js";
import { PluginEvent } from "../observability/events.js";
import { HighlighterService } from "../services/HighlighterService.js";

/**
 * Acquire the build's highlighter, and release it when the runtime is
 * disposed.
 *
 * @remarks
 * `Layer.effect` over `Effect.acquireRelease` is the v4 scoped-constructor
 * idiom (`Layer.scoped` is gone; `Layer.effect` strips `Scope` from `R`).
 * Because the layer sits in the `ManagedRuntime`'s stack, the highlighter is
 * created on the runtime's first use and `dispose()`d by
 * `effectRuntime.dispose()` — which `plugin.ts` calls on production builds
 * only, so a dev HMR session keeps one highlighter across rebuilds instead of
 * leaking one per rebuild.
 *
 * **Bind the result to a `const`.** This is a layer FACTORY: each call mints a
 * fresh layer reference, and layers memoize by reference, so calling it twice
 * in one graph acquires two highlighters — the exact leak this layer exists to
 * fix.
 *
 * The themes are passed in rather than read from a resolved build context
 * because the layer builds before `ConfigService.resolve()` runs. Passing them
 * as an argument rather than through a `Context.Reference` is deliberate: a
 * Reference carries a default, so forgetting to wire it would silently load
 * only the default themes and render every custom-themed block wrong. A
 * missing argument is a type error.
 */
export function HighlighterServiceLive(themes: ReadonlyArray<ShikiThemeInput>): Layer.Layer<HighlighterService> {
	return Layer.effect(
		HighlighterService,
		Effect.gen(function* () {
			const startedMs = performance.now();
			const highlighter = yield* Effect.acquireRelease(
				Effect.promise(() => createHighlighter({ themes: [...themes], langs: [...SHIKI_LANGS] })),
				(instance) => Effect.sync(() => instance.dispose()),
			);
			yield* emit(
				PluginEvent.PhaseCompleted({
					ctx: {},
					level: "debug",
					phase: "shikiInit",
					durationMs: Math.round(performance.now() - startedMs),
				}),
			);
			return { highlighter };
		}),
	);
}
