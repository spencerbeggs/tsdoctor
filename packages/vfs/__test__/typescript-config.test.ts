import { describe, expect, it } from "vitest";
import type { TypeResolutionCompilerOptions, TypeScriptConfig } from "../src/index.js";
import {
	DEFAULT_COMPILER_OPTIONS,
	mergeCompilerOptions,
	resolveTypeScriptConfig,
	resolveTypeScriptConfigSingle,
	resolveTypeScriptConfigSingleAsync,
} from "../src/index.js";

describe("DEFAULT_COMPILER_OPTIONS", () => {
	it("has sensible defaults for documentation", () => {
		expect(DEFAULT_COMPILER_OPTIONS.target).toBe("esnext");
		expect(DEFAULT_COMPILER_OPTIONS.module).toBe("esnext");
		expect(DEFAULT_COMPILER_OPTIONS.moduleResolution).toBe("bundler");
		expect(DEFAULT_COMPILER_OPTIONS.lib).toEqual(["esnext", "dom"]);
		expect(DEFAULT_COMPILER_OPTIONS.strict).toBe(false);
		expect(DEFAULT_COMPILER_OPTIONS.skipLibCheck).toBe(true);
		expect(DEFAULT_COMPILER_OPTIONS.esModuleInterop).toBe(true);
		expect(DEFAULT_COMPILER_OPTIONS.allowSyntheticDefaultImports).toBe(true);
	});
});

describe("mergeCompilerOptions", () => {
	it("returns a copy of base when override is undefined", () => {
		const base: TypeResolutionCompilerOptions = { target: "esnext", lib: ["esnext"] };
		const result = mergeCompilerOptions(base, undefined);

		expect(result).toEqual(base);
		expect(result).not.toBe(base); // Should be a new object
	});

	it("merges override properties on top of base", () => {
		const base: TypeResolutionCompilerOptions = {
			target: "esnext",
			lib: ["esnext"],
			strict: true,
		};
		const override: TypeResolutionCompilerOptions = {
			lib: ["esnext", "dom"],
			strict: false,
		};

		const result = mergeCompilerOptions(base, override);

		expect(result).toEqual({
			target: "esnext", // From base
			lib: ["esnext", "dom"], // From override
			strict: false, // From override
		});
	});

	it("does not include undefined properties from override", () => {
		const base: TypeResolutionCompilerOptions = {
			target: "esnext",
			module: "esnext",
			strict: true,
		};
		const override: TypeResolutionCompilerOptions = {
			strict: false,
			// target and module not specified
		};

		const result = mergeCompilerOptions(base, override);

		expect(result.target).toBe("esnext");
		expect(result.module).toBe("esnext");
		expect(result.strict).toBe(false);
	});

	it("handles all TypeResolutionCompilerOptions properties", () => {
		const base: TypeResolutionCompilerOptions = {};
		const override: TypeResolutionCompilerOptions = {
			target: "esnext",
			module: "esnext",
			moduleResolution: "bundler",
			lib: ["esnext", "dom"],
			strict: false,
			skipLibCheck: true,
			esModuleInterop: true,
			allowSyntheticDefaultImports: true,
			jsx: "react-jsx",
			types: ["node"],
		};

		const result = mergeCompilerOptions(base, override);

		expect(result).toEqual(override);
	});

	it("replaces entire lib array rather than merging", () => {
		const base: TypeResolutionCompilerOptions = {
			lib: ["es2020", "dom"],
		};
		const override: TypeResolutionCompilerOptions = {
			lib: ["esnext"],
		};

		const result = mergeCompilerOptions(base, override);

		expect(result.lib).toEqual(["esnext"]);
	});

	it("replaces entire types array rather than merging", () => {
		const base: TypeResolutionCompilerOptions = {
			types: ["node", "jest"],
		};
		const override: TypeResolutionCompilerOptions = {
			types: ["vitest"],
		};

		const result = mergeCompilerOptions(base, override);

		expect(result.types).toEqual(["vitest"]);
	});
});

describe("resolveTypeScriptConfigSingle", () => {
	it("returns empty object for undefined config", () => {
		const result = resolveTypeScriptConfigSingle(undefined, "/project");
		expect(result).toEqual({});
	});

	it("returns empty object for config with no properties", () => {
		const config: TypeScriptConfig = {};
		const result = resolveTypeScriptConfigSingle(config, "/project");
		expect(result).toEqual({});
	});

	it("returns compilerOptions directly when no tsconfig", () => {
		const config: TypeScriptConfig = {
			compilerOptions: {
				target: "esnext",
				lib: ["esnext"],
			},
		};

		const result = resolveTypeScriptConfigSingle(config, "/project");

		expect(result).toEqual({
			target: "esnext",
			lib: ["esnext"],
		});
	});
});

describe("resolveTypeScriptConfig", () => {
	it("returns defaults when no config provided", async () => {
		const result = await resolveTypeScriptConfig("/project");
		expect(result).toEqual(DEFAULT_COMPILER_OPTIONS);
	});

	it("merges global config on top of defaults", async () => {
		const global: TypeScriptConfig = {
			compilerOptions: {
				strict: true,
			},
		};

		const result = await resolveTypeScriptConfig("/project", global);

		expect(result.strict).toBe(true);
		expect(result.target).toBe("esnext"); // From defaults
		expect(result.module).toBe("esnext"); // From defaults
	});

	it("merges API config on top of global", async () => {
		const global: TypeScriptConfig = {
			compilerOptions: {
				target: "esnext",
				strict: true,
			},
		};
		const api: TypeScriptConfig = {
			compilerOptions: {
				strict: false,
			},
		};

		const result = await resolveTypeScriptConfig("/project", global, api);

		expect(result.target).toBe("esnext"); // From global
		expect(result.strict).toBe(false); // Overridden by API
	});

	it("handles undefined configs in cascade", async () => {
		const version: TypeScriptConfig = {
			compilerOptions: { strict: true },
		};

		// Skip global and API
		const result = await resolveTypeScriptConfig("/project", undefined, version);

		expect(result.strict).toBe(true);
		expect(result.target).toBe("esnext"); // From defaults
	});

	it("handles async function for tsconfig", async () => {
		const global: TypeScriptConfig = {
			tsconfig: async () => ({
				target: "esnext",
				lib: ["esnext", "dom"],
			}),
		};

		const result = await resolveTypeScriptConfig("/project", global);

		expect(result.target).toBe("esnext");
		expect(result.lib).toEqual(["esnext", "dom"]);
	});

	it("merges compilerOptions on top of async tsconfig function", async () => {
		const global: TypeScriptConfig = {
			tsconfig: async () => ({
				target: "esnext",
				strict: true,
			}),
			compilerOptions: {
				strict: false, // Override the async function result
			},
		};

		const result = await resolveTypeScriptConfig("/project", global);

		expect(result.target).toBe("esnext"); // From async function
		expect(result.strict).toBe(false); // Overridden by compilerOptions
	});
});

describe("resolveTypeScriptConfigSingleAsync", () => {
	it("returns empty object for undefined config", async () => {
		const result = await resolveTypeScriptConfigSingleAsync(undefined, "/project");
		expect(result).toEqual({});
	});

	it("calls async function and returns result", async () => {
		const config: TypeScriptConfig = {
			tsconfig: async () => ({
				target: "esnext",
				lib: ["esnext"],
			}),
		};

		const result = await resolveTypeScriptConfigSingleAsync(config, "/project");

		expect(result).toEqual({
			target: "esnext",
			lib: ["esnext"],
		});
	});

	it("merges compilerOptions on top of async function result", async () => {
		const config: TypeScriptConfig = {
			tsconfig: async () => ({
				target: "esnext",
				strict: true,
			}),
			compilerOptions: {
				strict: false,
				module: "esnext",
			},
		};

		const result = await resolveTypeScriptConfigSingleAsync(config, "/project");

		expect(result.target).toBe("esnext"); // From async function
		expect(result.strict).toBe(false); // Overridden by compilerOptions
		expect(result.module).toBe("esnext"); // From compilerOptions
	});
});
