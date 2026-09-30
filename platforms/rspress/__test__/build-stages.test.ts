import path from "node:path";
import { MemoryFileSystem } from "@effected/memfs";
import { ApiModel } from "@microsoft/api-extractor-model";
import { CrossLinker, parseFrontmatter } from "@tsdoctor/model";
import { SnapshotService } from "@tsdoctor/snapshot";
import { Effect, FileSystem, Layer, Path, References } from "effect";
import { describe, expect, it } from "vitest";
import type {
	FileWriteResult,
	GenerateSinglePageContext,
	GeneratedPageResult,
	WorkItem,
	WriteSingleFileContext,
} from "../src/build-stages.js";
import {
	buildPipelineForApi,
	cleanupAndCommit,
	generateSinglePage,
	prepareWorkItems,
	writeMetadata,
	writeSingleFile,
} from "../src/build-stages.js";
import { CategoryResolver } from "../src/category-resolver.js";
import { loadApiModel } from "../src/model-loader.js";
import { makeEventBusLayer } from "../src/observability/EventBus.js";
import type { PluginEvent } from "../src/observability/events.js";
import { installSyncEmitterUnsafe } from "../src/observability/sync-emitter.js";
import type { CategoryConfig } from "../src/schemas/config.js";
import { DEFAULT_CATEGORIES } from "../src/schemas/config.js";
import { OgService } from "../src/services/OgService.js";

const TEST_BUILD_ID = "test-build";

/**
 * Every stage under test here reaches the disk only through the `FileSystem`
 * service, so the suite runs over an in-memory volume (`@effected/memfs`) and
 * the snapshot DB over in-memory SQLite (`SnapshotService.layerMemory`) — the
 * real SQL, no temp directory. `OgService` shares the page writer's volume.
 *
 * Each `Effect.provide` builds a FRESH volume and a fresh database, so a test
 * that reads back what it wrote, or runs two builds that must see each other's
 * output, does all of it inside ONE provided program.
 */
const OUT = "/out";

/** The page-writer environment: `OgService` over one empty volume, which it exposes. */
const PageLayer = Layer.provideMerge(OgService.layer, Layer.mergeAll(MemoryFileSystem.layer, Path.layer));

/** The output directory exists before a build, as it would on disk. */
const outputDir = { [OUT]: MemoryFileSystem.directory() };

describe("build-stages types", () => {
	it("WorkItem has required fields", () => {
		const item = {} as WorkItem;
		void item.item;
		void item.categoryKey;
		void item.categoryConfig;
		void item.namespaceMember;
		expect(true).toBe(true);
	});

	it("GeneratedPageResult has required fields", () => {
		const result = {} as GeneratedPageResult;
		void result.workItem;
		void result.content;
		void result.bodyContent;
		void result.frontmatter;
		void result.contentHash;
		void result.frontmatterHash;
		void result.routePath;
		void result.relativePathWithExt;
		void result.publishedTime;
		void result.modifiedTime;
		void result.isUnchanged;
		expect(true).toBe(true);
	});

	it("FileWriteResult has required fields", () => {
		const result = {} as FileWriteResult;
		void result.relativePathWithExt;
		void result.absolutePath;
		void result.status;
		void result.snapshot;
		void result.categoryKey;
		void result.label;
		void result.routePath;
		expect(true).toBe(true);
	});
});

describe("prepareWorkItems", () => {
	it("returns work items and cross-link data from fixture API model", async () => {
		const modelPath = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");
		const { apiPackage } = await Effect.runPromise(loadApiModel(modelPath));
		const resolver = new CategoryResolver();
		const categories = resolver.mergeCategories(DEFAULT_CATEGORIES, undefined);

		const result = prepareWorkItems({
			apiPackage,
			categories,
			baseRoute: "/example-module",
		});

		expect(result.workItems.length).toBeGreaterThan(0);
		for (const wi of result.workItems) {
			expect(wi.item).toBeDefined();
			expect(wi.categoryKey).toBeTruthy();
			expect(wi.categoryConfig).toBeDefined();
		}
		expect(result.crossLinkData.routes.size).toBeGreaterThan(0);
		expect(result.crossLinkData.kinds.size).toBeGreaterThan(0);
	});

	it("returns empty arrays for empty categories", async () => {
		const modelPath = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");
		const { apiPackage } = await Effect.runPromise(loadApiModel(modelPath));
		const result = prepareWorkItems({
			apiPackage,
			categories: {},
			baseRoute: "/test",
		});
		expect(result.workItems).toHaveLength(0);
		expect(result.crossLinkData.routes.size).toBe(0);
	});

	it("generates companion pages cleanly and resolves the bare cross-link to the value page", () => {
		const model = new ApiModel();
		const pkg = model.loadPackage(path.join(import.meta.dirname, "__fixtures__", "effect-kit", "effect-kit.api.json"));
		const { workItems, crossLinkData } = prepareWorkItems({
			apiPackage: pkg,
			categories: DEFAULT_CATEGORIES,
			baseRoute: "/api",
		});
		for (const route of crossLinkData.routes.values()) {
			expect(route).not.toContain("/default/");
			expect(route).not.toContain("/testing/");
			expect(route).not.toContain("/dispatch/");
		}
		const pageRoutes = workItems.map(
			(wi) => `/api/${wi.categoryConfig.folderName}/${wi.item.displayName.toLowerCase()}`,
		);
		expect(pageRoutes).toContain("/api/variable/actionseverity");
		expect(pageRoutes).toContain("/api/type/actionseverity");
		expect(crossLinkData.routes.get("ActionSeverity")).toBe("/api/variable/actionseverity");
		for (const wi of workItems) {
			expect("routeSuffix" in wi).toBe(false);
		}
	});

	it("emits RouteCollisionDetected via the sync-island seam before throwing", () => {
		const model = new ApiModel();
		const pkg = model.loadPackage(path.join(import.meta.dirname, "__fixtures__", "effect-kit", "effect-kit.api.json"));
		// Force the companion `variables`/`types` categories to share one folder so a
		// genuine ActionSeverity Variable + TypeAlias pair (see the companion-pattern
		// test above) collides on the same route. Real fixture items, no mocked
		// ApiItems — only the category config is synthetic.
		const collidingCategories: Record<string, CategoryConfig> = {
			...DEFAULT_CATEGORIES,
			variables: { ...DEFAULT_CATEGORIES.variables, folderName: "type" },
		};

		const emitted: PluginEvent[] = [];
		installSyncEmitterUnsafe((event) => emitted.push(event), { buildId: "test-build-id" });
		try {
			expect(() =>
				prepareWorkItems({
					apiPackage: pkg,
					categories: collidingCategories,
					baseRoute: "/api",
				}),
			).toThrow(/Route collision/);
		} finally {
			installSyncEmitterUnsafe(() => {});
		}

		const collisionEvents = emitted.filter((event) => event._tag === "RouteCollisionDetected");
		expect(collisionEvents.length).toBeGreaterThan(0);
		for (const event of collisionEvents) {
			if (event._tag !== "RouteCollisionDetected") continue;
			expect(event.ctx.buildId).toBe("test-build-id");
			expect(event.level).toBe("error");
			expect(event.items.length).toBeGreaterThanOrEqual(2);
		}
		expect(
			collisionEvents.some(
				(event) =>
					event._tag === "RouteCollisionDetected" && event.items.some((item) => item.includes("ActionSeverity")),
			),
		).toBe(true);
	});

	it("preserves the route-collision error when the emitter throws", () => {
		const model = new ApiModel();
		const pkg = model.loadPackage(path.join(import.meta.dirname, "__fixtures__", "effect-kit", "effect-kit.api.json"));
		const collidingCategories: Record<string, CategoryConfig> = {
			...DEFAULT_CATEGORIES,
			variables: { ...DEFAULT_CATEGORIES.variables, folderName: "type" },
		};
		installSyncEmitterUnsafe(
			() => {
				throw new Error("emitter boom");
			},
			{ buildId: "test-build-id" },
		);
		try {
			// The guarded emit loop must not let the sink's failure replace the collision error.
			expect(() =>
				prepareWorkItems({
					apiPackage: pkg,
					categories: collidingCategories,
					baseRoute: "/api",
				}),
			).toThrow(/Route collision/);
		} finally {
			installSyncEmitterUnsafe(() => {});
		}
	});

	it("inlines synthetic base declarations instead of paging them", () => {
		const model = new ApiModel();
		const pkg = model.loadPackage(
			path.join(import.meta.dirname, "__fixtures__", "synthetic-base", "synthetic-base.api.json"),
		);
		const { workItems, crossLinkData } = prepareWorkItems({
			apiPackage: pkg,
			categories: DEFAULT_CATEGORIES,
			baseRoute: "/api",
		});

		// No page/sidebar entry for the unexported base declaration
		const baseWorkItem = workItems.find((wi) => wi.item.displayName === "Person_base");
		expect(baseWorkItem).toBeUndefined();

		// The owning class carries the base for inline rendering
		const personWorkItem = workItems.find((wi) => wi.item.displayName === "Person");
		expect(personWorkItem?.syntheticBase?.displayName).toBe("Person_base");

		// The base name cross-links to the inline section anchor on the class page
		expect(crossLinkData.routes.get("Person_base")).toBe("/api/class/person#base-class");
		expect(crossLinkData.kinds.get("Person_base")).toBe("Variable");

		// Regular inheritance is untouched
		const catWorkItem = workItems.find((wi) => wi.item.displayName === "Cat");
		expect(catWorkItem?.syntheticBase).toBeUndefined();
		expect(crossLinkData.routes.get("Animal")).toBe("/api/class/animal");
	});
});

describe("writeMetadata", () => {
	const classes: Record<string, CategoryConfig> = {
		classes: {
			folderName: "class",
			displayName: "Classes",
			singularName: "Class",
			collapsible: true,
			collapsed: true,
			overviewHeaders: [2],
		},
	};

	const fileResult = (
		file: string,
		label: string,
		status: FileWriteResult["status"],
		snapshot: Partial<FileWriteResult["snapshot"]> = {},
	): FileWriteResult => ({
		relativePathWithExt: file,
		absolutePath: path.join(OUT, file),
		status,
		snapshot: {
			outputDir: OUT,
			filePath: file,
			publishedTime: "",
			modifiedTime: "",
			contentHash: "a",
			frontmatterHash: "b",
			buildTime: "",
			...snapshot,
		},
		categoryKey: "classes",
		label,
		routePath: `/api/${file.replace(/\.mdx$/, "")}`,
	});

	it("writes _meta.json files for categories with items", async () => {
		const generatedFiles = new Set<string>();

		const results: FileWriteResult[] = [
			fileResult("class/foo.mdx", "Foo", "new", { contentHash: "a", frontmatterHash: "b" }),
			fileResult("class/bar.mdx", "Bar", "new", { contentHash: "c", frontmatterHash: "d" }),
		];

		const { metaContent, rootMeta, indexExists } = await Effect.runPromise(
			Effect.gen(function* () {
				yield* writeMetadata({
					buildId: TEST_BUILD_ID,
					fileResults: results,
					categories: classes,
					resolvedOutputDir: OUT,
					existingSnapshots: new Map(),
					buildTime: new Date().toISOString(),
					baseRoute: "/api",
					packageName: "test-package",
					generatedFiles,
				});
				const fs = yield* FileSystem.FileSystem;
				return {
					metaContent: JSON.parse(yield* fs.readFileString(path.join(OUT, "class/_meta.json"))),
					rootMeta: JSON.parse(yield* fs.readFileString(path.join(OUT, "_meta.json"))),
					indexExists: yield* fs.exists(path.join(OUT, "index.mdx")),
				};
			}).pipe(Effect.provide(Layer.mergeAll(MemoryFileSystem.layerWith(outputDir), SnapshotService.layerMemory()))),
		);

		// Category _meta.json should exist with sorted entries
		expect(metaContent).toHaveLength(2);
		expect(metaContent[0].label).toBe("Bar");
		expect(metaContent[1].label).toBe("Foo");

		// Root _meta.json should exist with category dir entry
		expect(rootMeta).toHaveLength(1);
		expect(rootMeta[0].type).toBe("dir");
		expect(rootMeta[0].name).toBe("class");
		expect(rootMeta[0].label).toBe("Classes");

		// generatedFiles should track all metadata files
		expect(generatedFiles.has("_meta.json")).toBe(true);
		expect(generatedFiles.has("class/_meta.json")).toBe(true);
		expect(generatedFiles.has("index.mdx")).toBe(true);

		// index.mdx should have been written
		expect(indexExists).toBe(true);
	});

	it("skips writing _meta.json when content is unchanged (snapshot match)", async () => {
		const metaPath = path.join(OUT, "class/_meta.json");
		const results: FileWriteResult[] = [
			fileResult("class/foo.mdx", "Foo", "unchanged", {
				publishedTime: "2024-01-01T00:00:00.000Z",
				modifiedTime: "2024-01-01T00:00:00.000Z",
				buildTime: "2024-01-01T00:00:00.000Z",
			}),
		];

		// A spy, not a stub: the handler records each write and declines, so the
		// write still lands. Counting writes discriminates directly where the
		// on-disk version compared mtimes.
		const writes: string[] = [];
		const volume = MemoryFileSystem.layerWith(outputDir, {
			faults: {
				writeFileString: (target) => {
					writes.push(target);
					return undefined;
				},
			},
		});
		const metaWrites = () => writes.filter((target) => target === metaPath).length;

		const { firstBuild, secondBuild } = await Effect.runPromise(
			Effect.gen(function* () {
				const run = (existingSnapshots: Parameters<typeof writeMetadata>[0]["existingSnapshots"]) =>
					writeMetadata({
						buildId: TEST_BUILD_ID,
						fileResults: results,
						categories: classes,
						resolvedOutputDir: OUT,
						existingSnapshots,
						buildTime: new Date().toISOString(),
						baseRoute: "/api",
						packageName: "test-package",
						generatedFiles: new Set<string>(),
					});

				// First write — creates the files
				yield* run(new Map());
				const firstBuild = metaWrites();

				// Build the existingSnapshots by reading the snapshot DB via SnapshotService
				const svc = yield* SnapshotService;
				const all = yield* svc.getAllForDirectory(OUT);

				// Second write — should be unchanged, so _meta.json is not rewritten
				yield* run(new Map(all.map((snapshot) => [snapshot.filePath, snapshot])));
				return { firstBuild, secondBuild: metaWrites() - firstBuild };
			}).pipe(Effect.provide(Layer.mergeAll(volume, SnapshotService.layerMemory()))),
		);

		expect(firstBuild).toBe(1);
		expect(secondBuild).toBe(0);
	});

	it("excludes categories with no items from root _meta.json", async () => {
		const categories: Record<string, CategoryConfig> = {
			...classes,
			interfaces: {
				folderName: "interface",
				displayName: "Interfaces",
				singularName: "Interface",
				collapsible: true,
				collapsed: true,
				overviewHeaders: [2],
			},
		};

		// Only classes have results — interfaces category is empty
		const results: FileWriteResult[] = [fileResult("class/foo.mdx", "Foo", "new")];

		const rootMeta = await Effect.runPromise(
			Effect.gen(function* () {
				yield* writeMetadata({
					buildId: TEST_BUILD_ID,
					fileResults: results,
					categories,
					resolvedOutputDir: OUT,
					existingSnapshots: new Map(),
					buildTime: new Date().toISOString(),
					baseRoute: "/api",
					packageName: "test-package",
					generatedFiles: new Set<string>(),
				});
				const fs = yield* FileSystem.FileSystem;
				return JSON.parse(yield* fs.readFileString(path.join(OUT, "_meta.json")));
			}).pipe(Effect.provide(Layer.mergeAll(MemoryFileSystem.layerWith(outputDir), SnapshotService.layerMemory()))),
		);

		// Only "class" should appear — "interface" has no items
		expect(rootMeta).toHaveLength(1);
		expect(rootMeta[0].name).toBe("class");
	});
});

describe("cleanupAndCommit", () => {
	const written = (file: string, status: FileWriteResult["status"], hashes: [string, string], buildTime: string) =>
		({
			relativePathWithExt: file,
			absolutePath: path.join(OUT, file),
			status,
			snapshot: {
				outputDir: OUT,
				filePath: file,
				publishedTime: buildTime,
				modifiedTime: buildTime,
				contentHash: hashes[0],
				frontmatterHash: hashes[1],
				buildTime,
			},
			categoryKey: "classes",
			label: path.basename(file, ".mdx"),
			routePath: `/api/${file.replace(/\.mdx$/, "")}`,
		}) satisfies FileWriteResult;

	it("batch upserts snapshots for written files only", async () => {
		const buildTime = new Date().toISOString();
		const results: FileWriteResult[] = [
			written("class/foo.mdx", "new", ["abc", "def"], buildTime),
			written("class/bar.mdx", "unchanged", ["ghi", "jkl"], buildTime),
		];

		const snapshots = await Effect.runPromise(
			Effect.gen(function* () {
				yield* cleanupAndCommit({
					buildId: TEST_BUILD_ID,
					fileResults: results,
					resolvedOutputDir: OUT,
					generatedFiles: new Set(["class/foo.mdx", "class/bar.mdx"]),
				});
				const svc = yield* SnapshotService;
				return yield* svc.getAllForDirectory(OUT);
			}).pipe(Effect.provide(Layer.mergeAll(MemoryFileSystem.layerWith(outputDir), SnapshotService.layerMemory()))),
		);

		// Only written file should have a snapshot (not unchanged)
		expect(snapshots.length).toBe(1);
		expect(snapshots[0].filePath).toBe("class/foo.mdx");
	});

	it("deletes orphaned files not in generatedFiles set", async () => {
		const orphan = path.join(OUT, "class", "orphan.mdx");

		const exists = await Effect.runPromise(
			Effect.gen(function* () {
				yield* cleanupAndCommit({
					buildId: TEST_BUILD_ID,
					fileResults: [],
					resolvedOutputDir: OUT,
					generatedFiles: new Set(),
				});
				const fs = yield* FileSystem.FileSystem;
				return yield* fs.exists(orphan);
			}).pipe(
				Effect.provide(
					Layer.mergeAll(MemoryFileSystem.layerWith({ [orphan]: "old content" }), SnapshotService.layerMemory()),
				),
			),
		);

		expect(exists).toBe(false);
	});

	it("removes directories emptied by stale-file cleanup, including emptied ancestors", async () => {
		// Nested layout whose only page goes stale: deleting it empties both levels
		const staleRel = "compileroptions.type/nested/type.mdx";
		const buildTime = new Date().toISOString();
		const seed: FileWriteResult[] = [
			{
				...written(staleRel, "new", ["abc", "def"], buildTime),
				categoryKey: "types",
				label: "CompilerOptions.Type",
				routePath: "/api/compileroptions.type/nested/type",
			},
		];

		const { nestedExists, parentExists, rootExists } = await Effect.runPromise(
			Effect.gen(function* () {
				// First build tracks the file in the snapshot DB
				yield* cleanupAndCommit({
					buildId: TEST_BUILD_ID,
					fileResults: seed,
					resolvedOutputDir: OUT,
					generatedFiles: new Set([staleRel]),
				});

				// Next build no longer generates it: stale cleanup deletes the file
				// before the orphan scan runs, so only the stale path knows the dir
				yield* cleanupAndCommit({
					buildId: TEST_BUILD_ID,
					fileResults: [],
					resolvedOutputDir: OUT,
					generatedFiles: new Set(),
				});

				const fs = yield* FileSystem.FileSystem;
				return {
					nestedExists: yield* fs.exists(path.join(OUT, "compileroptions.type/nested")),
					parentExists: yield* fs.exists(path.join(OUT, "compileroptions.type")),
					rootExists: yield* fs.exists(OUT),
				};
			}).pipe(
				Effect.provide(
					Layer.mergeAll(
						MemoryFileSystem.layerWith({ [path.join(OUT, staleRel)]: "old content" }),
						SnapshotService.layerMemory(),
					),
				),
			),
		);

		expect(nestedExists).toBe(false);
		expect(parentExists).toBe(false);
		// The output root itself must survive the sweep
		expect(rootExists).toBe(true);
	});
});

describe("generateSinglePage", () => {
	it("generates a page result with valid hashes", async () => {
		const modelPath = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");
		const { apiPackage } = await Effect.runPromise(loadApiModel(modelPath));
		const resolver = new CategoryResolver();
		const categories = resolver.mergeCategories(DEFAULT_CATEGORIES, undefined);
		const { workItems } = prepareWorkItems({
			apiPackage,
			categories,
			baseRoute: "/example-module",
		});

		const ctx: GenerateSinglePageContext = {
			buildId: TEST_BUILD_ID,
			existingSnapshots: new Map(),
			baseRoute: "/example-module",
			packageName: "example-module",
			apiScope: "example-module",
			linker: CrossLinker.empty,
			buildTime: new Date().toISOString(),
			resolvedOutputDir: "/tmp/nonexistent-dir",
		};

		const result = await Effect.runPromise(generateSinglePage(workItems[0], ctx).pipe(Effect.provide(PageLayer)));
		expect(result).not.toBeNull();
		if (!result) return;
		expect(result.contentHash).toMatch(/^[a-f0-9]{64}$/);
		expect(result.frontmatterHash).toMatch(/^[a-f0-9]{64}$/);
		expect(result.relativePathWithExt).toMatch(/\.mdx$/);
		expect(result.bodyContent.length).toBeGreaterThan(0);
	});

	it("returns null for unsupported item kinds", async () => {
		const fakeItem = { displayName: "Test", kind: 999 } as unknown as WorkItem["item"];
		const workItem: WorkItem = {
			item: fakeItem,
			categoryKey: "classes",
			categoryConfig: {
				folderName: "class",
				displayName: "Classes",
				singularName: "Class",
			} as WorkItem["categoryConfig"],
		};

		const ctx: GenerateSinglePageContext = {
			buildId: TEST_BUILD_ID,
			existingSnapshots: new Map(),
			baseRoute: "/test",
			packageName: "test",
			apiScope: "test",
			linker: CrossLinker.empty,
			buildTime: new Date().toISOString(),
			resolvedOutputDir: "/tmp/nonexistent-dir",
		};

		const result = await Effect.runPromise(
			generateSinglePage(workItem, ctx).pipe(
				Effect.provide(Layer.mergeAll(PageLayer, Layer.succeed(References.MinimumLogLevel, "None"))),
			),
		);
		expect(result).toBeNull();
	});

	it("marks unchanged when snapshot hashes match", async () => {
		const modelPath = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");
		const { apiPackage } = await Effect.runPromise(loadApiModel(modelPath));
		const resolver = new CategoryResolver();
		const categories = resolver.mergeCategories(DEFAULT_CATEGORIES, undefined);
		const { workItems } = prepareWorkItems({
			apiPackage,
			categories,
			baseRoute: "/example-module",
		});

		const buildTime = new Date().toISOString();
		const ctx: GenerateSinglePageContext = {
			buildId: TEST_BUILD_ID,
			existingSnapshots: new Map(),
			baseRoute: "/example-module",
			packageName: "example-module",
			apiScope: "example-module",
			linker: CrossLinker.empty,
			buildTime,
			resolvedOutputDir: "/tmp/nonexistent-dir",
		};

		const first = await Effect.runPromise(generateSinglePage(workItems[0], ctx).pipe(Effect.provide(PageLayer)));
		if (!first) throw new Error("Expected result");

		const snapshots = new Map();
		snapshots.set(first.relativePathWithExt, {
			outputDir: "/tmp/nonexistent-dir",
			filePath: first.relativePathWithExt,
			publishedTime: "2025-01-01T00:00:00.000Z",
			modifiedTime: "2025-01-01T00:00:00.000Z",
			contentHash: first.contentHash,
			frontmatterHash: first.frontmatterHash,
			buildTime,
		});

		const second = await Effect.runPromise(
			generateSinglePage(workItems[0], {
				...ctx,
				existingSnapshots: snapshots,
			}).pipe(Effect.provide(PageLayer)),
		);
		expect(second).not.toBeNull();
		if (!second) throw new Error("Expected second result to be non-null");
		expect(second.isUnchanged).toBe(true);
		expect(second.publishedTime).toBe("2025-01-01T00:00:00.000Z");
	});

	it("routes qualified namespace members whose simple name matches the category folder", async () => {
		const modelPath = path.join(import.meta.dirname, "__fixtures__/qualified-alias/qualified-alias.api.json");
		const { apiPackage } = await Effect.runPromise(loadApiModel(modelPath));
		const resolver = new CategoryResolver();
		const categories = resolver.mergeCategories(DEFAULT_CATEGORIES, undefined);
		const { workItems, crossLinkData } = prepareWorkItems({
			apiPackage,
			categories,
			baseRoute: "/tsconfig-json/api",
		});

		const typeItem = workItems.find((w) => w.namespaceMember?.qualifiedName === "CompilerOptions.Type");
		const encodedItem = workItems.find((w) => w.namespaceMember?.qualifiedName === "CompilerOptions.Encoded");
		if (!typeItem || !encodedItem) throw new Error("Expected CompilerOptions.Type and .Encoded work items");

		const ctx: GenerateSinglePageContext = {
			buildId: TEST_BUILD_ID,
			existingSnapshots: new Map(),
			baseRoute: "/tsconfig-json/api",
			packageName: "qualified-alias",
			apiScope: "qualified-alias",
			linker: CrossLinker.empty,
			buildTime: new Date().toISOString(),
			resolvedOutputDir: "/tmp/nonexistent-dir",
		};

		const typeResult = await Effect.runPromise(generateSinglePage(typeItem, ctx).pipe(Effect.provide(PageLayer)));
		if (!typeResult) throw new Error("Expected page result for CompilerOptions.Type");
		expect(typeResult.routePath).toBe("/tsconfig-json/api/type/compileroptions.type");
		expect(typeResult.relativePathWithExt).toBe("type/compileroptions.type.mdx");
		// The generated page must land on the same route prepareWorkItems registered for cross-links
		expect(crossLinkData.routes.get("CompilerOptions.Type")).toBe(typeResult.routePath);

		const encodedResult = await Effect.runPromise(generateSinglePage(encodedItem, ctx).pipe(Effect.provide(PageLayer)));
		if (!encodedResult) throw new Error("Expected page result for CompilerOptions.Encoded");
		expect(encodedResult.routePath).toBe("/tsconfig-json/api/type/compileroptions.encoded");
		expect(encodedResult.relativePathWithExt).toBe("type/compileroptions.encoded.mdx");
	});
});

describe("writeSingleFile", () => {
	/** The page fixture the OG tests below reuse. */

	// FORBIDS: swallowing an OgImageError at the call site. The service names
	// its failures precisely so the diagnostic can reach issues.json; a caller
	// that catches and drops it restores the exact state this replaced — a
	// misconfigured og:image that is silently indistinguishable from none.
	//
	// These live against generateSinglePage rather than writeSingleFile because
	// head-tag construction moved there: the tags have to exist before the
	// frontmatter hash is taken, or no head tag is visible to change detection.
	const seoCtx = async (
		overrides: Partial<GenerateSinglePageContext>,
	): Promise<{ ctx: GenerateSinglePageContext; workItem: WorkItem }> => {
		const modelPath = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");
		const { apiPackage } = await Effect.runPromise(loadApiModel(modelPath));
		const resolver = new CategoryResolver();
		const categories = resolver.mergeCategories(DEFAULT_CATEGORIES, undefined);
		const { workItems } = prepareWorkItems({
			apiPackage,
			categories,
			baseRoute: "/example-module",
		});
		return {
			workItem: workItems[0] as WorkItem,
			ctx: {
				buildId: TEST_BUILD_ID,
				existingSnapshots: new Map(),
				baseRoute: "/example-module",
				packageName: "example-module",
				apiScope: "example-module",
				linker: CrossLinker.empty,
				buildTime: new Date().toISOString(),
				resolvedOutputDir: "/tmp/nonexistent-dir",
				siteUrl: "https://example.com",
				...overrides,
			},
		};
	};

	const runSeo = async (
		overrides: Partial<GenerateSinglePageContext>,
	): Promise<{ result: GeneratedPageResult | null; events: PluginEvent[] }> => {
		const events: PluginEvent[] = [];
		const bus = makeEventBusLayer([{ minLevel: "trace", handle: (e) => events.push(e) }]);
		const { ctx, workItem } = await seoCtx(overrides);
		const result = await Effect.runPromise(
			generateSinglePage(workItem, ctx).pipe(
				Effect.provide(
					Layer.mergeAll(
						PageLayer,
						bus as unknown as Layer.Layer<never>,
						Layer.succeed(References.MinimumLogLevel, "None"),
					),
				),
			),
		);
		return { result, events };
	};

	it("degrades on a misconfigured OG image AND reports it", async () => {
		// Neither absolute nor root-relative: unusable.
		const { result, events } = await runSeo({ ogImage: "not-a-usable-path" });

		// Degraded, not failed: the page still has content to write.
		expect(result).not.toBeNull();
		expect(result?.content).toContain("rel: canonical");
		expect(result?.content).not.toContain("og:image");
		// And reported, so it lands in issues.json.
		expect(events).toContainEqual(
			expect.objectContaining({
				_tag: "ConfigValidationWarning",
				field: "ogImage",
				value: "not-a-usable-path",
			}),
		);
	});

	// FORBIDS: emitting a warning when the image resolved fine — a false
	// positive in issues.json is as bad as a missing one.
	it("reports nothing when the OG image resolves", async () => {
		const { result, events } = await runSeo({ ogImage: "/images/og.png" });

		expect(events.filter((e) => e._tag === "ConfigValidationWarning")).toHaveLength(0);
		expect(result?.content).toContain("https://example.com/images/og.png");
	});

	// FORBIDS the defect this stage move exists to close: an og:image change
	// that rewrites the file while change detection still calls it unchanged.
	// The hash is taken over the FINAL frontmatter, head tags included, so two
	// different images must give two different hashes.
	it("makes a head-tag change visible to the frontmatter hash", async () => {
		const a = await runSeo({ ogImage: "/images/og.png" });
		const b = await runSeo({ ogImage: "/images/other.png" });

		expect(a.result?.content).not.toBe(b.result?.content);
		expect(a.result?.frontmatterHash).not.toBe(b.result?.frontmatterHash);
	});

	// FORBIDS the inverse: a hash that moves with the timestamps it is supposed
	// to decide. Hashing the final frontmatter is only sound because
	// hashFrontmatter strips every timestamp it can reach.
	it("keeps the frontmatter hash independent of the build time", async () => {
		const a = await runSeo({ ogImage: "/images/og.png", buildTime: "2020-01-01T00:00:00.000Z" });
		const b = await runSeo({ ogImage: "/images/og.png", buildTime: "2030-06-15T12:34:56.000Z" });

		expect(a.result?.frontmatterHash).toBe(b.result?.frontmatterHash);
	});

	describe("bundle Open Graph image", () => {
		const bundleImage = {
			url: "https://cdn.example.com/tsdoctor/kitchensink/k.png",
			width: 1,
			height: 1,
			alt: "Kitchen Sink API documentation",
		};

		// FORBIDS the bundle image winning when the legacy option is configured:
		// only the option can probe `docs/public`, which the bundle resolver
		// cannot see, so it must keep outranking a bundle-supplied image.
		it("prefers the legacy ogImage option over the bundle image", async () => {
			const { result } = await runSeo({ ogImage: "/images/og.png", bundleOgImage: bundleImage });

			expect(result?.content).toContain("https://example.com/images/og.png");
			expect(result?.content).not.toContain(bundleImage.url);
		});

		it("falls back to the bundle image when no ogImage option is configured", async () => {
			const { result } = await runSeo({ bundleOgImage: bundleImage });

			const { data } = parseFrontmatter(result?.content ?? "");
			const head = data.head as ReadonlyArray<[string, Record<string, string>]>;
			expect(head).toContainEqual(["meta", { property: "og:image", content: bundleImage.url }]);
			expect(head).toContainEqual(["meta", { property: "og:image:width", content: "1" }]);
			expect(head).toContainEqual(["meta", { property: "og:image:height", content: "1" }]);
		});

		it("emits og:site_name from the resolved bundle's site name and og:title from the item's display name", async () => {
			const events: PluginEvent[] = [];
			const bus = makeEventBusLayer([{ minLevel: "trace", handle: (e) => events.push(e) }]);
			const { ctx, workItem } = await seoCtx({ siteName: "tsdoctor" });
			const result = await Effect.runPromise(
				generateSinglePage(workItem, ctx).pipe(
					Effect.provide(
						Layer.mergeAll(
							PageLayer,
							bus as unknown as Layer.Layer<never>,
							Layer.succeed(References.MinimumLogLevel, "None"),
						),
					),
				),
			);

			const { data } = parseFrontmatter(result?.content ?? "");
			const head = data.head as ReadonlyArray<[string, Record<string, string>]>;
			expect(head).toContainEqual(["meta", { property: "og:site_name", content: "tsdoctor" }]);
			expect(head).toContainEqual(["meta", { property: "og:title", content: workItem.item.displayName }]);
		});

		// Extends the existing hash-direction pin: a bundle-image URL change must
		// move the frontmatter hash exactly like an ogImage-option change does —
		// both flow through the same `headTags` call the hash is taken over.
		it("makes a bundle-image URL change visible to the frontmatter hash", async () => {
			const a = await runSeo({ bundleOgImage: bundleImage });
			const b = await runSeo({ bundleOgImage: { ...bundleImage, url: "https://cdn.example.com/other.png" } });

			expect(a.result?.frontmatterHash).not.toBe(b.result?.frontmatterHash);
		});
	});

	it("writes a changed file to disk and returns correct result", async () => {
		const page: GeneratedPageResult = {
			workItem: {
				item: { displayName: "Foo" } as GeneratedPageResult["workItem"]["item"],
				categoryKey: "classes",
				categoryConfig: {
					folderName: "class",
					displayName: "Classes",
					singularName: "Class",
				} as GeneratedPageResult["workItem"]["categoryConfig"],
			},
			content: "---\ntitle: Foo\n---\n# Foo\n",
			bodyContent: "# Foo\n",
			frontmatter: { title: "Foo" },
			contentHash: "abc123",
			frontmatterHash: "def456",
			routePath: "/example-module/class/foo",
			relativePathWithExt: "class/foo.mdx",
			publishedTime: "2025-01-01T00:00:00.000Z",
			modifiedTime: "2025-01-01T00:00:00.000Z",
			isUnchanged: false,
		};

		const ctx: WriteSingleFileContext = {
			buildId: TEST_BUILD_ID,
			resolvedOutputDir: OUT,
			buildTime: new Date().toISOString(),
		};

		// Write and read back inside ONE provide: the volume is the one written to.
		const { result, exists } = await Effect.runPromise(
			Effect.gen(function* () {
				const result = yield* writeSingleFile(page, ctx);
				const fs = yield* FileSystem.FileSystem;
				return { result, exists: yield* fs.exists(result.absolutePath) };
			}).pipe(Effect.provide(PageLayer)),
		);
		expect(result.status).toBe("new");
		expect(result.snapshot.contentHash).toBe("abc123");
		expect(result.snapshot.frontmatterHash).toBe("def456");
		expect(result.snapshot.filePath).toBe("class/foo.mdx");
		expect(result.label).toBe("Foo");
		expect(result.categoryKey).toBe("classes");
		expect(exists).toBe(true);
	});

	it("skips write for unchanged files", async () => {
		const page: GeneratedPageResult = {
			workItem: {
				item: { displayName: "Bar" } as GeneratedPageResult["workItem"]["item"],
				categoryKey: "classes",
				categoryConfig: {
					folderName: "class",
					displayName: "Classes",
					singularName: "Class",
				} as GeneratedPageResult["workItem"]["categoryConfig"],
			},
			content: "---\ntitle: Bar\n---\n# Bar\n",
			bodyContent: "# Bar\n",
			frontmatter: { title: "Bar" },
			contentHash: "abc",
			frontmatterHash: "def",
			routePath: "/example-module/class/bar",
			relativePathWithExt: "class/bar.mdx",
			publishedTime: "2025-01-01T00:00:00.000Z",
			modifiedTime: "2025-01-01T00:00:00.000Z",
			isUnchanged: true,
		};

		const ctx: WriteSingleFileContext = {
			buildId: TEST_BUILD_ID,
			resolvedOutputDir: OUT,
			buildTime: new Date().toISOString(),
		};

		const { result, exists } = await Effect.runPromise(
			Effect.gen(function* () {
				const result = yield* writeSingleFile(page, ctx);
				const fs = yield* FileSystem.FileSystem;
				return { result, exists: yield* fs.exists(result.absolutePath) };
			}).pipe(Effect.provide(PageLayer)),
		);
		expect(result.status).toBe("unchanged");
		expect(exists).toBe(false);
	});
});

describe("Stream pipeline (native)", () => {
	it("streams items through generate → write → fold", async () => {
		const modelPath = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");
		const { apiPackage } = await Effect.runPromise(loadApiModel(modelPath));
		const resolver = new CategoryResolver();
		const categories = resolver.mergeCategories(DEFAULT_CATEGORIES, undefined);
		const { workItems } = prepareWorkItems({
			apiPackage,
			categories,
			baseRoute: "/example-module",
		});

		const program = buildPipelineForApi({
			buildId: TEST_BUILD_ID,
			workItems,
			baseRoute: "/example-module",
			packageName: "example-module",
			apiScope: "example-module",
			linker: CrossLinker.empty,
			buildTime: new Date().toISOString(),
			resolvedOutputDir: OUT,
			pageConcurrency: 2,
			existingSnapshots: new Map(),
		});

		// Build and check the written files inside ONE provide.
		const { results, missing } = await Effect.runPromise(
			Effect.gen(function* () {
				const results = yield* program;
				const fs = yield* FileSystem.FileSystem;
				const missing: string[] = [];
				for (const r of results.filter((r) => r.status !== "unchanged")) {
					if (!(yield* fs.exists(r.absolutePath))) missing.push(r.absolutePath);
				}
				return { results, missing };
			}).pipe(Effect.provide(PageLayer)),
		);

		expect(results.length).toBe(workItems.length);
		const written = results.filter((r) => r.status !== "unchanged");
		expect(written.length).toBeGreaterThan(0);
		expect(missing).toEqual([]);
	});

	it("includes unchanged files in results when snapshots match", async () => {
		const modelPath = path.join(import.meta.dirname, "__fixtures__/example-module/example-module.api.json");
		const { apiPackage } = await Effect.runPromise(loadApiModel(modelPath));
		const resolver = new CategoryResolver();
		const categories = resolver.mergeCategories(DEFAULT_CATEGORIES, undefined);
		const { workItems } = prepareWorkItems({
			apiPackage,
			categories,
			baseRoute: "/example-module",
		});

		const buildTime = new Date().toISOString();
		const build = (existingSnapshots: Parameters<typeof buildPipelineForApi>[0]["existingSnapshots"]) =>
			buildPipelineForApi({
				buildId: TEST_BUILD_ID,
				workItems,
				baseRoute: "/example-module",
				packageName: "example-module",
				apiScope: "example-module",
				linker: CrossLinker.empty,
				buildTime,
				resolvedOutputDir: OUT,
				pageConcurrency: 2,
				existingSnapshots,
			});

		// Both builds share ONE volume, as two builds share one output dir.
		const secondResults = await Effect.runPromise(
			Effect.gen(function* () {
				// First run: all new
				const firstResults = yield* build(new Map());

				// Build snapshot map
				const snapshots = new Map<string, (typeof firstResults)[number]["snapshot"]>();
				for (const r of firstResults) {
					snapshots.set(r.snapshot.filePath, r.snapshot);
				}

				// Second run: all unchanged
				return yield* build(snapshots);
			}).pipe(Effect.provide(PageLayer)),
		);

		// ALL items must still appear (not filtered)
		expect(secondResults.length).toBe(workItems.length);
		const unchanged = secondResults.filter((r) => r.status === "unchanged");
		expect(unchanged.length).toBe(workItems.length);
	});
});
