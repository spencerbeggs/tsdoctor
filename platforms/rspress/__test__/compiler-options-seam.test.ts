/**
 * The one place the tsconfig JSON spelling of compiler options becomes the
 * programmatic spelling a real compiler accepts.
 *
 * `tsconfig.json` writes `lib: ["ESNext", "DOM"]`; `ts.CompilerOptions` wants
 * lib FILE NAMES (`lib.esnext.d.ts`). `DEFAULT_COMPILER_OPTIONS` is authored in
 * the tsconfig spelling, and a tsconfig discovered from disk arrives already
 * converted by `ts.parseJsonConfigFileContent` — so both forms reach the seam
 * and the conversion has to be idempotent.
 *
 * These tests compile through the REAL compiler rather than asserting an exact
 * `lib` array. Asserting the array is what the pre-existing tests did, and it
 * is precisely why the defect survived: an array can look plausible and still
 * name no file that exists. `getSourceFiles()` containing a `lib.*` entry, and
 * an empty diagnostic list, are facts about whether TypeScript could actually
 * find the standard library.
 *
 * There is no before/after hover comparison available: no runtime path in this
 * repo reaches the broken spelling, because an unscoped code block inherits the
 * first registered environment rather than the raw default. This file carries
 * the whole verification burden for Task 1.2.
 */

import path from "node:path";
import { describe, expect, it } from "@effect/vitest";
import type { ProgrammaticCompilerOptions } from "@effected/tsconfig-json";
import ts from "typescript";
import type { TypeResolutionCompilerOptions } from "../src/internal-types.js";
import { toProgrammaticCompilerOptions } from "../src/twoslash-transformer.js";
import { DEFAULT_COMPILER_OPTIONS, resolveTypeScriptConfig } from "../src/typescript-config.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

/** Compile one source string under `options`, in memory. */
function compile(
	options: ProgrammaticCompilerOptions,
	source: string,
): { libFiles: string[]; diagnostics: readonly ts.Diagnostic[] } {
	const fileName = path.join(projectRoot, "__seam_probe__.ts");
	// No cast: ProgrammaticCompilerOptions is shaped to be ts.CompilerOptions-assignable.
	const compilerOptions: ts.CompilerOptions = options;
	const host = ts.createCompilerHost(compilerOptions, true);
	const originalGetSourceFile = host.getSourceFile.bind(host);
	host.getSourceFile = (name, languageVersion, onError, shouldCreate) =>
		name === fileName
			? ts.createSourceFile(name, source, languageVersion, true)
			: originalGetSourceFile(name, languageVersion, onError, shouldCreate);
	host.fileExists = (name) => (name === fileName ? true : ts.sys.fileExists(name));
	host.readFile = (name) => (name === fileName ? source : ts.sys.readFile(name));

	const program = ts.createProgram([fileName], compilerOptions, host);
	const libFiles = program
		.getSourceFiles()
		.map((f) => path.basename(f.fileName))
		.filter((n) => n.startsWith("lib.") && n.endsWith(".d.ts"));
	return { libFiles, diagnostics: ts.getPreEmitDiagnostics(program) };
}

/** Uses only globals that come from `lib.esnext` — no DOM. */
const CORE_SOURCE = "const xs: Array<string> = []; const p = Promise.resolve(1); void xs; void p;";
/** Uses a DOM global, to pin the promise `DEFAULT_COMPILER_OPTIONS` makes by declaring `DOM`. */
const DOM_SOURCE = "const el: HTMLElement | null = null; void el;";

const fixtureTsconfig = path.join(import.meta.dirname, "__fixtures__", "seam-tsconfig", "tsconfig.json");

describe("toProgrammaticCompilerOptions", () => {
	it("is idempotent — a value already in file-name form survives unchanged", () => {
		const once = toProgrammaticCompilerOptions({ lib: ["lib.esnext.d.ts"] } as TypeResolutionCompilerOptions);
		const twice = toProgrammaticCompilerOptions(once as TypeResolutionCompilerOptions);
		expect(twice.lib).toEqual(once.lib);
	});

	it("converts the tsconfig spelling to lib file names", () => {
		const encoded = toProgrammaticCompilerOptions(DEFAULT_COMPILER_OPTIONS);
		// Not an exact-array assertion — only that every entry names a lib file.
		for (const entry of encoded.lib ?? []) {
			expect(entry).toMatch(/^lib\..*\.d\.ts$/);
		}
	});
});

describe("every resolution path produces options a compiler can use", () => {
	const paths: ReadonlyArray<{ name: string; resolve: () => Promise<TypeResolutionCompilerOptions> }> = [
		{
			name: "no tsconfig and no compilerOptions (the bare default)",
			resolve: () => resolveTypeScriptConfig(projectRoot),
		},
		{
			name: "compilerOptions declaring no lib (default lib survives the merge)",
			resolve: () => resolveTypeScriptConfig(projectRoot, { compilerOptions: { strict: true } }),
		},
		{
			name: "compilerOptions declaring lib in the tsconfig spelling",
			resolve: () => resolveTypeScriptConfig(projectRoot, { compilerOptions: { lib: ["ESNext", "DOM"] } }),
		},
		{
			name: "a tsconfig loader function returning the tsconfig spelling",
			resolve: () => resolveTypeScriptConfig(projectRoot, { tsconfig: async () => ({ lib: ["ESNext", "DOM"] }) }),
		},
		{
			name: "a tsconfig path on disk (already file-name form via parseJsonConfigFileContent)",
			resolve: () => resolveTypeScriptConfig(projectRoot, { tsconfig: fixtureTsconfig }),
		},
	];

	for (const { name, resolve } of paths) {
		it(`loads the standard library: ${name}`, async () => {
			const encoded = toProgrammaticCompilerOptions(await resolve());
			const { libFiles, diagnostics } = compile(encoded, CORE_SOURCE);
			expect(libFiles.length).toBeGreaterThan(0);
			expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))).toEqual([]);
		});
	}

	it("resolves a DOM global on the bare default, which is what declaring DOM promises", async () => {
		const encoded = toProgrammaticCompilerOptions(await resolveTypeScriptConfig(projectRoot));
		const { diagnostics } = compile(encoded, DOM_SOURCE);
		expect(diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "))).toEqual([]);
	});
});
