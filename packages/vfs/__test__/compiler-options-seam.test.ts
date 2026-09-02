/**
 * The compiler-options seam: the ONE place the tsconfig spelling and the
 * programmatic spelling meet.
 *
 * @remarks
 * This seam has produced a silent defect before. When compiler options reached
 * the TypeScript environment in the wrong spelling, three of four resolution
 * paths loaded zero lib files — and because `noErrorValidation` swallows the
 * diagnostics, nothing appeared in any artifact. The tell was degraded hovers
 * (`const filtered: {}` instead of `number[]`), not an error. So these tests
 * assert the CONVERSION, not merely that a call returns something.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { TypeResolutionCompilerOptions } from "../src/index.js";
import { decodeCompilerOptions, toProgrammaticCompilerOptions } from "../src/index.js";

const ok = (input: unknown): TypeResolutionCompilerOptions => {
	const result = decodeCompilerOptions(input);
	if (result._tag === "Failure") throw new Error(`expected success, got ${String(result.failure)}`);
	return result.success;
};

describe("decodeCompilerOptions accepts both spellings", () => {
	it("decodes the tsconfig spelling a user writes", () => {
		expect(ok({ target: "es2025", module: "nodenext", strict: true })).toEqual({
			target: "es2025",
			module: "nodenext",
			strict: true,
		});
	});

	it("decodes the programmatic spelling a caller holding ts.CompilerOptions has", () => {
		// ts.ScriptTarget.ES2025 === 12, ts.ModuleKind.NodeNext === 199.
		expect(ok({ target: 12, module: 199 })).toEqual({ target: "es2025", module: "nodenext" });
	});

	it("accepts lib case-insensitively, including the documented default", () => {
		// ["ESNext", "DOM"] is the exact spelling of DEFAULT_COMPILER_OPTIONS.
		// A literal-union input type would have rejected it.
		expect(ok({ lib: ["ESNext", "DOM"] }).lib).toEqual(["esnext", "dom"]);
	});

	it("accepts the file-name lib spelling and normalizes it", () => {
		expect(ok({ lib: ["lib.esnext.d.ts"] }).lib).toEqual(["esnext"]);
	});

	it("is idempotent on already-decoded options", () => {
		const once = ok({ target: 12, lib: ["ESNext", "DOM"] });
		expect(ok(once)).toEqual(once);
	});
});

describe("decodeCompilerOptions fails rather than guessing", () => {
	// Degrading to a default here would type-check every example against a
	// configuration the user did not ask for, and say nothing about it.
	it.each([
		["an unmappable numeric target", { target: 99999 }],
		["a misspelled target", { target: "es2026-ish" }],
		["a misspelled module kind", { module: "commonjsx" }],
	])("rejects %s", (_label, input) => {
		expect(decodeCompilerOptions(input)._tag).toBe("Failure");
	});
});

describe("the whitelist", () => {
	it("drops options outside it", () => {
		// `declaration` is a real tsconfig option and deliberately not in scope:
		// a consumer's unrelated build setting must not change how examples
		// type-check.
		const decoded = ok({ strict: true, declaration: true, removeComments: true });
		expect(decoded).toEqual({ strict: true });
	});

	it("drops empty lib and types arrays rather than passing them through", () => {
		// `lib: []` REPLACES the default library set with nothing — every example
		// would type-check against no globals at all. Absent inherits the default;
		// empty does not.
		expect(ok({ lib: [], types: [], strict: true })).toEqual({ strict: true });
	});
});

describe("toProgrammaticCompilerOptions", () => {
	it("encodes to the numeric-enum form the compiler takes", () => {
		expect(toProgrammaticCompilerOptions(ok({ target: "es2025", module: "nodenext" }))).toMatchObject({
			target: 12,
			module: 199,
		});
	});

	it("round-trips a programmatic input back to itself", () => {
		const input = { target: 12, module: 199, lib: ["lib.esnext.d.ts"] };
		expect(toProgrammaticCompilerOptions(ok(input))).toMatchObject(input);
	});

	it("emits lib in the file-name form, which is what the environment needs", () => {
		// The defect this seam exists to prevent: a `lib` that never reaches the
		// compiler in a form it can load leaves the example with no globals.
		expect(toProgrammaticCompilerOptions(ok({ lib: ["ESNext", "DOM"] })).lib).toEqual([
			"lib.esnext.d.ts",
			"lib.dom.d.ts",
		]);
	});
});

describe("the seam does not load the TypeScript compiler", () => {
	// Inherited from the adapter's config-helpers import-graph test, which used
	// to guard this while the parser lived there. `ApiExtractorPlugin.api.fromDir`
	// is called from rspress.config.ts, which every RSPress command evaluates —
	// a value import of `typescript` in that graph loads the whole compiler to
	// read three files off disk. `import type` is erased and stays allowed.
	it.each(["TsconfigParser.ts", "TypeResolutionOptions.ts"])("%s has no value import of typescript", (file) => {
		const source = fs.readFileSync(path.resolve(import.meta.dirname, "../src", file), "utf8");
		const valueImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"typescript"/gm)];
		expect(valueImports).toEqual([]);
	});
});
