/* v8 ignore start -- type-only definitions, no runtime code */
import type { PathLike } from "node:fs";
import type { ApiModel } from "@microsoft/api-extractor-model";
import type ts from "typescript";

/**
 * Compiler options relevant to type resolution.
 * Subset of TypeScript's CompilerOptions used by the type registry and Twoslash.
 */
export interface TypeResolutionCompilerOptions {
	/**
	 * Both spellings are accepted and normalized, exactly as {@link lib} is: the
	 * tsconfig form (`"es2025"`) and the programmatic enum
	 * (`ts.ScriptTarget.ES2025`). `tsconfig-parser.ts` produces the former
	 * because the kit loader reports what the file declares; a caller passing
	 * `compilerOptions` inline may use either. Conversion happens once, at
	 * `toProgrammaticCompilerOptions` in `twoslash-transformer.ts`.
	 */
	target?: ts.ScriptTarget | string;
	/** Both spellings, as {@link target}. */
	module?: ts.ModuleKind | string;
	/** Both spellings, as {@link target}. */
	moduleResolution?: ts.ModuleResolutionKind | string;
	/**
	 * Standard libraries to load. Both spellings are accepted and normalized:
	 * the tsconfig form (`["ESNext", "DOM"]`) and the file-name form
	 * (`["lib.esnext.d.ts"]`). Conversion happens once, at
	 * `toProgrammaticCompilerOptions` in `twoslash-transformer.ts`.
	 *
	 * Defaults to `["ESNext", "DOM"]`.
	 *
	 * @remarks
	 * Declaring `lib` REPLACES the default array wholesale rather than merging
	 * with it (see `mergeCompilerOptions`). That is the surprising part: a
	 * discovered `tsconfig.json` saying `lib: ["esnext"]` yields exactly that
	 * and no DOM, so every `fromDir` site whose tsconfig declares `lib` gets no
	 * DOM globals regardless of this default. Add `DOM` to that tsconfig if its
	 * examples need it.
	 */
	lib?: string[];
	types?: string[];
	typeRoots?: string[];
	strict?: boolean;
	skipLibCheck?: boolean;
	esModuleInterop?: boolean;
	allowSyntheticDefaultImports?: boolean;
	/** Both spellings, as {@link target}. */
	jsx?: ts.JsxEmit | string;
}

/**
 * TypeScript configuration fields for Twoslash and type resolution.
 * Used internally by the resolution functions.
 * @internal
 */
export interface TypeScriptConfig {
	tsconfig?: PathLike | (() => Promise<TypeResolutionCompilerOptions>);
	compilerOptions?: TypeResolutionCompilerOptions;
}

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
