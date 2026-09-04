import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NodeFileSystem } from "@effect/platform-node";
import { ApiModel } from "@microsoft/api-extractor-model";
import { CrossLinker, parseFrontmatter } from "@tsdoctor/model";
import { SnapshotService } from "@tsdoctor/snapshot";
import { Effect, Layer, References } from "effect";
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
import { TestOgServiceLayer } from "./utils/layers.js";

const TEST_BUILD_ID = "test-build";

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
	it("writes _meta.json files for categories with items", async () => {
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "meta-test-"));
		const dbPath = path.join(tmpDir, "test.db");
		const generatedFiles = new Set<string>();

		const categories: Record<string, CategoryConfig> = {
			classes: {
				folderName: "class",
				displayName: "Classes",
				singularName: "Class",
				collapsible: true,
				collapsed: true,
				overviewHeaders: [2],
			},
		};

		const results: FileWriteResult[] = [
			{
				relativePathWithExt: "class/foo.mdx",
				absolutePath: path.join(tmpDir, "class/foo.mdx"),
				status: "new",
				snapshot: {
					outputDir: tmpDir,
					filePath: "class/foo.mdx",
					publishedTime: "",
					modifiedTime: "",
					contentHash: "a",
					frontmatterHash: "b",
					buildTime: "",
				},
				categoryKey: "classes",
				label: "Foo",
				routePath: "/api/class/foo",
			},
			{
				relativePathWithExt: "class/bar.mdx",
				absolutePath: path.join(tmpDir, "class/bar.mdx"),
				status: "new",
				snapshot: {
					outputDir: tmpDir,
					filePath: "class/bar.mdx",
					publishedTime: "",
					modifiedTime: "",
					contentHash: "c",
					frontmatterHash: "d",
					buildTime: "",
				},
				categoryKey: "classes",
				label: "Bar",
				routePath: "/api/class/bar",
			},
		];

		await Effect.runPromise(
			writeMetadata({
				buildId: TEST_BUILD_ID,
				fileResults: results,
				categories,
				resolvedOutputDir: tmpDir,
				existingSnapshots: new Map(),
				buildTime: new Date().toISOString(),
				baseRoute: "/api",
				packageName: "test-package",
				generatedFiles,
			}).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, SnapshotService.layer(dbPath)))),
		);

		// Category _meta.json should exist with sorted entries
		const metaPath = path.join(tmpDir, "class/_meta.json");
		const metaContent = JSON.parse(await fs.promises.readFile(metaPath, "utf-8"));
		expect(metaContent).toHaveLength(2);
		expect(metaContent[0].label).toBe("Bar");
		expect(metaContent[1].label).toBe("Foo");

		// Root _meta.json should exist with category dir entry
		const rootMetaPath = path.join(tmpDir, "_meta.json");
		const rootMeta = JSON.parse(await fs.promises.readFile(rootMetaPath, "utf-8"));
		expect(rootMeta).toHaveLength(1);
		expect(rootMeta[0].type).toBe("dir");
		expect(rootMeta[0].name).toBe("class");
		expect(rootMeta[0].label).toBe("Classes");

		// generatedFiles should track all metadata files
		expect(generatedFiles.has("_meta.json")).toBe(true);
		expect(generatedFiles.has("class/_meta.json")).toBe(true);
		expect(generatedFiles.has("index.mdx")).toBe(true);

		// index.mdx should have been written
		const indexPath = path.join(tmpDir, "index.mdx");
		const indexExists = await fs.promises
			.access(indexPath)
			.then(() => true)
			.catch(() => false);
		expect(indexExists).toBe(true);

		await fs.promises.rm(tmpDir, { recursive: true });
	});

	it("skips writing _meta.json when content is unchanged (snapshot match)", async () => {
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "meta-unchanged-"));
		const dbPath = path.join(tmpDir, "test.db");
		const snapshotLayer = SnapshotService.layer(dbPath);

		const categories: Record<string, CategoryConfig> = {
			classes: {
				folderName: "class",
				displayName: "Classes",
				singularName: "Class",
				collapsible: true,
				collapsed: true,
				overviewHeaders: [2],
			},
		};

		const results: FileWriteResult[] = [
			{
				relativePathWithExt: "class/foo.mdx",
				absolutePath: path.join(tmpDir, "class/foo.mdx"),
				status: "unchanged",
				snapshot: {
					outputDir: tmpDir,
					filePath: "class/foo.mdx",
					publishedTime: "2024-01-01T00:00:00.000Z",
					modifiedTime: "2024-01-01T00:00:00.000Z",
					contentHash: "a",
					frontmatterHash: "b",
					buildTime: "2024-01-01T00:00:00.000Z",
				},
				categoryKey: "classes",
				label: "Foo",
				routePath: "/api/class/foo",
			},
		];

		const testLayer = Layer.mergeAll(NodeFileSystem.layer, snapshotLayer);

		// First write — creates the files
		const generatedFiles1 = new Set<string>();
		await Effect.runPromise(
			writeMetadata({
				buildId: TEST_BUILD_ID,
				fileResults: results,
				categories,
				resolvedOutputDir: tmpDir,
				existingSnapshots: new Map(),
				buildTime: new Date().toISOString(),
				baseRoute: "/api",
				packageName: "test-package",
				generatedFiles: generatedFiles1,
			}).pipe(Effect.provide(testLayer)),
		);

		const metaPath = path.join(tmpDir, "class/_meta.json");
		const statBefore = await fs.promises.stat(metaPath);

		// Build the existingSnapshots by reading the snapshot DB via SnapshotService
		const existingSnapshots = await Effect.runPromise(
			Effect.gen(function* () {
				const svc = yield* SnapshotService;
				const all = yield* svc.getAllForDirectory(tmpDir);
				return new Map(all.map((s) => [s.filePath, s]));
			}).pipe(Effect.provide(snapshotLayer)),
		);

		// Second write — should be unchanged, file mtime should not change
		const generatedFiles2 = new Set<string>();
		await Effect.runPromise(
			writeMetadata({
				buildId: TEST_BUILD_ID,
				fileResults: results,
				categories,
				resolvedOutputDir: tmpDir,
				existingSnapshots,
				buildTime: new Date().toISOString(),
				baseRoute: "/api",
				packageName: "test-package",
				generatedFiles: generatedFiles2,
			}).pipe(Effect.provide(testLayer)),
		);

		const statAfter = await fs.promises.stat(metaPath);
		// File should not have been rewritten (mtime unchanged)
		expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);

		await fs.promises.rm(tmpDir, { recursive: true });
	});

	it("excludes categories with no items from root _meta.json", async () => {
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "meta-empty-cat-"));
		const dbPath = path.join(tmpDir, "test.db");
		const generatedFiles = new Set<string>();

		const categories: Record<string, CategoryConfig> = {
			classes: {
				folderName: "class",
				displayName: "Classes",
				singularName: "Class",
				collapsible: true,
				collapsed: true,
				overviewHeaders: [2],
			},
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
		const results: FileWriteResult[] = [
			{
				relativePathWithExt: "class/foo.mdx",
				absolutePath: path.join(tmpDir, "class/foo.mdx"),
				status: "new",
				snapshot: {
					outputDir: tmpDir,
					filePath: "class/foo.mdx",
					publishedTime: "",
					modifiedTime: "",
					contentHash: "a",
					frontmatterHash: "b",
					buildTime: "",
				},
				categoryKey: "classes",
				label: "Foo",
				routePath: "/api/class/foo",
			},
		];

		await Effect.runPromise(
			writeMetadata({
				buildId: TEST_BUILD_ID,
				fileResults: results,
				categories,
				resolvedOutputDir: tmpDir,
				existingSnapshots: new Map(),
				buildTime: new Date().toISOString(),
				baseRoute: "/api",
				packageName: "test-package",
				generatedFiles,
			}).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, SnapshotService.layer(dbPath)))),
		);

		const rootMeta = JSON.parse(await fs.promises.readFile(path.join(tmpDir, "_meta.json"), "utf-8"));
		// Only "class" should appear — "interface" has no items
		expect(rootMeta).toHaveLength(1);
		expect(rootMeta[0].name).toBe("class");

		await fs.promises.rm(tmpDir, { recursive: true });
	});
});

describe("cleanupAndCommit", () => {
	it("batch upserts snapshots for written files only", async () => {
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "cleanup-test-"));
		const dbPath = path.join(tmpDir, "test.db");
		const snapshotLayer = SnapshotService.layer(dbPath);

		const buildTime = new Date().toISOString();
		const results: FileWriteResult[] = [
			{
				relativePathWithExt: "class/foo.mdx",
				absolutePath: path.join(tmpDir, "class/foo.mdx"),
				status: "new",
				snapshot: {
					outputDir: tmpDir,
					filePath: "class/foo.mdx",
					publishedTime: buildTime,
					modifiedTime: buildTime,
					contentHash: "abc",
					frontmatterHash: "def",
					buildTime,
				},
				categoryKey: "classes",
				label: "Foo",
				routePath: "/api/class/foo",
			},
			{
				relativePathWithExt: "class/bar.mdx",
				absolutePath: path.join(tmpDir, "class/bar.mdx"),
				status: "unchanged",
				snapshot: {
					outputDir: tmpDir,
					filePath: "class/bar.mdx",
					publishedTime: buildTime,
					modifiedTime: buildTime,
					contentHash: "ghi",
					frontmatterHash: "jkl",
					buildTime,
				},
				categoryKey: "classes",
				label: "Bar",
				routePath: "/api/class/bar",
			},
		];

		const testLayer = Layer.mergeAll(NodeFileSystem.layer, snapshotLayer);

		await Effect.runPromise(
			cleanupAndCommit({
				buildId: TEST_BUILD_ID,
				fileResults: results,
				resolvedOutputDir: tmpDir,
				generatedFiles: new Set(["class/foo.mdx", "class/bar.mdx"]),
			}).pipe(Effect.provide(testLayer)),
		);

		// Only written file should have a snapshot (not unchanged)
		const snapshots = await Effect.runPromise(
			Effect.gen(function* () {
				const svc = yield* SnapshotService;
				return yield* svc.getAllForDirectory(tmpDir);
			}).pipe(Effect.provide(snapshotLayer)),
		);
		expect(snapshots.length).toBe(1);
		expect(snapshots[0].filePath).toBe("class/foo.mdx");

		await fs.promises.rm(tmpDir, { recursive: true });
	});

	it("deletes orphaned files not in generatedFiles set", async () => {
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "orphan-test-"));
		const dbPath = path.join(tmpDir, "test.db");

		const orphanDir = path.join(tmpDir, "class");
		await fs.promises.mkdir(orphanDir, { recursive: true });
		await fs.promises.writeFile(path.join(orphanDir, "orphan.mdx"), "old content");

		await Effect.runPromise(
			cleanupAndCommit({
				buildId: TEST_BUILD_ID,
				fileResults: [],
				resolvedOutputDir: tmpDir,
				generatedFiles: new Set(),
			}).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, SnapshotService.layer(dbPath)))),
		);

		const exists = await fs.promises
			.access(path.join(orphanDir, "orphan.mdx"))
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);

		await fs.promises.rm(tmpDir, { recursive: true });
	});

	it("removes directories emptied by stale-file cleanup, including emptied ancestors", async () => {
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "stale-dir-test-"));
		const dbPath = path.join(tmpDir, "test.db");
		const snapshotLayer = SnapshotService.layer(dbPath);
		const testLayer = Layer.mergeAll(NodeFileSystem.layer, snapshotLayer);

		// Nested layout whose only page goes stale: deleting it empties both levels
		const staleRel = "compileroptions.type/nested/type.mdx";
		await fs.promises.mkdir(path.join(tmpDir, "compileroptions.type/nested"), { recursive: true });
		await fs.promises.writeFile(path.join(tmpDir, staleRel), "old content");

		const buildTime = new Date().toISOString();
		const seed: FileWriteResult[] = [
			{
				relativePathWithExt: staleRel,
				absolutePath: path.join(tmpDir, staleRel),
				status: "new",
				snapshot: {
					outputDir: tmpDir,
					filePath: staleRel,
					publishedTime: buildTime,
					modifiedTime: buildTime,
					contentHash: "abc",
					frontmatterHash: "def",
					buildTime,
				},
				categoryKey: "types",
				label: "CompilerOptions.Type",
				routePath: "/api/compileroptions.type/nested/type",
			},
		];

		// First build tracks the file in the snapshot DB
		await Effect.runPromise(
			cleanupAndCommit({
				buildId: TEST_BUILD_ID,
				fileResults: seed,
				resolvedOutputDir: tmpDir,
				generatedFiles: new Set([staleRel]),
			}).pipe(Effect.provide(testLayer)),
		);

		// Next build no longer generates it: stale cleanup deletes the file
		// before the orphan scan runs, so only the stale path knows the dir
		await Effect.runPromise(
			cleanupAndCommit({
				buildId: TEST_BUILD_ID,
				fileResults: [],
				resolvedOutputDir: tmpDir,
				generatedFiles: new Set(),
			}).pipe(Effect.provide(testLayer)),
		);

		const nestedExists = await fs.promises
			.access(path.join(tmpDir, "compileroptions.type/nested"))
			.then(() => true)
			.catch(() => false);
		const parentExists = await fs.promises
			.access(path.join(tmpDir, "compileroptions.type"))
			.then(() => true)
			.catch(() => false);
		expect(nestedExists).toBe(false);
		expect(parentExists).toBe(false);

		// The output root itself must survive the sweep
		const rootExists = await fs.promises
			.access(tmpDir)
			.then(() => true)
			.catch(() => false);
		expect(rootExists).toBe(true);

		await fs.promises.rm(tmpDir, { recursive: true });
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

		const result = await Effect.runPromise(
			generateSinglePage(workItems[0], ctx).pipe(
				Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer)),
			),
		);
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
				Effect.provide(
					Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer, Layer.succeed(References.MinimumLogLevel, "None")),
				),
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

		const first = await Effect.runPromise(
			generateSinglePage(workItems[0], ctx).pipe(
				Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer)),
			),
		);
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
			}).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer))),
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

		const typeResult = await Effect.runPromise(
			generateSinglePage(typeItem, ctx).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer))),
		);
		if (!typeResult) throw new Error("Expected page result for CompilerOptions.Type");
		expect(typeResult.routePath).toBe("/tsconfig-json/api/type/compileroptions.type");
		expect(typeResult.relativePathWithExt).toBe("type/compileroptions.type.mdx");
		// The generated page must land on the same route prepareWorkItems registered for cross-links
		expect(crossLinkData.routes.get("CompilerOptions.Type")).toBe(typeResult.routePath);

		const encodedResult = await Effect.runPromise(
			generateSinglePage(encodedItem, ctx).pipe(
				Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer)),
			),
		);
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
						NodeFileSystem.layer,
						TestOgServiceLayer,
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
							NodeFileSystem.layer,
							TestOgServiceLayer,
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
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "write-single-"));

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
			resolvedOutputDir: tmpDir,
			buildTime: new Date().toISOString(),
		};

		const result = await Effect.runPromise(
			writeSingleFile(page, ctx).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer))),
		);
		expect(result.status).toBe("new");
		expect(result.snapshot.contentHash).toBe("abc123");
		expect(result.snapshot.frontmatterHash).toBe("def456");
		expect(result.snapshot.filePath).toBe("class/foo.mdx");
		expect(result.label).toBe("Foo");
		expect(result.categoryKey).toBe("classes");

		const exists = await fs.promises
			.access(result.absolutePath)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(true);

		await fs.promises.rm(tmpDir, { recursive: true });
	});

	it("skips write for unchanged files", async () => {
		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "write-single-"));

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
			resolvedOutputDir: tmpDir,
			buildTime: new Date().toISOString(),
		};

		const result = await Effect.runPromise(
			writeSingleFile(page, ctx).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer))),
		);
		expect(result.status).toBe("unchanged");

		const exists = await fs.promises
			.access(result.absolutePath)
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(false);

		await fs.promises.rm(tmpDir, { recursive: true });
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

		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "native-stream-"));

		const program = buildPipelineForApi({
			buildId: TEST_BUILD_ID,
			workItems,
			baseRoute: "/example-module",
			packageName: "example-module",
			apiScope: "example-module",
			linker: CrossLinker.empty,
			buildTime: new Date().toISOString(),
			resolvedOutputDir: tmpDir,
			pageConcurrency: 2,
			existingSnapshots: new Map(),
		});

		const results = await Effect.runPromise(
			program.pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer))),
		);

		expect(results.length).toBe(workItems.length);
		const written = results.filter((r) => r.status !== "unchanged");
		expect(written.length).toBeGreaterThan(0);

		for (const r of written) {
			const exists = await fs.promises
				.access(r.absolutePath)
				.then(() => true)
				.catch(() => false);
			expect(exists).toBe(true);
		}

		await fs.promises.rm(tmpDir, { recursive: true });
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

		const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "native-stream-2-"));
		const buildTime = new Date().toISOString();

		// First run: all new
		const firstResults = await Effect.runPromise(
			buildPipelineForApi({
				buildId: TEST_BUILD_ID,
				workItems,
				baseRoute: "/example-module",
				packageName: "example-module",
				apiScope: "example-module",
				linker: CrossLinker.empty,
				buildTime,
				resolvedOutputDir: tmpDir,
				pageConcurrency: 2,
				existingSnapshots: new Map(),
			}).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer))),
		);

		// Build snapshot map
		const snapshots = new Map<string, (typeof firstResults)[number]["snapshot"]>();
		for (const r of firstResults) {
			snapshots.set(r.snapshot.filePath, r.snapshot);
		}

		// Second run: all unchanged
		const secondResults = await Effect.runPromise(
			buildPipelineForApi({
				buildId: TEST_BUILD_ID,
				workItems,
				baseRoute: "/example-module",
				packageName: "example-module",
				apiScope: "example-module",
				linker: CrossLinker.empty,
				buildTime,
				resolvedOutputDir: tmpDir,
				pageConcurrency: 2,
				existingSnapshots: snapshots,
			}).pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, TestOgServiceLayer))),
		);

		// ALL items must still appear (not filtered)
		expect(secondResults.length).toBe(workItems.length);
		const unchanged = secondResults.filter((r) => r.status === "unchanged");
		expect(unchanged.length).toBe(workItems.length);

		await fs.promises.rm(tmpDir, { recursive: true });
	});
});
