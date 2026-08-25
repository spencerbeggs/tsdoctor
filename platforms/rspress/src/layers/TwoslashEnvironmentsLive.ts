import { Layer } from "effect";
import type { TwoslashEnvironmentsShape } from "../services/TwoslashEnvironments.js";
import { TwoslashEnvironments } from "../services/TwoslashEnvironments.js";
import { TwoslashEnvironmentRegistry } from "../twoslash-transformer.js";

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
export const TwoslashEnvironmentsLive: Layer.Layer<TwoslashEnvironments> = Layer.sync(TwoslashEnvironments, () => {
	const registry = new TwoslashEnvironmentRegistry();
	const shape: TwoslashEnvironmentsShape = {
		registerEnvironment: (options) => registry.registerEnvironment(options),
		registerScope: (apiScope, compilerOptions) => registry.registerScope(apiScope, compilerOptions),
		transformerFor: (apiScope) => registry.transformerFor(apiScope),
		setCurrentFile: (path) => registry.setCurrentFile(path),
		reportErrorForTest: (error, code, file) => registry.reportErrorForTest(error, code, file),
	};
	return shape;
});
