import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import { CodeText, Example } from "../src/Blocks.js";
import {
	ExampleFormatError,
	buildExample,
	codeText,
	formatExampleCode,
	prepareExampleCode,
	prependHiddenImports,
	stripTwoslashDirectives,
} from "../src/Examples.js";

describe("Examples.prepareExampleCode", () => {
	it("prepends the package import and @noErrors for TypeScript", () => {
		const prepared = prepareExampleCode({ language: "ts", code: "const x = foo();" }, "foo", "@scope/pkg");
		expect(prepared).toEqual({
			code: '// @noErrors\nimport { foo } from "@scope/pkg";\nconst x = foo();',
			isTypeScript: true,
			language: "typescript",
		});
	});

	it("does not duplicate an import the example already carries, either quote style", () => {
		const single = prepareExampleCode(
			{ language: "js", code: "import { foo } from '@scope/pkg';\nfoo();" },
			"foo",
			"@scope/pkg",
			false,
		);
		expect(single.code).toBe("import { foo } from '@scope/pkg';\nfoo();");
		const double = prepareExampleCode(
			{ language: "typescript", code: 'import { foo } from "@scope/pkg";' },
			"foo",
			"@scope/pkg",
			false,
		);
		expect(double.code).toBe('import { foo } from "@scope/pkg";');
	});

	it("passes a non-TypeScript example through untouched", () => {
		expect(prepareExampleCode({ language: "bash", code: "ls" }, "foo", "pkg")).toEqual({
			code: "ls",
			isTypeScript: false,
			language: "bash",
		});
	});
});

describe("Examples.stripTwoslashDirectives", () => {
	it("removes config and annotation directives", () => {
		expect(stripTwoslashDirectives("// @noErrors\nconst x = 1;\n//    ^?\n// @errors: 2304")).toBe("const x = 1;");
	});

	it("cuts everything up to and including ---cut---, and after ---cut-after---", () => {
		expect(
			stripTwoslashDirectives(
				'import type { X } from "y";\n// ---cut---\nconst a = 1;\n// ---cut-after---\nconst b = 2;',
			),
		).toBe("const a = 1;");
	});

	it("removes a cut-start/cut-end range, also after a preceding cut-before", () => {
		const code = "hidden\n//---cut---\nkeep1\n// ---cut-start---\ngone\n// ---cut-end---\nkeep2";
		expect(stripTwoslashDirectives(code)).toBe("keep1\nkeep2");
	});
});

describe("Examples.prependHiddenImports", () => {
	it("prepends formatted imports followed by a cut marker", () => {
		const out = prependHiddenImports("function foo(): X", [
			{ packageName: "y", symbols: new Set(["X"]), typeOnly: true },
		]);
		expect(out).toBe('import type { X } from "y";\n// ---cut---\nfunction foo(): X');
	});

	it("returns the code unchanged with no imports", () => {
		expect(prependHiddenImports("code", [])).toBe("code");
	});
});

describe("Examples.codeText", () => {
	it("produces both spellings from one source", () => {
		const source = 'import type { X } from "y";\n// ---cut---\nconst x: X = 1;';
		expect(codeText(source)).toEqual(CodeText.make({ display: "const x: X = 1;", source }));
	});
});

describe("Examples.formatExampleCode", () => {
	it("formats TypeScript and adds a blank line after the import block", async () => {
		const out = await Effect.runPromise(formatExampleCode('import {a} from "b"\nconst x = a( 1 )', "ts"));
		expect(out).toBe('import { a } from "b";\n\nconst x = a(1);');
	});

	it("returns an unsupported language unchanged", async () => {
		expect(await Effect.runPromise(formatExampleCode("  weird   text ", "bash"))).toBe("  weird   text ");
	});

	it("fails typed, preserving the Prettier error as the cause", async () => {
		const result = await Effect.runPromise(Effect.result(formatExampleCode("const = ;", "typescript")));
		expect(Result.isFailure(result)).toBe(true);
		if (!Result.isFailure(result)) throw new Error("expected failure");
		expect(result.failure).toBeInstanceOf(ExampleFormatError);
		expect(result.failure.language).toBe("typescript");
		expect(result.failure.cause).toBeInstanceOf(Error);
		expect(result.failure.message).toContain("typescript");
	});
});

describe("Examples.buildExample", () => {
	it("builds a type-checked Example with display stripped and source intact", async () => {
		const example = await Effect.runPromise(buildExample({ language: "ts", code: "const x = foo( 1 )" }, "foo", "pkg"));
		expect(example).toBeInstanceOf(Example);
		expect(example.typeChecked).toBe(true);
		expect(example.language).toBe("typescript");
		expect(example.code.source).toBe('// @noErrors\nimport { foo } from "pkg";\n\nconst x = foo(1);');
		expect(example.code.display).toBe('import { foo } from "pkg";\n\nconst x = foo(1);');
	});

	it("builds a plain Example for a non-TypeScript fence", async () => {
		const example = await Effect.runPromise(buildExample({ language: "json", code: "{}" }, "foo", "pkg"));
		expect(example.typeChecked).toBe(false);
		expect(example.code).toEqual(CodeText.make({ display: "{}", source: "{}" }));
	});
});
