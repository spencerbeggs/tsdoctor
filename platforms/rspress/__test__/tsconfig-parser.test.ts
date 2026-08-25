import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TsConfigParseError, parseTsConfig } from "../src/tsconfig-parser.js";
import { toProgrammaticCompilerOptions } from "../src/twoslash-transformer.js";

describe("parseTsConfig", () => {
	let tempDir: string;

	beforeEach(() => {
		// Create temporary directory for test config files
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-test-"));
	});

	afterEach(() => {
		// Clean up
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("parses a basic tsconfig.json", () => {
		const configContent = JSON.stringify({
			compilerOptions: {
				target: "ESNext",
				module: "ESNext",
				lib: ["ESNext", "DOM"],
				strict: false,
			},
		});

		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), configContent);

		const result = parseTsConfig("tsconfig.json", tempDir);

		expect(String(result.target).toLowerCase()).toBe("esnext"); // ESNext
		expect(String(result.module).toLowerCase()).toBe("esnext");
		// Declared spelling, not file names — the seam converts. See below.
		expect(result.lib).toBeDefined();
		expect(result.lib?.some((lib: string) => lib.includes("esnext"))).toBe(true);
		expect(result.lib?.some((lib: string) => lib.includes("dom"))).toBe(true);
		expect(result.strict).toBe(false);
	});

	it("handles ES version targets correctly", () => {
		const configContent = JSON.stringify({
			compilerOptions: {
				target: "ES2022",
				module: "NodeNext",
				moduleResolution: "NodeNext",
			},
		});

		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), configContent);

		const result = parseTsConfig("tsconfig.json", tempDir);

		expect(String(result.target).toLowerCase()).toBe("es2022");
		expect(String(result.module).toLowerCase()).toBe("nodenext");
		expect(String(result.moduleResolution).toLowerCase()).toBe("nodenext");
	});

	it("handles boolean options", () => {
		const configContent = JSON.stringify({
			compilerOptions: {
				strict: true,
				skipLibCheck: true,
				esModuleInterop: true,
				allowSyntheticDefaultImports: true,
			},
		});

		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), configContent);

		const result = parseTsConfig("tsconfig.json", tempDir);

		expect(result.strict).toBe(true);
		expect(result.skipLibCheck).toBe(true);
		expect(result.esModuleInterop).toBe(true);
		expect(result.allowSyntheticDefaultImports).toBe(true);
	});

	it("handles jsx option", () => {
		const configContent = JSON.stringify({
			compilerOptions: {
				jsx: "react-jsx",
			},
		});

		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), configContent);

		const result = parseTsConfig("tsconfig.json", tempDir);

		expect(String(result.jsx).toLowerCase()).toBe("react-jsx"); // ReactJSX
	});

	it("handles types array", () => {
		const configContent = JSON.stringify({
			compilerOptions: {
				types: ["node", "vitest"],
			},
		});

		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), configContent);

		const result = parseTsConfig("tsconfig.json", tempDir);

		expect(result.types).toEqual(["node", "vitest"]);
	});

	it("handles extends chain", () => {
		// Create base config
		const baseConfig = JSON.stringify({
			compilerOptions: {
				target: "ES2020",
				strict: true,
				lib: ["ES2020"],
			},
		});
		fs.writeFileSync(path.join(tempDir, "base.json"), baseConfig);

		// Create main config that extends base
		const mainConfig = JSON.stringify({
			extends: "./base.json",
			compilerOptions: {
				// Override target, keep strict from base
				target: "ESNext",
				lib: ["ESNext", "DOM"],
			},
		});
		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), mainConfig);

		const result = parseTsConfig("tsconfig.json", tempDir);

		expect(String(result.target).toLowerCase()).toBe("esnext"); // ESNext (overridden)
		expect(result.strict).toBe(true); // From base
		// Declared spelling, not file names — the seam converts. See below.
		expect(result.lib).toBeDefined();
		expect(result.lib?.some((lib: string) => lib.includes("esnext"))).toBe(true);
		expect(result.lib?.some((lib: string) => lib.includes("dom"))).toBe(true);
	});

	it("handles deeply nested extends chain", () => {
		// Create grandparent config
		const grandparentConfig = JSON.stringify({
			compilerOptions: {
				strict: true,
				skipLibCheck: true,
			},
		});
		fs.writeFileSync(path.join(tempDir, "grandparent.json"), grandparentConfig);

		// Create parent config
		const parentConfig = JSON.stringify({
			extends: "./grandparent.json",
			compilerOptions: {
				target: "ES2020",
			},
		});
		fs.writeFileSync(path.join(tempDir, "parent.json"), parentConfig);

		// Create child config
		const childConfig = JSON.stringify({
			extends: "./parent.json",
			compilerOptions: {
				target: "ESNext",
			},
		});
		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), childConfig);

		const result = parseTsConfig("tsconfig.json", tempDir);

		expect(String(result.target).toLowerCase()).toBe("esnext"); // ESNext (from child)
		expect(result.strict).toBe(true); // From grandparent
		expect(result.skipLibCheck).toBe(true); // From grandparent
	});

	it("handles absolute paths", () => {
		const configContent = JSON.stringify({
			compilerOptions: {
				target: "ESNext",
			},
		});

		const absolutePath = path.join(tempDir, "tsconfig.json");
		fs.writeFileSync(absolutePath, configContent);

		const result = parseTsConfig(absolutePath, "/some/other/dir");

		expect(String(result.target).toLowerCase()).toBe("esnext");
	});

	it("throws TsConfigParseError for missing file", () => {
		expect(() => {
			parseTsConfig("nonexistent.json", tempDir);
		}).toThrow(TsConfigParseError);

		expect(() => {
			parseTsConfig("nonexistent.json", tempDir);
		}).toThrow("File not found");
	});

	it("throws TsConfigParseError for invalid JSON", () => {
		fs.writeFileSync(path.join(tempDir, "invalid.json"), "{ invalid json }");

		expect(() => {
			parseTsConfig("invalid.json", tempDir);
		}).toThrow(TsConfigParseError);
	});

	it("handles empty compilerOptions", () => {
		const configContent = JSON.stringify({
			compilerOptions: {},
		});

		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), configContent);

		const result = parseTsConfig("tsconfig.json", tempDir);

		// Should return an object with no properties
		expect(Object.keys(result).length).toBe(0);
	});

	it("handles tsconfig with no compilerOptions", () => {
		const configContent = JSON.stringify({
			include: ["src/**/*"],
		});

		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), configContent);

		const result = parseTsConfig("tsconfig.json", tempDir);

		// Should return an object with no properties
		expect(Object.keys(result).length).toBe(0);
	});

	it("handles JSONC (comments in JSON)", () => {
		const configContent = `{
			// This is a comment
			"compilerOptions": {
				/* Multi-line
				   comment */
				"target": "ESNext"
			}
		}`;

		fs.writeFileSync(path.join(tempDir, "tsconfig.json"), configContent);

		const result = parseTsConfig("tsconfig.json", tempDir);

		expect(String(result.target).toLowerCase()).toBe("esnext");
	});
});

describe("extends chains", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-extends-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	// `parseTsConfigWithMetadata` and its `extendedPaths` are GONE. Nothing
	// consumed them, and the chain they reported was wrong anyway: the
	// hand-rolled resolver returned a bare package specifier verbatim as a file
	// path, so `extends: "@some/preset/tsconfig.json"` yielded a path that does
	// not exist. What matters is that the chain is MERGED correctly, which the
	// kit loader owns and these assert.

	it("merges options from an extended config", () => {
		fs.writeFileSync(path.join(tempDir, "base.json"), JSON.stringify({ compilerOptions: { strict: true } }));
		fs.writeFileSync(
			path.join(tempDir, "tsconfig.json"),
			JSON.stringify({ extends: "./base.json", compilerOptions: { target: "ESNext" } }),
		);

		const options = parseTsConfig("tsconfig.json", tempDir);

		// Inherited from the base...
		expect(options.strict).toBe(true);
		// ...alongside the deriving config's own.
		expect(String(options.target).toLowerCase()).toBe("esnext");
	});

	it("lets the deriving config win over the one it extends", () => {
		fs.writeFileSync(
			path.join(tempDir, "base.json"),
			JSON.stringify({ compilerOptions: { strict: true, target: "ES2015" } }),
		);
		fs.writeFileSync(
			path.join(tempDir, "tsconfig.json"),
			JSON.stringify({ extends: "./base.json", compilerOptions: { target: "ESNext" } }),
		);

		const options = parseTsConfig("tsconfig.json", tempDir);

		expect(String(options.target).toLowerCase()).toBe("esnext");
		expect(options.strict).toBe(true);
	});

	it("reports declared options in the tsconfig spelling, not the programmatic one", () => {
		// The loader reports what the FILE declares. `toProgrammaticCompilerOptions`
		// is the single place that converts; a second conversion here is what made
		// three of four resolution paths load zero lib files once already.
		fs.writeFileSync(
			path.join(tempDir, "tsconfig.json"),
			JSON.stringify({ compilerOptions: { target: "ESNext", lib: ["ESNext", "DOM"] } }),
		);

		const options = parseTsConfig("tsconfig.json", tempDir);

		expect(typeof options.target).toBe("string");
		expect(options.lib?.map((l) => l.toLowerCase())).toEqual(["esnext", "dom"]);
		// FORBIDS re-introducing a file-name conversion at this layer.
		expect(options.lib?.some((lib) => lib.startsWith("lib."))).toBe(false);
	});
});

describe("TsConfigParseError", () => {
	it("has correct error name", () => {
		const error = new TsConfigParseError("/path/to/config.json", "Test error");
		expect(error.name).toBe("TsConfigParseError");
	});

	it("includes config path in message", () => {
		const error = new TsConfigParseError("/path/to/config.json", "Test error");
		expect(error.message).toContain("/path/to/config.json");
		expect(error.message).toContain("Test error");
	});

	it("stores config path as property", () => {
		const error = new TsConfigParseError("/path/to/config.json", "Test error");
		expect(error.configPath).toBe("/path/to/config.json");
	});

	it("stores cause if provided", () => {
		const cause = new Error("Original error");
		const error = new TsConfigParseError("/path/to/config.json", "Test error", cause);
		expect(error.cause).toBe(cause);
	});
});

describe("parseTsConfig feeds the normalization seam", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tsconfig-seam-test-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("produces options the seam converts to the right programmatic values", () => {
		// The parser reporting the tsconfig spelling is only safe because ONE
		// seam converts it. This pins the whole chain rather than each half: a
		// parser that changed spelling without the seam keeping up would load the
		// wrong lib files and degrade every hover with no diagnostic — which is
		// exactly how the earlier `lib` defect behaved.
		fs.writeFileSync(
			path.join(tempDir, "tsconfig.json"),
			JSON.stringify({
				compilerOptions: { target: "ESNext", module: "NodeNext", jsx: "react-jsx", lib: ["ESNext", "DOM"] },
			}),
		);

		const declared = parseTsConfig("tsconfig.json", tempDir);
		const programmatic = toProgrammaticCompilerOptions(declared);

		expect(typeof programmatic.target).toBe("number");
		expect(typeof programmatic.module).toBe("number");
		expect(typeof programmatic.jsx).toBe("number");
		// The lib FILE names Twoslash actually loads. An empty or unconverted
		// array here is the silent-degradation shape.
		expect(programmatic.lib).toEqual(["lib.esnext.d.ts", "lib.dom.d.ts"]);
	});
});
