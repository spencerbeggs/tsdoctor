import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, References } from "effect";
import type { Root } from "hast";
import { createHighlighter } from "shiki";
import { describe, expect, it } from "vitest";
import { generateApiDocs } from "../src/build-program.js";
import { CategoryResolver } from "../src/category-resolver.js";
import { loadApiModel } from "../src/model-loader.js";
import { DEFAULT_CATEGORIES } from "../src/schemas/config.js";
import type { ResolvedApiConfig } from "../src/services/ConfigService.js";
import { HighlighterService } from "../src/services/HighlighterService.js";
import { TwoslashEnvironments } from "../src/services/TwoslashEnvironments.js";
import { VfsRegistry } from "../src/vfs-registry.js";
import { MockSnapshotServiceLayer, TestOgServiceLayer } from "./utils/layers.js";

describe("generateApiDocs (Effect program)", () => {
	it("generates docs for fixture model and populates crossLinkData + fileContextMap", async () => {
		const modelPath = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");
		const { apiPackage } = await Effect.runPromise(loadApiModel(modelPath));
		const resolver = new CategoryResolver();
		const categories = resolver.mergeCategories(DEFAULT_CATEGORIES, undefined);

		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "build-program-"));

		const highlighter = await createHighlighter({
			themes: ["github-light-default", "github-dark-default"],
			langs: ["typescript"],
		});

		const apiConfig: ResolvedApiConfig & { suppressExampleErrors?: boolean } = {
			apiPackage,
			packageName: "example-module",
			outputDir: tmpDir,
			baseRoute: "/example-module",
			categories,
			bundle: { name: { value: "example-module", source: "inferred" } },
		};

		const fileContextMap = new Map<string, { api?: string; version?: string; file: string }>();

		const program = generateApiDocs(apiConfig, fileContextMap);
		const testLayer = Layer.mergeAll(
			NodeFileSystem.layer,
			MockSnapshotServiceLayer,
			Layer.succeed(HighlighterService, { highlighter }),
			TestOgServiceLayer,
			TwoslashEnvironments.layer,
			Layer.succeed(References.MinimumLogLevel, "None"),
		);
		const result = await Effect.runPromise(program.pipe(Effect.provide(testLayer)));

		// FORBIDS: registering a linker that is not built from THIS api's routes
		// (an empty one, a shared one, one hoisted out of the per-API call). The
		// suite is otherwise blind to it — the pages still generate; only the
		// rendered HTML loses every `api-type-link` anchor.
		const registered = VfsRegistry.get("example-module")?.crossLinker;
		expect(registered).toBeDefined();
		expect(registered?.apiScope).toBe("example-module");
		{
			const name = [...result.crossLinkData.routes.keys()].find((k) => !k.includes("."));
			expect(name).toBeDefined();
			const hast: Root = {
				type: "root",
				children: [
					{
						type: "element",
						tagName: "pre",
						properties: {},
						children: [
							{
								type: "element",
								tagName: "code",
								properties: {},
								children: [
									{
										type: "element",
										tagName: "span",
										properties: { class: "line" },
										children: [
											{
												type: "element",
												tagName: "span",
												properties: {},
												children: [{ type: "text", value: name as string }],
											},
										],
									},
								],
							},
						],
					},
				],
			};
			registered?.transformHast(hast);
			const html = JSON.stringify(hast);
			expect(html).toContain("api-type-link");
			expect(html).toContain(result.crossLinkData.routes.get(name as string));
		}

		// Cross-link data should be populated
		expect(result.crossLinkData.routes.size).toBeGreaterThan(0);
		expect(result.crossLinkData.kinds.size).toBeGreaterThan(0);

		// Build result metadata should be populated
		expect(result.generatedFiles.size).toBeGreaterThan(0);
		expect(result.resolvedOutputDir).toBeTruthy();
		expect(result.baseRoute).toBe("/example-module");
		expect(result.packageName).toBe("example-module");

		// File context map should have entries for generated files
		expect(fileContextMap.size).toBeGreaterThan(0);
		for (const [absPath, ctx] of fileContextMap) {
			expect(path.isAbsolute(absPath)).toBe(true);
			expect(ctx.file).toBeTruthy();
		}

		// Output directory should contain generated files
		const outputFiles = await fs.promises.readdir(tmpDir, { recursive: true });
		const mdxFiles = outputFiles.filter((f) => typeof f === "string" && f.endsWith(".mdx"));
		expect(mdxFiles.length).toBeGreaterThan(0);

		// Cleanup
		highlighter.dispose();
		await fs.promises.rm(tmpDir, { recursive: true });
	}, 30_000);
});
