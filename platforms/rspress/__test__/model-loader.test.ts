import fs from "node:fs";
import path from "node:path";
import type { ApiModel, ApiPackage } from "@microsoft/api-extractor-model";
import { Model } from "@tsdoctor/model";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadedModel, PackageJson } from "../src/internal-types.js";
import { loadApiModel, loadPackageJson, loadVersionModel } from "../src/model-loader.js";
import type { VersionConfig } from "../src/schemas/index.js";

/**
 * Tests for the adapter-local model-loader functions. The path-based model
 * load delegates to @tsdoctor/model's `Model.load` (typed errors on the Effect
 * error channel); package.json loading stays a promise helper over node:fs.
 */

// Mock modules
vi.mock("node:fs");
vi.mock("node:path");
// Path-based loads delegate to Model.load, whose own fs access bypasses the
// node:fs mock above — stub the delegated function directly.
vi.mock("@tsdoctor/model", async (importActual) => {
	const actual = await importActual<typeof import("@tsdoctor/model")>();
	return { ...actual, Model: { ...actual.Model, load: vi.fn() } };
});

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(Effect.result(effect));

describe("model-loader", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	describe("loadPackageJson", () => {
		it("loads package.json from a file path", async () => {
			const mockPath = "/path/to/package.json";
			const mockPackageJson: PackageJson = { name: "test-package", version: "1.0.0" };

			vi.mocked(path.resolve).mockReturnValue(mockPath);
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockPackageJson));

			const result = await loadPackageJson(mockPath);

			expect(result).toEqual(mockPackageJson);
			expect(path.resolve).toHaveBeenCalledWith(mockPath);
			expect(fs.existsSync).toHaveBeenCalledWith(mockPath);
			expect(fs.readFileSync).toHaveBeenCalledWith(mockPath, "utf-8");
		});

		it("loads package.json from an async function", async () => {
			const mockPackageJson: PackageJson = { name: "test-package", version: "2.0.0" };
			const result = await loadPackageJson(async () => mockPackageJson);
			expect(result).toEqual(mockPackageJson);
		});

		it("throws when the package.json file is not found", async () => {
			vi.mocked(path.resolve).mockReturnValue("/missing/package.json");
			vi.mocked(fs.existsSync).mockReturnValue(false);
			await expect(loadPackageJson("/missing/package.json")).rejects.toThrow(/not found/);
		});

		it("throws when the package.json has invalid JSON", async () => {
			vi.mocked(path.resolve).mockReturnValue("/bad/package.json");
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue("not json");
			await expect(loadPackageJson("/bad/package.json")).rejects.toThrow(/Failed to parse/);
		});
	});

	describe("loadApiModel", () => {
		it("loads an API model from a file path via Model.load", async () => {
			const mockPackage = { name: "test" } as unknown as ApiPackage;
			vi.mocked(Model.load).mockReturnValue(Effect.succeed(mockPackage));

			const result = await Effect.runPromise(loadApiModel("/models/test.api.json"));

			expect(result).toEqual({ apiPackage: mockPackage });
			expect(Model.load).toHaveBeenCalledWith("/models/test.api.json");
		});

		it("propagates typed load failures on the error channel", async () => {
			const failure = new Model.ModelNotFoundError({ modelPath: "/models/missing.api.json" });
			vi.mocked(Model.load).mockReturnValue(Effect.fail(failure));

			const result = await run(loadApiModel("/models/missing.api.json"));
			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				expect(result.failure._tag).toBe("ModelNotFoundError");
			}
		});

		it("loads an API model from an async function returning an ApiModel", async () => {
			const mockPackage = { name: "test" } as unknown as ApiPackage;
			const mockModel = { packages: [mockPackage] } as unknown as ApiModel;

			const result = await Effect.runPromise(loadApiModel(async () => mockModel));
			expect(result).toEqual({ apiPackage: mockPackage });
		});

		it("loads an API model from an async function returning a LoadedModel with source", async () => {
			const mockPackage = { name: "test" } as unknown as ApiPackage;
			const mockModel = { packages: [mockPackage] } as unknown as ApiModel;
			const loaded: LoadedModel = {
				model: mockModel,
				source: { url: "https://github.com/owner/repo", ref: "blob/main" },
			};

			const result = await Effect.runPromise(loadApiModel(async () => loaded));
			expect(result.apiPackage).toBe(mockPackage);
			expect(result.source).toEqual({ url: "https://github.com/owner/repo", ref: "blob/main" });
		});

		it("fails with EmptyModelError when an async function returns an ApiModel with no packages", async () => {
			const mockModel = { packages: [] } as unknown as ApiModel;
			const result = await run(loadApiModel(async () => mockModel));
			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				expect(result.failure._tag).toBe("EmptyModelError");
				expect(result.failure.message).toMatch(/contains no packages/);
			}
		});

		it("fails with EmptyModelError when an async function returns a LoadedModel with no packages", async () => {
			const loaded: LoadedModel = { model: { packages: [] } as unknown as ApiModel };
			const result = await run(loadApiModel(async () => loaded));
			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				expect(result.failure._tag).toBe("EmptyModelError");
			}
		});

		it("fails with EmptyModelError when an async function returns an invalid object", async () => {
			const result = await run(loadApiModel(async () => ({}) as unknown as ApiModel));
			expect(result._tag).toBe("Failure");
			if (result._tag === "Failure") {
				expect(result.failure._tag).toBe("EmptyModelError");
				expect(result.failure.message).toMatch(/must return an ApiModel/);
			}
		});
	});

	describe("loadVersionModel", () => {
		it("loads a version model from a PathLike", async () => {
			const mockPackage = { name: "v1" } as unknown as ApiPackage;
			vi.mocked(Model.load).mockReturnValue(Effect.succeed(mockPackage));

			const result = await Effect.runPromise(loadVersionModel("/models/v1.api.json"));
			expect(result).toEqual({ apiPackage: mockPackage });
		});

		it("loads a version model from an async function", async () => {
			const mockPackage = { name: "v2" } as unknown as ApiPackage;
			const mockModel = { packages: [mockPackage] } as unknown as ApiModel;

			const result = await Effect.runPromise(loadVersionModel(async () => mockModel));
			expect(result.apiPackage).toBe(mockPackage);
		});

		it("loads a full VersionConfig, carrying its extra properties through", async () => {
			const mockPackage = { name: "v3" } as unknown as ApiPackage;
			vi.mocked(Model.load).mockReturnValue(Effect.succeed(mockPackage));
			const mockPackageJson: PackageJson = { name: "pkg", version: "3.0.0" };
			vi.mocked(path.resolve).mockReturnValue("/pkg/package.json");
			vi.mocked(fs.existsSync).mockReturnValue(true);
			vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockPackageJson));

			const versionConfig: VersionConfig = {
				model: "/models/v3.api.json",
				packageJson: "/pkg/package.json",
				source: { url: "https://github.com/owner/repo" },
				externalPackages: [{ name: "zod", version: "^3.0.0" }],
			};

			const result = await Effect.runPromise(loadVersionModel(versionConfig));
			expect(result.apiPackage).toBe(mockPackage);
			expect(result.packageJson).toEqual(mockPackageJson);
			expect(result.source).toEqual({ url: "https://github.com/owner/repo" });
			expect(result.externalPackages).toEqual([{ name: "zod", version: "^3.0.0" }]);
		});

		it("prioritizes loader-supplied source over config source", async () => {
			const mockPackage = { name: "v4" } as unknown as ApiPackage;
			const loaded: LoadedModel = {
				model: { packages: [mockPackage] } as unknown as ApiModel,
				source: { url: "https://github.com/loader/repo" },
			};

			const versionConfig: VersionConfig = {
				model: async () => loaded,
				source: { url: "https://github.com/config/repo" },
			};

			const result = await Effect.runPromise(loadVersionModel(versionConfig));
			expect(result.source).toEqual({ url: "https://github.com/loader/repo" });
		});

		it("uses config source when the loader provides none", async () => {
			const mockPackage = { name: "v5" } as unknown as ApiPackage;
			const mockModel = { packages: [mockPackage] } as unknown as ApiModel;

			const versionConfig: VersionConfig = {
				model: async () => mockModel,
				source: { url: "https://github.com/config/repo" },
			};

			const result = await Effect.runPromise(loadVersionModel(versionConfig));
			expect(result.source).toEqual({ url: "https://github.com/config/repo" });
		});
	});
});
