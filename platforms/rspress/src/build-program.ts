import path from "node:path";
import { attributionFacts, packageContext } from "@tsdoctor/seo";
import { SnapshotService } from "@tsdoctor/snapshot";
import { Effect, FileSystem } from "effect";
import { BuildId, PageConcurrency, SuppressExampleErrors } from "./BuildEnv.js";
import type { CrossLinkData } from "./build-stages.js";
import { buildPipelineForApi, cleanupAndCommit, prepareWorkItems, writeMetadata } from "./build-stages.js";
// The two Shiki transformers are module-level immutable consts. They used to
// travel through ResolvedBuildContext as data; importing them here is the same
// value with one fewer indirection. Note the naming: the registry field
// `hideCutTransformer` holds `MemberFormatTransformer`.
import { HideCutLinesTransformer, MemberFormatTransformer } from "./hide-cut-transformer.js";
import { setProseLinker } from "./markdown/prose-linker.js";
import { withPhase } from "./observability/spans.js";
import type { ResolvedApiConfig } from "./services/ConfigService.js";
import { HighlighterService } from "./services/HighlighterService.js";
import type { OgService } from "./services/OgService.js";
import { TwoslashEnvironments } from "./services/TwoslashEnvironments.js";
import { ShikiCrossLinker } from "./shiki-transformer.js";
import { addTypeRoutes } from "./twoslash-transformer.js";
import type { VfsConfig } from "./vfs-registry.js";
import { VfsRegistry } from "./vfs-registry.js";

/**
 * Result of generating API docs for a single API config.
 * Extends CrossLinkData with build metadata needed by post-build processing (e.g., LLMs program).
 */
export interface GenerateApiDocsResult {
	readonly crossLinkData: CrossLinkData;
	readonly generatedFiles: Set<string>;
	readonly resolvedOutputDir: string;
	readonly baseRoute: string;
	readonly packageName: string;
	readonly apiName: string | undefined;
	readonly packageVersion: string | undefined;
	readonly packageDescription: string | undefined;
}

/**
 * Generate markdown documentation for a single API as a native Effect program.
 *
 * Orchestrates the 5 build stages:
 * 1. prepareWorkItems — categorize items, build cross-link data, flatten work items
 * 2. generatePages — generate page content, hash, resolve timestamps
 * 3. writeFiles — write changed files to disk
 * 4. writeMetadata — write root _meta.json, main index, category _meta.json files
 * 5. cleanupAndCommit — batch upsert snapshots, delete stale/orphan files
 *
 * Returns build result metadata including CrossLinkData for cross-link merging
 * and generated file paths for LLMs post-processing.
 */
export function generateApiDocs(
	apiConfig: ResolvedApiConfig & { suppressExampleErrors?: boolean },
	fileContextMap: Map<string, { api?: string; version?: string; file: string }>,
): Effect.Effect<
	GenerateApiDocsResult,
	never,
	FileSystem.FileSystem | SnapshotService | HighlighterService | OgService | TwoslashEnvironments
> {
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const { highlighter } = yield* HighlighterService;
		const environments = yield* TwoslashEnvironments;
		const buildId = yield* BuildId;
		const pageConcurrency = yield* PageConcurrency;
		const suppressExampleErrors = yield* SuppressExampleErrors;
		const snapshotSvc = yield* SnapshotService;

		const {
			apiPackage,
			packageName,
			apiName,
			outputDir,
			baseRoute,
			categories,
			source,
			packageJson,
			llmsPlugin,
			siteUrl,
			ogImage,
			manifest,
		} = apiConfig;

		const phaseCtx = {
			packageName,
		};

		// Derived ONCE per API: the package node and its people are identical on
		// every page, so deriving them per page would mint several hundred
		// copies per build and re-run the attribution derivation behind each.
		// Absent when the manifest failed to decode — the SEO layer then omits
		// the JSON-LD block rather than guessing attribution.
		const structuredDataPkg =
			manifest != null && siteUrl != null
				? packageContext({
						siteUrl,
						baseRoute,
						packageName,
						...(manifest.version != null ? { version: manifest.version.toString() } : {}),
						...(manifest.description != null ? { description: manifest.description } : {}),
						attribution: attributionFacts(manifest),
					})
				: undefined;

		const resolvedOutputDir = path.resolve(process.cwd(), outputDir);
		const buildTime = new Date().toISOString();

		// Load existing snapshots from database for this outputDir
		const allSnapshots = yield* snapshotSvc.getAllForDirectory(resolvedOutputDir).pipe(Effect.orDie);
		const existingSnapshots = new Map(allSnapshots.map((s) => [s.filePath, s]));

		// Create the output directory if it doesn't exist
		yield* fileSystem.makeDirectory(resolvedOutputDir, { recursive: true }).pipe(Effect.orDie);

		// Phase 1: Prepare work items and cross-link data (sync, pure)
		const { workItems, crossLinkData } = yield* withPhase(
			"resolve",
			phaseCtx,
			Effect.sync(() =>
				prepareWorkItems({
					apiPackage,
					categories,
					baseRoute,
					packageName,
				}),
			),
		);

		// Initialize cross-linkers with the prepared data
		// Use crossLinkData.routes directly so both cross-linkers share the same
		// routes (including disambiguation suffixes for genuine route collisions)
		setProseLinker(crossLinkData.routes);
		// API scope is derived from baseRoute to match file path inference in remark plugins
		// e.g., baseRoute "/example-module" -> scope "example-module"
		// When baseRoute is "/" (single-API mode), fall back to packageName to ensure a non-empty scope
		const apiScope = baseRoute.replace(/^\//, "").split("/")[0] || packageName;
		// One immutable linker per API, held behind this scope's registry entry.
		// It replaces a single instance mutated per API by `reinitialize()`: with
		// two APIs in one build, whichever resolved last owned `currentApiScope`,
		// so a code block could be linked against another package's routes.
		const shikiCrossLinker = ShikiCrossLinker.fromRoutes(crossLinkData.routes, apiScope);
		addTypeRoutes(crossLinkData.routes);

		// Register VFS config for the remark plugin. The highlighter comes from
		// the runtime-lifetime HighlighterService, so unlike the old context
		// field it is never absent — the `if (highlighter)` guard that used to
		// wrap this could silently skip registration for a whole scope.
		const vfsConfig: VfsConfig = {
			highlighter,
			crossLinker: shikiCrossLinker,
			packageName,
			apiScope,
		};
		// Each scope is type-checked under the configuration its own package
		// declares; the build-wide transformer is only the fallback.
		// `transformerFor` already falls back to the build-wide environment for an
		// unknown scope, so the separate `?? twoslashTransformer` this replaces
		// was unreachable: it could only fire when NO environment existed, in
		// which case the fallback was null too.
		const scopeTransformer = environments.transformerFor(apiScope);
		if (scopeTransformer != null) vfsConfig.twoslashTransformer = scopeTransformer;
		vfsConfig.hideCutTransformer = MemberFormatTransformer;
		vfsConfig.hideCutLinesTransformer = HideCutLinesTransformer;
		if (apiConfig.theme != null) vfsConfig.theme = apiConfig.theme;
		VfsRegistry.register(apiScope, vfsConfig);

		// Phase 2+3: Generate pages and write files via Stream pipeline
		yield* Effect.logDebug(
			`Generating ${workItems.length} pages across ${Object.keys(categories).length} categories in parallel`,
		);

		const fileResults = yield* withPhase(
			"generate",
			phaseCtx,
			buildPipelineForApi({
				buildId,
				pageConcurrency,
				workItems,
				baseRoute,
				packageName,
				apiScope,
				...(apiName != null ? { apiName } : {}),
				...(source != null ? { source } : {}),
				buildTime,
				resolvedOutputDir,
				existingSnapshots,
				...(suppressExampleErrors != null ? { suppressExampleErrors } : {}),
				...(llmsPlugin != null ? { llmsPlugin } : {}),
				...(apiConfig.docsRoot != null ? { docsRoot: apiConfig.docsRoot } : {}),
				...(siteUrl != null ? { siteUrl } : {}),
				...(ogImage != null ? { ogImage } : {}),
				...(structuredDataPkg != null ? { structuredDataPkg } : {}),
			}),
		);

		const changedCount = fileResults.filter((r) => r.status !== "unchanged").length;
		yield* Effect.logDebug(`Generated ${changedCount} pages`);

		// Track generated files and file context
		const generatedFiles = new Set<string>();
		for (const r of fileResults) {
			generatedFiles.add(r.relativePathWithExt);
			const ctx: { api?: string; version?: string; file: string } = {
				file: r.relativePathWithExt,
			};
			if (apiName != null) ctx.api = apiName;
			if (packageJson?.version != null) ctx.version = packageJson.version;
			fileContextMap.set(r.absolutePath, ctx);
		}

		// Phase 4: Write metadata (root _meta.json, main index, category _meta.json)
		yield* withPhase(
			"write",
			phaseCtx,
			writeMetadata({
				buildId,
				fileResults,
				categories,
				resolvedOutputDir,
				existingSnapshots,
				buildTime,
				baseRoute,
				packageName,
				...(apiName != null ? { apiName } : {}),
				generatedFiles,
			}),
		);

		// Phase 5: Cleanup and commit snapshots
		yield* withPhase(
			"cleanup",
			phaseCtx,
			cleanupAndCommit({
				buildId,
				fileResults,
				resolvedOutputDir,
				generatedFiles,
			}),
		);

		yield* Effect.logDebug(`Generated ${changedCount} API documentation files for ${packageName}`);

		return {
			crossLinkData,
			generatedFiles,
			resolvedOutputDir,
			baseRoute,
			packageName,
			apiName: apiName ?? undefined,
			packageVersion: packageJson?.version,
			packageDescription: typeof packageJson?.description === "string" ? packageJson.description : undefined,
		};
	});
}
