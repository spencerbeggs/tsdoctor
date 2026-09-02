/**
 * The compiler options a documentation tool lets reach a virtual TypeScript
 * environment, and the one conversion between the two spellings they arrive in.
 */

import type { ProgrammaticCompilerOptions } from "@effected/tsconfig-json";
import { CompilerOptions, CompilerOptionsFromProgrammatic, TsEnumCodec } from "@effected/tsconfig-json";
import { Result, Schema } from "effect";

const fields = CompilerOptions.schema.fields;

/**
 * The compiler options that may influence how a documentation example
 * type-checks.
 *
 * @remarks
 * Deliberately a **whitelist**, picked from `@effected/tsconfig-json`'s
 * `CompilerOptions` rather than restated. Everything here reaches the
 * TypeScript environment, and passing through options the tool does not
 * understand would let a consumer's unrelated build setting silently change
 * how their examples type-check.
 *
 * Picking from the kit's own field schemas is what keeps this a policy
 * statement rather than a second definition of tsconfig: the accepted values,
 * their spellings and their case-insensitivity are the kit's to own, and this
 * module owns only the choice of WHICH options are in scope.
 *
 * @public
 */
export const TypeResolutionCompilerOptions = Schema.Struct({
	target: fields.target,
	module: fields.module,
	moduleResolution: fields.moduleResolution,
	jsx: fields.jsx,
	lib: fields.lib,
	types: fields.types,
	typeRoots: fields.typeRoots,
	strict: fields.strict,
	skipLibCheck: fields.skipLibCheck,
	esModuleInterop: fields.esModuleInterop,
	allowSyntheticDefaultImports: fields.allowSyntheticDefaultImports,
});

/**
 * The decoded whitelist: canonical tsconfig spellings, every field optional.
 *
 * @public
 */
export type TypeResolutionCompilerOptions = typeof TypeResolutionCompilerOptions.Type;

/** The whitelisted keys, for narrowing a decoded `CompilerOptions`. */
const KEYS = Object.keys(TypeResolutionCompilerOptions.fields) as ReadonlyArray<keyof TypeResolutionCompilerOptions>;

/**
 * Narrow a decoded `CompilerOptions` to the whitelist.
 *
 * @remarks
 * Empty `lib` / `types` arrays are **dropped rather than passed through**:
 * `lib: []` REPLACES the default library set with nothing (arrays are replaced
 * wholesale, not merged), which would type-check every example against no
 * globals at all. An absent key inherits the default; an empty one does not.
 */
const narrow = (decoded: Record<string, unknown>): TypeResolutionCompilerOptions => {
	const out: Record<string, unknown> = {};
	for (const key of KEYS) {
		const value = decoded[key];
		if (value === undefined) continue;
		if (Array.isArray(value) && value.length === 0) continue;
		out[key] = value;
	}
	return out as TypeResolutionCompilerOptions;
};

/**
 * Decode compiler options written in either spelling into the whitelist.
 *
 * @remarks
 * Accepts the tsconfig spelling a user writes (`target: "es2025"`, and
 * case-insensitively `lib: ["ESNext", "DOM"]`) and the programmatic spelling a
 * caller holding `ts.CompilerOptions` has (`target: ts.ScriptTarget.ES2025`),
 * because a consumer configuring a documentation build in TypeScript
 * reasonably produces either.
 *
 * **Fails rather than guesses.** A value with no entry in the enum tables — a
 * numeric target from a future TypeScript, a misspelled module kind — is
 * rejected on the error channel instead of being passed through. Degrading to
 * a default here would type-check every example against a configuration the
 * user did not ask for, and produce confidently wrong output with no error:
 * the failure mode this seam exists to prevent.
 *
 * @public
 */
export const decodeCompilerOptions = (
	input: unknown,
): Result.Result<TypeResolutionCompilerOptions, Schema.SchemaError> =>
	Result.map(Schema.decodeUnknownResult(CompilerOptionsFromProgrammatic)(input), (decoded) =>
		narrow(decoded as Record<string, unknown>),
	);

/**
 * Convert whitelisted options to the numeric-enum form the TypeScript compiler
 * takes.
 *
 * @remarks
 * The ONE conversion site between the tsconfig spelling and the programmatic
 * one. Two consequences follow from it being single:
 *
 * - Any environment fingerprint MUST be computed on the ENCODED value.
 *   Otherwise `{lib:["ESNext"]}` and `{lib:["lib.esnext.d.ts"]}` build two
 *   identical TypeScript environments under different keys.
 * - There is no cast here. The whitelist is a subset of the kit's own
 *   `CompilerOptions`, so it is assignable to the encoder by construction —
 *   which is precisely what a hand-rolled options type could not be.
 *
 * @public
 */
export const toProgrammaticCompilerOptions = (options: TypeResolutionCompilerOptions): ProgrammaticCompilerOptions =>
	TsEnumCodec.encodeCompilerOptions(options);
