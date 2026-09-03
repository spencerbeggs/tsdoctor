/**
 * The one bridge from RSPress's render pass to {@link TwoslashEnvironments}.
 *
 * @remarks
 * ## Why this is a holder and NOT bound to a runtime
 *
 * The obvious shape for module state in an Effect codebase is
 * `makeRuntimeEmitter`: capture a `ManagedRuntime` and `runSync` against it.
 * That was the planned shape here and it does not work. Two independent
 * reasons, both verified rather than reasoned:
 *
 * 1. **`runSync` builds the runtime's layer first.** The main runtime's layer
 *    opens two sqlite databases at construction (the snapshot store and the
 *    Twoslash result cache), so it is ASYNCHRONOUS to build. A `runSync`
 *    against it dies with `AsyncFiberError` — from a remark plugin, during the
 *    render pass, invisible to every unit test. That exact failure already
 *    happened once on this branch and only a real site build caught it.
 *
 * 2. **Moving the service to the small sync-buildable runtime does not help.**
 *    Layer memoization is per-`ManagedRuntime` `MemoMap`, not global, so ONE
 *    layer reference across TWO runtimes builds TWO instances. Probed on
 *    `effect@4.0.0-rc.109`: `instances: 1 2  built: 2`. `ConfigService.layer`
 *    would populate one registry and the render pass would read a different,
 *    empty one — `transformerFor` returns `null` for every block and every code
 *    block renders untype-checked, with nothing failing.
 *
 * So the holder takes the service's own methods, installed from INSIDE a fiber
 * where the service is already resolved. It touches no runtime, which means no
 * future change to the layer graph — Chunk 5's tiering included — can
 * reintroduce either failure.
 *
 * **If you are here to "fix" this by binding it to a runtime: don't.** Read the
 * two reasons above first; the failure both times is silent.
 *
 * ## What this does and does not buy
 *
 * Honestly: this is still module-level mutable state, and Task 4.3 does not
 * eliminate it. What changes is where the STATE lives — in a Layer, where a
 * test substitutes it by providing a different layer instead of calling a
 * static `reset()`. What remains is ~15 lines of adapter wiring, the same shape
 * and the same justification as the sync-island event emitter holder.
 *
 * @packageDocumentation
 */

import type { ShikiTransformer } from "shiki";
import type { TwoslashEnvironmentsShape } from "./services/TwoslashEnvironments.js";

/** The uninstalled state: no environments, so nothing to hand out. */
const NOT_INSTALLED: Pick<TwoslashEnvironmentsShape, "transformerFor" | "setCurrentFile"> = {
	transformerFor: () => null,
	setCurrentFile: () => {},
};

let current: Pick<TwoslashEnvironmentsShape, "transformerFor" | "setCurrentFile"> = NOT_INSTALLED;

/**
 * Bind the render pass to this build's environments.
 *
 * @remarks
 * Called from `plugin.ts`'s Effect program, beside the other seam wiring, and
 * NOT from `ConfigService.layer` — config resolution should compute a value, not
 * also mutate module state on the side.
 */
export function installTwoslashAccess(environments: TwoslashEnvironmentsShape): void {
	current = environments;
}

/**
 * Reset to the uninstalled state.
 *
 * @remarks
 * Called at the start of every build, next to `VfsRegistry.clear()`, for the
 * same reason that call exists: a dev HMR session reuses the process, so a
 * holder from the previous build would otherwise outlive it and hand the
 * render pass transformers built against declarations that have since changed.
 */
export function clearTwoslashAccess(): void {
	current = NOT_INSTALLED;
}

/**
 * The transformer for a scope, for the remark plugins.
 *
 * @returns `null` when nothing is installed — an inert build, which registers
 * no environments at all. A `with-api` fence still renders; it just renders
 * without type information, which is the honest answer when the build
 * documents no API.
 */
export function twoslashTransformerFor(apiScope?: string): ShikiTransformer | null {
	return current.transformerFor(apiScope);
}

/** Attribute subsequent Twoslash diagnostics to a source file. */
export function setTwoslashFile(path: string): void {
	current.setCurrentFile(path);
}
