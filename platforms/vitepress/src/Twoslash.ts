/**
 * The Twoslash code transformer: `@shikijs/vitepress-twoslash`'s
 * `transformerTwoslash` over the build's combined virtual file system,
 * compiler options from the `@tsdoctor/vfs` seam and the shared result
 * cache, for VitePress's `markdown.codeTransformers`.
 *
 * @remarks
 * The declarations ride in as `extraFiles`, not `fsMap`. Twoslash treats a
 * supplied `fsMap` as the ENTIRE file system — it switches the local
 * `node_modules` overlay off — so handing it the combined VFS alone would
 * drop every `lib.*.d.ts` and type-check against nothing. `extraFiles` is
 * overlaid on the compiler's own libs, which is how the RSPress plugin builds
 * the same environment; "the same VFS and compiler options" means the same
 * overlay.
 *
 * `explicitTrigger` is left at VitePress's default (`true`), so only fences
 * carrying the `twoslash` meta are type-checked and nothing else in the site
 * is touched.
 *
 * @packageDocumentation
 */

import type { TwoslashTypesCache } from "@shikijs/twoslash";
import { transformerTwoslash } from "@shikijs/vitepress-twoslash";
import type { TypeResolutionCompilerOptions, Vfs } from "@tsdoctor/vfs";
import { DEFAULT_COMPILER_OPTIONS, toProgrammaticCompilerOptions, twoslashEnvHash } from "@tsdoctor/vfs";
import type { ShikiTransformer } from "shiki";
import ts from "typescript";

/**
 * Everything one Twoslash transformer needs.
 *
 * @public
 */
export interface TwoslashTransformerOptions {
	/** Declaration files every code block is checked against. */
	readonly vfs: Vfs;
	/** The configuration to check under; defaults apply when omitted. */
	readonly compilerOptions?: TypeResolutionCompilerOptions | undefined;
	/** The persisted result cache; a hit skips the type-check entirely. */
	readonly typesCache?: TwoslashTypesCache | undefined;
}

/**
 * Fingerprint the type environment: the declarations plus the compiler that
 * interprets them, so a generation cached by one TypeScript is never served
 * by another.
 *
 * @public
 */
export function environmentHash(vfs: Vfs): string {
	return twoslashEnvHash(vfs, `typescript@${ts.version}`);
}

/**
 * Build the Shiki transformer for VitePress's `markdown.codeTransformers`.
 *
 * @remarks
 * Errors never throw: `noErrorValidation` lets a diagnostic render as an
 * annotation, and `throws: false` keeps `@shikijs/vitepress-twoslash` from
 * failing the build on one (it would, by default, on CI). Examples are
 * documentation, not a test suite.
 *
 * @public
 */
export function makeTwoslashTransformer(options: TwoslashTransformerOptions): ShikiTransformer {
	const extraFiles: Record<string, string> = {};
	for (const [path, content] of options.vfs.entries()) extraFiles[path] = content;
	const compilerOptions = toProgrammaticCompilerOptions(options.compilerOptions ?? DEFAULT_COMPILER_OPTIONS);
	return transformerTwoslash({
		...(options.typesCache != null ? { typesCache: options.typesCache } : {}),
		twoslashOptions: {
			extraFiles,
			compilerOptions,
			handbookOptions: { noErrorValidation: true },
		},
		throws: false,
	});
}
