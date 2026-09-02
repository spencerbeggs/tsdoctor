import type { PathLike } from "node:fs";
import { TsConfigParseError, parseTsConfig } from "./TsconfigParser.js";
import type { TypeResolutionCompilerOptions } from "./TypeResolutionOptions.js";
import { decodeCompilerOptions } from "./TypeResolutionOptions.js";

/**
 * How a caller points at TypeScript configuration: a `tsconfig.json`, inline
 * compiler options, or both.
 *
 * @remarks
 * When both are given the tsconfig is loaded first and the inline options merge
 * on top, so a caller can adopt a project's configuration and override one
 * field without restating it.
 *
 * @public
 */
export interface TypeScriptConfig {
	/**
	 * A `tsconfig.json` path, or a function returning compiler options.
	 *
	 * @remarks
	 * The function's options are **user input**, so they are typed loosely and
	 * decoded rather than trusted: a caller writing configuration in TypeScript
	 * may reasonably return either the tsconfig spelling (`target: "es2025"`) or
	 * the programmatic one (`target: ts.ScriptTarget.ES2025`).
	 */
	tsconfig?: PathLike | (() => Promise<CompilerOptionsInput>);
	/** User-supplied compiler options, in either spelling. Decoded, not trusted. */
	compilerOptions?: CompilerOptionsInput;
}

/**
 * Compiler options as a user may write them, before decoding.
 *
 * @remarks
 * Deliberately loose. `@tsdoctor/vfs`'s `decodeCompilerOptions` is what turns
 * this into a `TypeResolutionCompilerOptions`, accepting either spelling
 * and REJECTING a value it cannot map rather than passing it through. This type
 * exists so the untrusted shape and the decoded one cannot be confused at a
 * call site — the previous single type was both, and user input reached the
 * compiler through a cast.
 *
 * @public
 */
export type CompilerOptionsInput = Readonly<Record<string, unknown>>;

import { Result } from "effect";

/**
 * Default TypeScript compiler options for Twoslash and type resolution.
 *
 * These defaults are optimized for documentation:
 * - Modern ES targets (ESNext)
 * - Bundler module resolution for broad compatibility
 * - Lenient settings (non-strict) since docs often show simplified examples
 * - Skip lib checks for faster processing
 *
 * @remarks
 * Numeric values correspond to TypeScript enums:
 * - target: 99 = ESNext
 * - module: 99 = ESNext
 * - moduleResolution: 100 = Bundler
 *
 * @public
 */
export const DEFAULT_COMPILER_OPTIONS: TypeResolutionCompilerOptions = {
	target: "esnext",
	module: "esnext",
	moduleResolution: "bundler",
	lib: ["esnext", "dom"],
	strict: false, // Lenient for documentation examples
	skipLibCheck: true, // Faster processing
	esModuleInterop: true,
	allowSyntheticDefaultImports: true,
};

/**
 * Merge two TypeResolutionCompilerOptions objects.
 * Properties from `override` take precedence over `base`.
 *
 * @param base - Base compiler options
 * @param override - Options to merge on top (takes precedence)
 * @returns Merged options
 *
 * @example
 * ```ts
 * const base = { target: 99, lib: ["ESNext"] };
 * const override = { lib: ["ESNext", "DOM"], strict: true };
 * const merged = mergeCompilerOptions(base, override);
 * // Result: { target: 99, lib: ["ESNext", "DOM"], strict: true }
 * ```
 */
/**
 * Decode user-supplied compiler options, failing loudly.
 *
 * @remarks
 * The values reaching here are whatever a consumer wrote in their config, in
 * either spelling. A value the enum tables cannot map is REJECTED rather than
 * passed through: degrading to a default would type-check every example
 * against a configuration the user did not ask for, and say nothing about it.
 * `layers/type-environment.ts` turns this throw into a `ConfigValidationError`,
 * which reaches the `issues.json` artifact.
 */
function decodeInput(input: CompilerOptionsInput, source: string): TypeResolutionCompilerOptions {
	const decoded = decodeCompilerOptions(input);
	if (Result.isFailure(decoded)) {
		throw new TsConfigParseError(source, decoded.failure.message, decoded.failure);
	}
	return decoded.success;
}

/**
 * Merge one set of compiler options over another, later winning per key.
 *
 * @remarks
 * Arrays (`lib`, `types`) are REPLACED wholesale rather than concatenated,
 * matching TypeScript's own `extends` semantics: declaring `lib` means "these
 * libraries", not "these as well as the defaults".
 *
 * @param base - the options to start from
 * @param override - the options to layer on top, or `undefined` for a copy of `base`
 * @returns a new object; neither argument is mutated
 *
 * @public
 */
export function mergeCompilerOptions(
	base: TypeResolutionCompilerOptions,
	override: TypeResolutionCompilerOptions | undefined,
): TypeResolutionCompilerOptions {
	if (!override) {
		return { ...base };
	}

	// Arrays (`lib`, `types`) are REPLACED, never concatenated — see the note on
	// TypeResolutionCompilerOptions. Both sides are already decoded, so every key
	// present here is whitelisted by construction.
	const merged: Record<string, unknown> = { ...base };
	for (const [key, value] of Object.entries(override)) {
		if (value !== undefined) merged[key] = value;
	}

	return merged as TypeResolutionCompilerOptions;
}

/**
 * Resolve a single TypeScriptConfig to compiler options (sync version).
 * Only handles path-based tsconfig - use resolveTypeScriptConfigSingleAsync for function-based.
 *
 * Follows the priority cascade:
 * 1. Parse tsconfig.json if specified (path only, not function)
 * 2. Merge compilerOptions on top
 *
 * @param config - TypeScript config with optional tsconfig path and/or compilerOptions
 * @param projectRoot - Project root for resolving relative tsconfig paths
 * @returns Resolved compiler options (not merged with defaults)
 *
 * @example
 * ```ts
 * // Just tsconfig
 * resolveTypeScriptConfigSingle({ tsconfig: "tsconfig.json" }, "/project");
 *
 * // Just compilerOptions
 * resolveTypeScriptConfigSingle({ compilerOptions: { target: "esnext" } }, "/project");
 *
 * // Both (compilerOptions override tsconfig)
 * resolveTypeScriptConfigSingle({
 *   tsconfig: "tsconfig.json",
 *   compilerOptions: { strict: false }
 * }, "/project");
 * ```
 *
 * @public
 */
export function resolveTypeScriptConfigSingle(
	config: TypeScriptConfig | undefined,
	projectRoot: string,
): TypeResolutionCompilerOptions {
	if (!config) {
		return {};
	}

	let options: TypeResolutionCompilerOptions = {};

	// 1. Parse tsconfig if specified (path only, skip functions)
	if (config.tsconfig && typeof config.tsconfig !== "function") {
		const tsconfigPath = String(config.tsconfig);
		try {
			options = parseTsConfig(tsconfigPath, projectRoot);
		} catch (error) {
			if (error instanceof TsConfigParseError) {
				// Re-throw with clear context
				throw error;
			}
			throw new TsConfigParseError(tsconfigPath, error instanceof Error ? error.message : String(error), error);
		}
	}

	// 2. Merge compilerOptions on top, decoding the user's spelling first
	if (config.compilerOptions) {
		options = mergeCompilerOptions(options, decodeInput(config.compilerOptions, "compilerOptions"));
	}

	return options;
}

/**
 * Resolve a single TypeScriptConfig to compiler options (async version).
 * Handles both path-based and function-based tsconfig.
 *
 * Follows the priority cascade:
 * 1. Load tsconfig (from path or function)
 * 2. Merge compilerOptions on top
 *
 * @param config - TypeScript config with optional tsconfig path/function and/or compilerOptions
 * @param projectRoot - Project root for resolving relative tsconfig paths
 * @returns Promise resolving to compiler options (not merged with defaults)
 *
 * @example
 * ```ts
 * // Path-based tsconfig
 * await resolveTypeScriptConfigSingleAsync({ tsconfig: "tsconfig.json" }, "/project");
 *
 * // Function-based tsconfig
 * await resolveTypeScriptConfigSingleAsync({
 *   tsconfig: async () => ({ target: 99, lib: ["ESNext"] })
 * }, "/project");
 *
 * // Both (compilerOptions override tsconfig)
 * await resolveTypeScriptConfigSingleAsync({
 *   tsconfig: async () => ({ target: 99 }),
 *   compilerOptions: { strict: false }
 * }, "/project");
 * ```
 *
 * @public
 */
export async function resolveTypeScriptConfigSingleAsync(
	config: TypeScriptConfig | undefined,
	projectRoot: string,
): Promise<TypeResolutionCompilerOptions> {
	if (!config) {
		return {};
	}

	let options: TypeResolutionCompilerOptions = {};

	// 1. Load tsconfig (from path or function)
	if (config.tsconfig) {
		if (typeof config.tsconfig === "function") {
			// Async function - call it, then decode what it returned
			options = decodeInput(await config.tsconfig(), "tsconfig()");
		} else {
			// Path - parse the tsconfig file
			const tsconfigPath = String(config.tsconfig);
			try {
				options = parseTsConfig(tsconfigPath, projectRoot);
			} catch (error) {
				if (error instanceof TsConfigParseError) {
					throw error;
				}
				throw new TsConfigParseError(tsconfigPath, error instanceof Error ? error.message : String(error), error);
			}
		}
	}

	// 2. Merge compilerOptions on top, decoding the user's spelling first
	if (config.compilerOptions) {
		options = mergeCompilerOptions(options, decodeInput(config.compilerOptions, "compilerOptions"));
	}

	return options;
}

/**
 * Resolve TypeScript compiler options from a cascade of configurations (async).
 *
 * Resolution order (later levels override earlier):
 * 1. DEFAULT_COMPILER_OPTIONS (sensible defaults)
 * 2. Global config
 * 3. API-level config
 *
 * At each level, if a TypeScriptConfig has both `tsconfig` and `compilerOptions`,
 * the tsconfig is loaded first, then compilerOptions are merged on top.
 *
 * @param projectRoot - Project root directory for resolving relative paths
 * @param global - Global plugin TypeScript configuration
 * @param api - API-level TypeScript configuration
 * @returns Promise resolving to fully resolved compiler options
 *
 * @example
 * ```ts
 * // Simple global config
 * const options = await resolveTypeScriptConfig("/project", {
 *   tsconfig: "tsconfig.json"
 * });
 *
 * // With async tsconfig loader
 * const options = await resolveTypeScriptConfig("/project", {
 *   tsconfig: async () => ({ target: 99, lib: ["ESNext"] })
 * });
 *
 * // With API override
 * const options = await resolveTypeScriptConfig(
 *   "/project",
 *   { tsconfig: "tsconfig.json" },
 *   { compilerOptions: { strict: false } }
 * );
 * ```
 *
 * @public
 */
export async function resolveTypeScriptConfig(
	projectRoot: string,
	global?: TypeScriptConfig,
	api?: TypeScriptConfig,
): Promise<TypeResolutionCompilerOptions> {
	// 1. Start with defaults
	let options = { ...DEFAULT_COMPILER_OPTIONS };

	// 2. Apply global config
	const globalOptions = await resolveTypeScriptConfigSingleAsync(global, projectRoot);
	options = mergeCompilerOptions(options, globalOptions);

	// 3. Apply API-level config
	const apiOptions = await resolveTypeScriptConfigSingleAsync(api, projectRoot);
	options = mergeCompilerOptions(options, apiOptions);

	return options;
}
