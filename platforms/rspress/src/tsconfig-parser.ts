/**
 * Reading a `tsconfig.json` into the compiler options the plugin consumes.
 *
 * @remarks
 * A thin adapter over `@effected/tsconfig-json`'s `TsconfigLoaderSync`, which
 * owns `extends` chain resolution (including package specifiers), JSONC
 * parsing and relative-path handling. This module used to hand-roll all three
 * over TypeScript's `parseJsonConfigFileContent`.
 *
 * **The loader returns the tsconfig SPELLING, not the programmatic one.**
 * `target` is `"es2025"` rather than `ts.ScriptTarget.ES2025`, and `lib` is
 * `["esnext"]` rather than `["lib.esnext.d.ts"]`. That is fine, and it is why
 * the normalization seam had to land first: `toProgrammaticCompilerOptions`
 * (`twoslash-transformer.ts`) converts at ONE place, and
 * {@link TypeResolutionCompilerOptions} accepts both spellings by design. Do
 * not convert here — a second conversion site is exactly the drift that made
 * three of four resolution paths load zero lib files once already.
 *
 * @packageDocumentation
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { TsconfigLoaderSync } from "@effected/tsconfig-json";
import type { TypeResolutionCompilerOptions } from "./internal-types.js";

/**
 * Error thrown when tsconfig.json parsing fails.
 *
 * @remarks
 * Retained as the plugin's own type rather than surfacing the kit's
 * `TsconfigParseError`/`TsconfigExtendsError` directly: `typescript-config.ts`
 * branches on `instanceof TsConfigParseError` to decide whether a failure is
 * already reported, and both kit errors mean the same thing to that caller.
 */
export class TsConfigParseError extends Error {
	constructor(
		public readonly configPath: string,
		message: string,
		public readonly cause?: unknown,
	) {
		super(`Failed to parse tsconfig at ${configPath}: ${message}`);
		this.name = "TsConfigParseError";
	}
}

/**
 * The sync host the kit loader reads through.
 *
 * @remarks
 * `node:path` satisfies `SyncPath` verbatim. The filesystem half is two
 * functions, so no shim module is needed.
 */
const syncHost = {
	fileSystem: {
		exists: existsSync,
		readFile: (filePath: string): string => readFileSync(filePath, "utf8"),
	},
	path,
} as const;

/**
 * Parse a `tsconfig.json` and extract the compiler options used for type
 * resolution.
 *
 * @param configPath - Path to tsconfig.json (relative or absolute)
 * @param projectRoot - Project root directory for resolving relative paths
 * @returns The declared compiler options, in the tsconfig spelling
 * @throws TsConfigParseError if the config cannot be read or parsed
 *
 * @example
 * ```ts
 * const options = parseTsConfig("tsconfig.json", "/path/to/project");
 * // Returns: { target: "es2025", module: "nodenext", lib: ["esnext"], ... }
 * ```
 */
export function parseTsConfig(configPath: string, projectRoot: string): TypeResolutionCompilerOptions {
	const absolutePath = path.isAbsolute(configPath) ? configPath : path.resolve(projectRoot, configPath);

	if (!existsSync(absolutePath)) {
		throw new TsConfigParseError(absolutePath, "File not found");
	}

	let options: Record<string, unknown>;
	try {
		options = TsconfigLoaderSync.compilerOptions(absolutePath, syncHost) as unknown as Record<string, unknown>;
	} catch (error) {
		throw new TsConfigParseError(absolutePath, error instanceof Error ? error.message : String(error), error);
	}

	return extractTypeResolutionOptions(options);
}

/**
 * Narrow the full compiler options to the ones the plugin actually consumes.
 *
 * @remarks
 * Deliberately a whitelist. Everything here reaches Twoslash's TypeScript
 * environment, and passing through options the plugin does not understand
 * would let a consumer's unrelated build setting change how examples
 * type-check.
 */
function extractTypeResolutionOptions(options: Record<string, unknown>): TypeResolutionCompilerOptions {
	const result: TypeResolutionCompilerOptions = {};

	// The loader reports these in the tsconfig spelling; the type accepts both,
	// and the seam converts. A number would be a caller-supplied programmatic
	// value, which is equally valid.
	const scalar = (value: unknown): string | number | undefined =>
		typeof value === "string" || typeof value === "number" ? value : undefined;

	const target = scalar(options.target);
	if (target !== undefined) result.target = target;
	const module_ = scalar(options.module);
	if (module_ !== undefined) result.module = module_;
	const moduleResolution = scalar(options.moduleResolution);
	if (moduleResolution !== undefined) result.moduleResolution = moduleResolution;
	const jsx = scalar(options.jsx);
	if (jsx !== undefined) result.jsx = jsx;

	if (typeof options.strict === "boolean") result.strict = options.strict;
	if (typeof options.skipLibCheck === "boolean") result.skipLibCheck = options.skipLibCheck;
	if (typeof options.esModuleInterop === "boolean") result.esModuleInterop = options.esModuleInterop;
	if (typeof options.allowSyntheticDefaultImports === "boolean") {
		result.allowSyntheticDefaultImports = options.allowSyntheticDefaultImports;
	}

	// Empty arrays are dropped rather than passed through: `lib: []` would
	// REPLACE the default library set with nothing (see the note on
	// TypeResolutionCompilerOptions.lib), type-checking every example against no
	// globals at all.
	if (Array.isArray(options.lib) && options.lib.length > 0) result.lib = options.lib.map(String);
	if (Array.isArray(options.types) && options.types.length > 0) result.types = options.types.map(String);

	return result;
}
