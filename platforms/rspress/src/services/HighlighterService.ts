/**
 * The build's single Shiki highlighter.
 *
 * @remarks
 * A highlighter owns a WASM oniguruma instance and every loaded grammar and
 * theme, and it has a `dispose()` nobody was calling: `ConfigServiceLive`
 * created one per `resolve()`, so a dev-mode HMR session leaked one per
 * rebuild. The test run reported it as
 * `[Shiki] 10 instances have been created` — a console leak, not a failure.
 *
 * The fix is NOT to scope it to `resolve()`. `VfsRegistry` hands this
 * highlighter to the remark plugins, which RSPress invokes during its render
 * pass — after `config()` has returned and after any `resolve()`-scoped scope
 * would have closed. The lifetime that matches is the `ManagedRuntime`'s:
 * acquired when the layer builds, released by `effectRuntime.dispose()` in
 * `afterBuild` on production builds, and deliberately kept alive in dev so HMR
 * rebuilds reuse it.
 *
 * Getting that wrong is silent — a disposed highlighter does not throw, the
 * code blocks just render as unhighlighted `<pre>`.
 *
 * @packageDocumentation
 */

import { Context } from "effect";
import type { Highlighter } from "shiki";

/** @internal */
export interface HighlighterServiceShape {
	/**
	 * The shared highlighter, loaded with every theme any documented API
	 * declares plus the two defaults.
	 */
	readonly highlighter: Highlighter;
}

export class HighlighterService extends Context.Service<HighlighterService, HighlighterServiceShape>()(
	"rspress-plugin-api-extractor/HighlighterService",
) {}
