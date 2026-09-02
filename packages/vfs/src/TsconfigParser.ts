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
import { Result } from "effect";
import type { TypeResolutionCompilerOptions } from "./TypeResolutionOptions.js";
import { decodeCompilerOptions } from "./TypeResolutionOptions.js";

/**
 * Error thrown when tsconfig.json parsing fails.
 *
 * @remarks
 * Retained as the plugin's own type rather than surfacing the kit's
 * `TsconfigParseError`/`TsconfigExtendsError` directly: the adapter's
 * `typescript-config.ts` branches on `instanceof TsConfigParseError` to decide
 * whether a failure is already reported, and both kit errors mean the same
 * thing to that caller. It now also carries a decode failure from
 * {@link decodeCompilerOptions}, which is the same thing again: a tsconfig
 * this tool cannot act on.
 *
 * @public
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
 *
 * @public
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

	const decoded = decodeCompilerOptions(options);
	if (Result.isFailure(decoded)) {
		throw new TsConfigParseError(absolutePath, decoded.failure.message, decoded.failure);
	}
	return decoded.success;
}
