/* v8 ignore start -- type-only definitions, no runtime code */
import type { ApiModel } from "@microsoft/api-extractor-model";
import type { CompilerOptionsInput, TypeResolutionCompilerOptions, TypeScriptConfig } from "@tsdoctor/vfs";

/**
 * Compiler options relevant to type resolution.
 * Subset of TypeScript's CompilerOptions used by the type registry and Twoslash.
 */

/**
 * Result returned by a model loader function.
 *
 * @public
 */
export interface LoadedModel {
	/** The API model */
	model: ApiModel;

	/** Optional source config returned by the loader */
	source?: import("./schemas/config.js").SourceConfig;
}

/**
 * Package.json structure (partial)
 */
export interface PackageJson {
	name?: string;
	version?: string;
	dependencies?: Record<string, string>;
	devDependencies?: Record<string, string>;
	peerDependencies?: Record<string, string>;
	[key: string]: unknown;
}

/**
 * Re-exported from `@tsdoctor/vfs`, which owns the whitelist as a pick over
 * `@effected/tsconfig-json`'s `CompilerOptions`.
 */
export type { CompilerOptionsInput, TypeResolutionCompilerOptions, TypeScriptConfig };
