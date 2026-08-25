/**
 * The build's Twoslash type-checking environments, one per distinct compiler
 * configuration.
 *
 * @remarks
 * Replaces `TwoslashManager`, a `private constructor` + `getInstance()`
 * singleton with mutable `environments` / `scopeConfigs` / `defaultConfigKey`
 * and a hand-rolled static `reset()` standing in for layer substitution.
 *
 * Every method is synchronous and total. That is not an oversight: the render
 * pass reads this service from outside any fiber, and a synchronous shape is
 * what lets `twoslash-access.ts` hand those methods straight to the remark
 * plugins without a runtime. See that module for why a runtime-bound accessor
 * is not an option.
 *
 * @packageDocumentation
 */

import type { TwoslashTypesCache } from "@shikijs/twoslash";
import type { VirtualFileSystem } from "@tsdoctor/registry";
import { Context, Layer } from "effect";
import type { ShikiTransformer } from "shiki";
import type { TypeResolutionCompilerOptions } from "../internal-types.js";
import { TwoslashEnvironmentRegistry } from "../twoslash-transformer.js";

/** Everything one Twoslash environment needs to be built. */
export interface RegisterEnvironmentOptions {
	/** Declaration files every code block in this environment is checked against. */
	readonly vfs: VirtualFileSystem;
	/** The configuration to check under; defaults apply when omitted. */
	readonly compilerOptions?: TypeResolutionCompilerOptions | undefined;
	/**
	 * Persisted Twoslash result cache. A hit skips the type-check entirely,
	 * which is ~97% of render-phase code-block time.
	 */
	readonly typesCache?: TwoslashTypesCache | undefined;
}

/** @internal */
export interface TwoslashEnvironmentsShape {
	/**
	 * Build an environment for a configuration, or do nothing if one already
	 * exists for it.
	 *
	 * @remarks
	 * Named for what it does. The method this replaces was `initialize`, called
	 * in a loop, registering-if-absent and early-returning on a key hit — a name
	 * that reads like a once-per-build setup step and is not one.
	 *
	 * Environments are keyed by a fingerprint of the ENCODED compiler options,
	 * so two APIs that spell the same configuration differently share one
	 * environment rather than building two identical ones.
	 */
	readonly registerEnvironment: (options: RegisterEnvironmentOptions) => void;

	/**
	 * Record which configuration an API scope is documented under.
	 *
	 * @remarks
	 * The fingerprint MUST be computed exactly as `registerEnvironment` computes
	 * it. When the two drifted apart once before, every scope lookup missed and
	 * per-scope type-checking silently degraded to build-wide — a 994-test suite
	 * stayed green through it.
	 */
	readonly registerScope: (apiScope: string, compilerOptions: TypeResolutionCompilerOptions) => void;

	/**
	 * The transformer for a scope, or the fallback environment.
	 *
	 * @returns `null` only when no environment has been registered at all — an
	 * inert build, or a `with-api` fence rendered before any API resolved.
	 *
	 * @remarks
	 * An unknown scope falls back to the FIRST environment registered, because a
	 * `with-api` fence can appear on a page outside any documented package's
	 * route and checking it under some configuration beats not checking it. That
	 * fallback is deliberate and it is also this subsystem's most dangerous
	 * behaviour: every scope-routing bug degrades through it invisibly, so a
	 * test that only asserts "a transformer came back" asserts nothing.
	 */
	readonly transformerFor: (apiScope?: string) => ShikiTransformer | null;

	/** Attribute subsequent Twoslash diagnostics to a source file. */
	readonly setCurrentFile: (path: string) => void;

	/** @internal Drive the diagnostic path directly, without Shiki. */
	readonly reportErrorForTest: (error: unknown, code: string, file: string) => void;
}

export class TwoslashEnvironments extends Context.Service<TwoslashEnvironments, TwoslashEnvironmentsShape>()(
	"rspress-plugin-api-extractor/TwoslashEnvironments",
) {
	/**
	 * One environment registry per runtime.
	 *
	 * @remarks
	 * `Layer.sync` rather than `Layer.succeed`: the registry is mutable, and a
	 * `Layer.succeed` would capture a single instance shared by every layer graph
	 * that referenced this const — including, in a test run, every test file in
	 * the process. Building it when the layer builds is what makes substitution
	 * work: a test that wants an isolated registry provides its own layer, which
	 * is what the old static `TwoslashManager.reset()` was standing in for.
	 *
	 * Deliberately NOT `Layer.effect` with a finalizer. The registry holds Shiki
	 * transformers, which the render pass uses AFTER `config()` returns — the same
	 * lifetime constraint the highlighter has, and for the same reason.
	 */
	static readonly layer: Layer.Layer<TwoslashEnvironments> = Layer.sync(this, () => make());
}

const make = (): TwoslashEnvironmentsShape => {
	const registry = new TwoslashEnvironmentRegistry();
	return {
		registerEnvironment: (options) => registry.registerEnvironment(options),
		registerScope: (apiScope, compilerOptions) => registry.registerScope(apiScope, compilerOptions),
		transformerFor: (apiScope) => registry.transformerFor(apiScope),
		setCurrentFile: (path) => registry.setCurrentFile(path),
		reportErrorForTest: (error, code, file) => registry.reportErrorForTest(error, code, file),
	};
};
