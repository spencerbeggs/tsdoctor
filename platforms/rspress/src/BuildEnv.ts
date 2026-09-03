/**
 * Per-build configuration, as `Context.Reference` values rather than threaded
 * parameters.
 *
 * @remarks
 * Each of these used to travel by hand. `thresholds` made a four-hop journey —
 * `plugin.ts` → `ConfigService.layer`'s fourth constructor argument →
 * a `ResolvedBuildContext` field → destructured in `build-program.ts` → every
 * `withPhase` call — while `obs.thresholds` already held the same value one
 * scope away. `buildId` was worse: 24 event emit sites wrote
 * `ctx: { buildId: "" }` because the value was not reachable from where they
 * stood, and in `TypeRegistryService.layer` it genuinely was not — that layer is
 * module-level and has no build to name. A Reference is the fix precisely
 * because it reaches module-level code that no parameter can.
 *
 * A `Context.Reference` carries a default, so nothing has to provide these for
 * a program to run. That is convenient and it is also the hazard: a wiring
 * mistake does not fail, it silently substitutes the default. The tests for
 * this module provide NON-default values and assert the provided value is the
 * one observed, which is the only way to tell the two apart.
 *
 * @packageDocumentation
 */

import { Context } from "effect";
import type { ResolvedObservability } from "./schemas/observability.js";

/**
 * Identifier correlating every event emitted by one build.
 *
 * @remarks
 * The empty-string default is deliberate: an event emitted outside a build —
 * a test, a stray sync callback — is better tagged empty than crashing. Every
 * production path provides a real id.
 */
export const BuildId = Context.Reference<string>("rspress-plugin-api-extractor/BuildId", {
	defaultValue: () => "",
});

/** Duration thresholds above which an operation is reported as slow. */
export const Thresholds = Context.Reference<ResolvedObservability["thresholds"]>(
	"rspress-plugin-api-extractor/Thresholds",
	{
		defaultValue: () => ({
			slowCodeBlock: 100,
			slowPageGeneration: 500,
			slowApiLoad: 1000,
			slowFileOperation: 50,
			slowDbOperation: 100,
		}),
	},
);

/**
 * How many pages the build pipeline generates concurrently.
 *
 * @remarks
 * Defaults to the CPU count, which is what `ConfigService.layer` computed
 * inline. Kept a Reference rather than a constant so a consumer with a
 * constrained CI runner can lower it without a code change.
 */
export const PageConcurrency = Context.Reference<number>("rspress-plugin-api-extractor/PageConcurrency", {
	defaultValue: () => 1,
});

/** Whether Twoslash diagnostics inside `@example` blocks are suppressed. */
export const SuppressExampleErrors = Context.Reference<boolean>("rspress-plugin-api-extractor/SuppressExampleErrors", {
	defaultValue: () => true,
});
