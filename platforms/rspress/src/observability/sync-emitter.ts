/**
 * The one bridge from synchronous, fiber-less code to the EventBus.
 *
 * @remarks
 * Seven modules run outside any Effect fiber — remark visitors, Shiki's
 * `preprocess` hook, Prettier callbacks, the page-generation stages — and each
 * carried its own byte-identical copy of this seam: a module-level
 * `emitEvent`, a module-level `currentBuildId`, and a `setXEventEmitter(fn,
 * buildId)` for `plugin.ts` to call. Two of them had already grown a third
 * parameter for `slowCodeBlockMs`, which is how a duplicated seam decays: the
 * copies stop being identical one caller at a time.
 *
 * The seam itself is forced. The duplication was not, and neither was the
 * threading: every value those setters carried is now a `Context.Reference`
 * read from the runtime, so the signature is one runtime and nothing else.
 *
 * **The runtime handed here must be synchronously buildable.** `runSync`
 * builds the runtime's layer before running anything, so a runtime whose layer
 * opens a database fails with `AsyncFiberError` at the first emit — from a
 * remark plugin, during RSPress's render pass, invisible to every unit test.
 * `plugin.ts` builds a small observability-only runtime for exactly this
 * reason.
 *
 * @packageDocumentation
 */

import { Effect } from "effect";
import { BuildId, Thresholds } from "../BuildEnv.js";
import { emit } from "./EventBus.js";
import type { PluginEvent } from "./events.js";

/** Reads the References the sync islands need, once, at install time. */
interface SyncEnv {
	readonly emit: (event: PluginEvent) => void;
	readonly buildId: string;
	readonly slowCodeBlockMs: number;
}

const NOOP: SyncEnv = {
	emit: () => {},
	buildId: "",
	slowCodeBlockMs: Number.POSITIVE_INFINITY,
};

let current: SyncEnv = NOOP;

/**
 * Bind the sync islands to a runtime.
 *
 * @remarks
 * Call once, immediately after constructing the observability runtime. The
 * References are read here rather than per emit: an emit happens per code
 * block on a large site, and these values are fixed for the build.
 */
export function installSyncEmitter(runtime: { readonly runSync: <A>(effect: Effect.Effect<A>) => A }): void {
	const env = runtime.runSync(
		Effect.gen(function* () {
			return {
				buildId: yield* BuildId,
				slowCodeBlockMs: (yield* Thresholds).slowCodeBlock,
			};
		}),
	);
	current = {
		emit: (event) => runtime.runSync(emit(event)),
		buildId: env.buildId,
		slowCodeBlockMs: env.slowCodeBlockMs,
	};
}

/**
 * Install a plain capturing function, bypassing the runtime.
 *
 * @remarks
 * For tests that assert on emitted events without standing up an EventBus.
 * Production always goes through {@link installSyncEmitter}, which reads the
 * build id and thresholds from the runtime's References — this variant takes
 * them directly because a test that wants a specific build id should say so.
 *
 * @internal
 */
export function installSyncEmitterUnsafe(
	fn: (event: PluginEvent) => void,
	options?: { readonly buildId?: string; readonly slowCodeBlockMs?: number },
): void {
	current = {
		emit: fn,
		buildId: options?.buildId ?? "",
		slowCodeBlockMs: options?.slowCodeBlockMs ?? Number.POSITIVE_INFINITY,
	};
}

/** Reset to the no-op bridge. Tests, and teardown between builds. */
export function clearSyncEmitter(): void {
	current = NOOP;
}

/** Emit an event from synchronous code. A no-op when nothing is installed. */
export function emitSync(event: PluginEvent): void {
	current.emit(event);
}

/** The current build's id, for a sync site assembling an `EventContext`. */
export function syncBuildId(): string {
	return current.buildId;
}

/**
 * The slow-code-block threshold, for the two remark plugins that time blocks.
 *
 * @remarks
 * The only piece of configuration a sync island needs beyond the build id, and
 * the reason the old seams had begun growing divergent signatures.
 */
export function syncSlowCodeBlockMs(): number {
	return current.slowCodeBlockMs;
}
