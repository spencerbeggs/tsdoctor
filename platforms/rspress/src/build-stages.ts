import path from "node:path";
import type { ApiPackage } from "@microsoft/api-extractor-model";
import type { CrossLinker } from "@tsdoctor/model";
import { Routes, parseFrontmatter, stringifyFrontmatter } from "@tsdoctor/model";
import type { CrossLinkData, NavCategory, WorkItem as PagesWorkItem } from "@tsdoctor/pages";
import {
	NavEntry,
	buildIndexPage,
	buildNav,
	buildPage,
	prepareWorkItems as preparePagesWorkItems,
} from "@tsdoctor/pages";
import type { OpenGraphImageConfig, OpenGraphImageMetadata, PackageContext } from "@tsdoctor/seo";
import { deriveScriptBody, headTags } from "@tsdoctor/seo";
import type { FileSnapshot } from "@tsdoctor/snapshot";
import { SnapshotService, hashContent, hashFrontmatter } from "@tsdoctor/snapshot";
import { Effect, FileSystem, Metric, Option, Stream } from "effect";
import { emitMdxBody } from "./emit/mdx.js";
import { emitIndexPage, renderCategoryMeta, renderRootMeta } from "./emit/meta.js";
import { BuildMetrics } from "./layers/build-metrics.js";
import { generateFrontmatter } from "./markdown/helpers.js";
import { emit } from "./observability/EventBus.js";
import { PluginEvent } from "./observability/events.js";
import { emitSync, syncBuildId } from "./observability/sync-emitter.js";
import type { CategoryConfig, LlmsPlugin, SourceConfig } from "./schemas/config.js";
import { OgService } from "./services/OgService.js";

export type { FileSnapshot } from "@tsdoctor/snapshot";

/**
 * Lower number = higher priority for which page a bare cross-link name resolves to.
 *
 * @remarks
 * Re-exported from `@tsdoctor/pages`, where the computation now lives.
 */
/** A page to build, with the adapter's `CategoryConfig` as its category. */
export type WorkItem = PagesWorkItem<CategoryConfig>;

export interface GeneratedPageResult {
	readonly workItem: WorkItem;
	readonly content: string;
	readonly bodyContent: string;
	readonly frontmatter: Record<string, unknown>;
	readonly contentHash: string;
	readonly frontmatterHash: string;
	readonly routePath: string;
	readonly relativePathWithExt: string;
	readonly publishedTime: string;
	readonly modifiedTime: string;
	readonly isUnchanged: boolean;
}

export type { CrossLinkData } from "@tsdoctor/pages";

export interface FileWriteResult {
	readonly relativePathWithExt: string;
	readonly absolutePath: string;
	readonly status: "new" | "modified" | "unchanged";
	readonly snapshot: FileSnapshot;
	readonly categoryKey: string;
	readonly label: string;
	readonly routePath: string;
}

export interface PrepareWorkItemsInput {
	readonly apiPackage: ApiPackage;
	readonly categories: Record<string, CategoryConfig>;
	readonly baseRoute: string;
}

export interface PrepareWorkItemsResult {
	readonly workItems: WorkItem[];
	readonly crossLinkData: CrossLinkData;
}

/**
 * Prepare the flat list of WorkItems to process and the cross-link data maps.
 *
 * The computation lives in `@tsdoctor/pages`' `prepareWorkItems`; this is
 * the adapter's reporting over its result: an `ItemSkipped` warning per
 * uncategorized item through the sync-island seam, and a typed
 * `RouteCollisionDetected` event per collision before the fatal
 * `Routes.RouteCollisionError` — so the fatal build path still surfaces the
 * collision in .api-docs/build/issues.json (see plugin.ts's config() catch).
 *
 * NOTE: This function does NOT install the prose linker. The caller
 * is responsible for passing the returned crossLinkData to the cross-linker and
 * Shiki cross-linker as needed.
 */
export function prepareWorkItems(input: PrepareWorkItemsInput): PrepareWorkItemsResult {
	const { apiPackage, categories, baseRoute } = input;
	const prepared = preparePagesWorkItems({ apiPackage, categories, baseRoute });

	for (const skipped of prepared.uncategorized) {
		emitSync(
			PluginEvent.ItemSkipped({
				ctx: { buildId: syncBuildId() },
				item: skipped.displayName,
				kind: String(skipped.kind),
				reason: "uncategorized",
				level: "warn",
			}),
		);
	}

	// Fail fast: two distinct items must never resolve to the same output route.
	if (prepared.collisions.length > 0) {
		// Guard the emit so a throwing event sink cannot replace the collision
		// error — the fatal route-collision contract must survive here.
		try {
			for (const collision of prepared.collisions) {
				emitSync(
					PluginEvent.RouteCollisionDetected({
						ctx: { buildId: syncBuildId(), route: collision.route },
						level: "error",
						items: collision.items.map((item) => `${item.displayName} (${item.kind}) [${item.canonicalRef}]`),
					}),
				);
			}
		} catch {
			// event-delivery failure must not mask the route-collision error
		}
		throw new Routes.RouteCollisionError({ baseRoute, collisions: prepared.collisions });
	}

	return { workItems: prepared.workItems, crossLinkData: prepared.crossLinkData };
}

/**
 * Normalize markdown spacing by removing excessive blank lines.
 * - Remove extra blank lines between headings and code blocks
 * - Ensure single blank line between sections
 */
function normalizeMarkdownSpacing(content: string): string {
	return (
		content
			// Remove multiple consecutive blank lines (3+ blank lines -> 1 blank line)
			.replace(/\n\n\n+/g, "\n\n")
			// Remove blank lines between headings and code fences (3 or 4 backticks)
			.replace(/^(#{1,6}\s+.+?)\n+(?=````)/gm, "$1\n")
			// Remove blank lines after ## headings before content
			.replace(/^(#{2}\s+.+?)\n\n+/gm, "$1\n\n")
	);
}

/**
 * Shared context for generateSinglePage — fields that are the same
 * for every item in a single API build.
 */
export interface GenerateSinglePageContext {
	readonly buildId: string;
	readonly existingSnapshots: Map<string, FileSnapshot>;
	readonly baseRoute: string;
	readonly packageName: string;
	readonly apiScope: string;
	readonly apiName?: string;
	readonly source?: SourceConfig;
	readonly buildTime: string;
	readonly resolvedOutputDir: string;
	readonly suppressExampleErrors?: boolean;
	readonly llmsPlugin?: LlmsPlugin;
	/** The prose cross-linker built from this API's route map. */
	readonly linker: CrossLinker;
	/**
	 * SEO inputs, which live HERE rather than in the write stage because the
	 * head tags they produce must participate in the frontmatter hash.
	 *
	 * @remarks
	 * Building them in the write stage made every head tag invisible to change
	 * detection: the hash was taken over the page generator's frontmatter,
	 * which carries no `head` at all, so an `og:image`, a canonical URL or a
	 * JSON-LD version bump could change the written file while the snapshot
	 * still reported it unchanged — and the page was then never rewritten.
	 * `hashFrontmatter` strips timestamps recursively (the meta-pair form and
	 * the JSON-LD date keys alike), which is what makes hashing the FINAL
	 * frontmatter possible despite the timestamps being decided by the hash
	 * comparison itself.
	 */
	readonly siteUrl?: string;
	readonly docsRoot?: string;
	readonly ogImage?: OpenGraphImageConfig;
	readonly structuredDataPkg?: PackageContext;
}

/**
 * Generate a single page from a work item. Returns null for unsupported kinds.
 */
export function generateSinglePage(
	workItem: WorkItem,
	ctx: GenerateSinglePageContext,
): Effect.Effect<GeneratedPageResult | null, never, FileSystem.FileSystem | OgService> {
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const {
			buildId,
			existingSnapshots,
			baseRoute,
			packageName,
			apiScope,
			apiName,
			source,
			buildTime,
			resolvedOutputDir,
			suppressExampleErrors,
			llmsPlugin,
		} = ctx;
		const { item, categoryConfig, namespaceMember } = workItem;
		const pageGenStart = performance.now();

		// The IR builder decides what the page contains; the MDX emitter spells
		// it. Prettier failures degrade here exactly as they did in the
		// generators: a PrettierError event, then the unformatted code.
		const built = yield* buildPage({
			item,
			categoryKey: workItem.categoryKey,
			singularName: categoryConfig.singularName,
			folderName: categoryConfig.folderName,
			baseRoute,
			packageName,
			apiName,
			namespaceMember,
			availableFrom: workItem.availableFrom,
			syntheticBase: workItem.syntheticBase,
			memberAnchors: workItem.memberAnchors,
			source,
			suppressExampleErrors,
			linker: ctx.linker,
			onExampleFormatError: (error) => {
				const cause = error.cause;
				return emit(
					PluginEvent.PrettierError({
						ctx: { buildId, packageName, apiScope },
						file: "unknown",
						reason: cause instanceof Error ? cause.message : String(cause),
						level: "warn",
					}),
				);
			},
		});

		if (Option.isNone(built)) {
			yield* emit(
				PluginEvent.ItemSkipped({
					ctx: { buildId, packageName, apiScope },
					item: item.displayName,
					kind: String(item.kind),
					reason: "unsupported kind",
					level: "trace",
				}),
			);
			return null;
		}

		const irPage = built.value;
		const body = yield* Effect.fromResult(
			emitMdxBody(irPage, { apiScope, llmsEnabled: llmsPlugin?.enabled === true }),
		).pipe(Effect.orDie);
		// The generator output shape — frontmatter block then body — is
		// reassembled here so everything downstream (the frontmatter parse, the
		// body normalization, the hashes) reads exactly what it always read.
		const page = {
			routePath: irPage.route,
			content: generateFrontmatter(irPage.entityName, irPage.description, irPage.singularName, apiName) + body,
		};

		// Track page generation (metric derived from PageGenerated event in MetricsSink)
		const codeblockCount = (page.content.match(/<(ApiSignature|ApiMember|ApiExample)\b/g) ?? []).length;
		yield* emit(
			PluginEvent.PageGenerated({
				ctx: { buildId, packageName, apiScope, route: page.routePath },
				item: item.displayName,
				category: categoryConfig.displayName,
				codeblockCount,
				durationMs: Math.round(performance.now() - pageGenStart),
				level: "debug",
			}),
		);

		// Parse the generated content to extract frontmatter and body
		const parsed = parseFrontmatter(page.content);
		// Normalize markdown spacing to remove excessive blank lines
		const bodyContent = normalizeMarkdownSpacing(parsed.content);
		const frontmatterData = parsed.data;

		// Compute relative path from outputDir
		const relativePath = page.routePath.replace(baseRoute, "").replace(/^\//, "");
		const relativePathWithExt = `${relativePath}.mdx`;

		// Hash the content and frontmatter
		const contentHash = hashContent(bodyContent);

		// SEO head tags are built HERE, not in the write stage, because they
		// must participate in the frontmatter hash — see the remark on
		// GenerateSinglePageContext for the change-detection hole this closes.
		//
		// Gated on packageName alone, NOT on a non-empty siteUrl. An unset
		// `siteOrigin` yields a root-relative prefix ("") rather than nothing, so
		// the tags are still emitted and still resolve — which is what makes them
		// inspectable under `rspress dev` on localhost, where no configured origin
		// could be right. See `deriveSiteUrl`.
		const description = frontmatterData.description as string;
		const seoEnabled = ctx.siteUrl != null && packageName !== "";
		let ogImageMetadata: OpenGraphImageMetadata | undefined;
		let structuredData: string | undefined;

		if (seoEnabled) {
			const siteUrl = ctx.siteUrl as string;
			const ogSvc = yield* OgService;
			// Degrade, never fail: a misconfigured OG image must not stop a docs
			// build. The typed failure is surfaced as a ConfigValidationWarning —
			// which reaches `issues.json` — and the page renders without an
			// og:image. See the posture recorded on OgServiceShape.resolveImage.
			const ogImageResult = yield* Effect.result(
				ogSvc.resolveImage({
					config: ctx.ogImage,
					siteUrl,
					docsRoot: ctx.docsRoot,
					packageName,
					...(apiName != null ? { apiName } : {}),
				}),
			);
			if (ogImageResult._tag === "Failure") {
				const failure = ogImageResult.failure;
				yield* emit(
					PluginEvent.ConfigValidationWarning({
						ctx: { buildId, packageName },
						field: failure.field,
						value: failure.value,
						reason: failure.message,
						level: "warn",
					}),
				);
			} else if (Option.isSome(ogImageResult.success)) {
				ogImageMetadata = ogImageResult.success.value;
			}

			// Degrade the same way. Every failure here is an identity problem
			// raised by `JsonLdDocument.buildResult` (a malformed, duplicated or
			// colliding `@id`) — a defect in how ids are minted, not a reason to
			// stop a docs build.
			if (ctx.structuredDataPkg != null) {
				const graphResult = deriveScriptBody(ctx.structuredDataPkg, {
					pageRoute: page.routePath,
					symbolName: item.displayName,
					description,
					section: categoryConfig.displayName,
					publishedTime: buildTime,
					modifiedTime: buildTime,
				});
				if (graphResult._tag === "Failure") {
					yield* emit(
						PluginEvent.ConfigValidationWarning({
							ctx: { buildId, packageName, route: page.routePath },
							field: "structuredData",
							value: ctx.structuredDataPkg.id,
							reason: `schema.org document assembly failed: ${graphResult.failure._tag}`,
							level: "warn",
						}),
					);
				} else {
					structuredData = graphResult.success;
				}
			}
		}

		/**
		 * The final frontmatter for a given pair of timestamps.
		 *
		 * @remarks
		 * Called twice: once with the build time to compute the hash, and once
		 * with the resolved timestamps to write. That is sound only because
		 * `hashFrontmatter` strips every timestamp it can reach — the meta-pair
		 * form and the JSON-LD `datePublished`/`dateModified` keys alike — so the
		 * two calls hash identically. Without that stripping the hash would
		 * depend on the timestamps the hash itself decides.
		 */
		const finalFrontmatter = (published: string, modified: string): string =>
			seoEnabled
				? generateFrontmatter(
						item.displayName,
						description,
						categoryConfig.singularName,
						apiName,
						headTags({
							siteUrl: ctx.siteUrl as string,
							pageRoute: page.routePath,
							description,
							publishedTime: published,
							modifiedTime: modified,
							section: categoryConfig.displayName,
							packageName,
							...(ogImageMetadata != null ? { ogImage: ogImageMetadata } : {}),
							...(structuredData != null ? { structuredData } : {}),
						}),
					)
				: stringifyFrontmatter("", frontmatterData);

		const frontmatterHash = hashFrontmatter(parseFrontmatter(finalFrontmatter(buildTime, buildTime)).data);

		// Determine timestamps based on previous snapshot
		let publishedTime: string;
		let modifiedTime: string;
		let isUnchanged = false;

		const oldSnapshot = existingSnapshots.get(relativePathWithExt);

		if (!oldSnapshot) {
			// No snapshot exists - check if file exists on disk as fallback
			const absolutePath = path.join(resolvedOutputDir, relativePathWithExt);
			const fileExists = yield* fileSystem.exists(absolutePath).pipe(Effect.orElseSucceed(() => false));

			if (fileExists) {
				// File exists on disk - compare against it to preserve timestamps
				const existingContent = yield* fileSystem
					.readFileString(absolutePath)
					.pipe(Effect.orElseSucceed(() => null as string | null));

				if (existingContent !== null) {
					const { data: existingFrontmatter, content: existingBody } = parseFrontmatter(existingContent);
					// Apply same normalization as generated content for accurate comparison
					const normalizedExistingBody = normalizeMarkdownSpacing(existingBody);
					const existingContentHash = hashContent(normalizedExistingBody);
					const existingFrontmatterHash = hashFrontmatter(existingFrontmatter);

					if (existingContentHash === contentHash && existingFrontmatterHash === frontmatterHash) {
						// File exists and matches - preserve timestamps, skip write
						publishedTime = (existingFrontmatter["article:published_time"] as string | undefined) || buildTime;
						modifiedTime = (existingFrontmatter["article:modified_time"] as string | undefined) || buildTime;
						isUnchanged = true;
					} else {
						// File exists but content changed - preserve published, update modified
						publishedTime = (existingFrontmatter["article:published_time"] as string | undefined) || buildTime;
						modifiedTime = buildTime;
					}
				} else {
					// Read failed - treat as new file
					publishedTime = buildTime;
					modifiedTime = buildTime;
				}
			} else {
				// File doesn't exist - truly new
				publishedTime = buildTime;
				modifiedTime = buildTime;
			}
		} else if (oldSnapshot.contentHash === contentHash && oldSnapshot.frontmatterHash === frontmatterHash) {
			// NO CHANGES: Preserve both existing timestamps, skip file write
			publishedTime = oldSnapshot.publishedTime;
			modifiedTime = oldSnapshot.modifiedTime;
			isUnchanged = true;
		} else {
			// CHANGED: Preserve published time, update modified time
			publishedTime = oldSnapshot.publishedTime;
			modifiedTime = buildTime;
		}

		return {
			workItem,
			content: seoEnabled ? finalFrontmatter(publishedTime, modifiedTime) + bodyContent : page.content,
			bodyContent,
			frontmatter: frontmatterData,
			contentHash,
			frontmatterHash,
			routePath: page.routePath,
			relativePathWithExt,
			publishedTime,
			modifiedTime,
			isUnchanged,
		};
	});
}

/**
 * Shared context for writeSingleFile — fields that are the same
 * for every item in a single API build.
 */
export interface WriteSingleFileContext {
	readonly buildId: string;
	readonly resolvedOutputDir: string;
	readonly buildTime: string;
	readonly siteUrl?: string;
	/** Docs root, for locating a local OG image under `public/`. */
	readonly docsRoot?: string;
	readonly ogImage?: OpenGraphImageConfig;
	readonly packageName?: string;
	readonly apiName?: string;
	/**
	 * Structured-data context for this API, built ONCE in `build-program.ts`.
	 *
	 * @remarks
	 * Absent when the API has no decoded manifest to derive attribution from —
	 * `PackageManifest` is shape-strict, so one malformed field degrades the
	 * whole manifest to absent, and the page then renders without JSON-LD.
	 */
	readonly structuredDataPkg?: PackageContext;
}

/**
 * Write a single generated page to disk. No-op for unchanged pages.
 */
export function writeSingleFile(
	result: GeneratedPageResult,
	ctx: WriteSingleFileContext,
): Effect.Effect<FileWriteResult, never, FileSystem.FileSystem | OgService> {
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const { buildId, resolvedOutputDir, buildTime, packageName } = ctx;
		const {
			workItem,
			contentHash,
			frontmatterHash,
			publishedTime,
			modifiedTime,
			isUnchanged,
			routePath,
			relativePathWithExt,
		} = result;
		const { item, categoryKey, namespaceMember } = workItem;

		const absolutePath = path.join(resolvedOutputDir, relativePathWithExt);

		// Use qualified name for namespace members, otherwise the display name
		const baseLabel = namespaceMember ? namespaceMember.qualifiedName : item.displayName;
		const label = baseLabel;

		const snapshot: FileSnapshot = {
			outputDir: resolvedOutputDir,
			filePath: relativePathWithExt,
			publishedTime,
			modifiedTime,
			contentHash,
			frontmatterHash,
			buildTime,
		};

		// Handle unchanged files - skip write (metrics derived from FileDecision event in MetricsSink)
		if (isUnchanged) {
			yield* emit(
				PluginEvent.FileDecision({
					ctx: { buildId, ...(packageName != null ? { packageName } : {}) },
					file: relativePathWithExt,
					status: "unchanged",
					contentHash,
					frontmatterHash,
					source: "snapshot",
					level: "debug",
				}),
			);

			return {
				relativePathWithExt,
				absolutePath,
				status: "unchanged" as const,
				snapshot,
				categoryKey,
				label,
				routePath,
			};
		}

		// The generate stage assembled the final text, head tags included —
		// that is what makes the frontmatter hash cover them.
		const finalContent = result.content;

		// Check if file exists before writing to determine status
		const fileExisted = yield* fileSystem.exists(absolutePath).pipe(Effect.orElseSucceed(() => false));

		// Ensure directory exists and write the file
		const dirPath = path.dirname(absolutePath);
		yield* fileSystem.makeDirectory(dirPath, { recursive: true }).pipe(Effect.orDie);
		yield* fileSystem.writeFileString(absolutePath, finalContent).pipe(Effect.orDie);

		const status: "new" | "modified" = fileExisted ? "modified" : "new";

		// Metrics derived from FileDecision event in MetricsSink
		yield* emit(
			PluginEvent.FileDecision({
				ctx: { buildId, ...(packageName != null ? { packageName } : {}) },
				file: relativePathWithExt,
				status,
				contentHash,
				frontmatterHash,
				source: "snapshot",
				level: "debug",
			}),
		);

		return {
			relativePathWithExt,
			absolutePath,
			status,
			snapshot,
			categoryKey,
			label,
			routePath,
		};
	});
}

export interface WriteMetadataInput {
	readonly buildId: string;
	readonly fileResults: readonly FileWriteResult[];
	readonly categories: Record<string, CategoryConfig>;
	readonly resolvedOutputDir: string;
	readonly existingSnapshots: Map<string, FileSnapshot>;
	readonly buildTime: string;
	readonly baseRoute: string;
	readonly packageName: string;
	readonly apiName?: string;
	readonly generatedFiles: Set<string>;
}

/**
 * Write all metadata files (_meta.json and index.mdx) for the generated API docs.
 *
 * This function handles three groups of metadata:
 * 1. Root API _meta.json — category folder entries with collapsible/collapsed settings
 * 2. Main index page (index.mdx) — API landing page, skipped if already exists
 * 3. Category _meta.json files — sorted navigation entries per category folder
 *
 * All writes use snapshot tracking (hash comparison, disk fallback, timestamp
 * preservation) to avoid unnecessary disk writes.
 *
 * The `generatedFiles` Set is mutated — entries are added for each metadata file
 * written. This is required for stale file cleanup by the caller.
 */
export function writeMetadata(
	input: WriteMetadataInput,
): Effect.Effect<void, never, FileSystem.FileSystem | SnapshotService> {
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const snapshotSvc = yield* SnapshotService;
		const {
			buildId,
			fileResults,
			categories,
			resolvedOutputDir,
			existingSnapshots,
			buildTime,
			baseRoute,
			packageName,
			generatedFiles,
		} = input;

		// ── 1. Root _meta.json ────────────────────────────────────────────────────

		// The navigation tree is IR output: `buildNav` orders groups by category
		// insertion order (dropping any that received no page) and pages by
		// label, exactly as this stage used to sort them itself.
		const navCategories: Record<string, NavCategory> = {};
		for (const [categoryKey, categoryConfig] of Object.entries(categories)) {
			navCategories[categoryKey] = {
				displayName: categoryConfig.displayName,
				folderName: categoryConfig.folderName,
				...(categoryConfig.collapsible !== undefined ? { collapsible: categoryConfig.collapsible } : {}),
				...(categoryConfig.collapsed !== undefined ? { collapsed: categoryConfig.collapsed } : {}),
				...(categoryConfig.overviewHeaders !== undefined ? { overviewHeaders: categoryConfig.overviewHeaders } : {}),
			};
		}
		const navTree = buildNav({
			baseRoute,
			categories: navCategories,
			entries: fileResults.map((result) =>
				NavEntry.make({
					categoryKey: result.categoryKey,
					label: result.label,
					// e.g. "class/foo.mdx" → "foo"
					name: path.basename(result.relativePathWithExt, ".mdx"),
					route: result.routePath,
				}),
			),
		});

		const apiMetaJsonPath = path.join(resolvedOutputDir, "_meta.json");
		const apiMetaJsonRelPath = "_meta.json";
		const apiMetaJsonContent = renderRootMeta(navTree);
		const apiMetaContentHash = hashContent(apiMetaJsonContent);
		const apiMetaOldSnapshot = existingSnapshots.get(apiMetaJsonRelPath);

		let apiMetaUnchanged = false;
		let apiMetaPublished: string;
		let apiMetaModified: string;

		const apiMetaFileExists = yield* fileSystem.exists(apiMetaJsonPath).pipe(Effect.orElseSucceed(() => false));

		if (!apiMetaFileExists) {
			apiMetaPublished = apiMetaOldSnapshot?.publishedTime || buildTime;
			apiMetaModified = buildTime;
			apiMetaUnchanged = false;
		} else if (!apiMetaOldSnapshot) {
			const existingContent = yield* fileSystem
				.readFileString(apiMetaJsonPath)
				.pipe(Effect.orElseSucceed(() => null as string | null));
			const existingData = existingContent
				? yield* Effect.try(() => JSON.parse(existingContent) as unknown).pipe(Effect.orElseSucceed(() => null))
				: null;
			const normalizedExisting = existingData ? JSON.stringify(existingData, null, "\t") : null;

			if (normalizedExisting === apiMetaJsonContent) {
				apiMetaPublished = "2024-01-01T00:00:00.000Z";
				apiMetaModified = "2024-01-01T00:00:00.000Z";
				apiMetaUnchanged = true;
			} else {
				apiMetaPublished = "2024-01-01T00:00:00.000Z";
				apiMetaModified = buildTime;
			}
		} else if (apiMetaOldSnapshot.contentHash === apiMetaContentHash) {
			apiMetaPublished = apiMetaOldSnapshot.publishedTime;
			apiMetaModified = apiMetaOldSnapshot.modifiedTime;
			apiMetaUnchanged = true;
		} else {
			apiMetaPublished = apiMetaOldSnapshot.publishedTime;
			apiMetaModified = buildTime;
		}

		if (!apiMetaUnchanged) {
			yield* fileSystem.writeFileString(apiMetaJsonPath, apiMetaJsonContent).pipe(Effect.orDie);
			// Metrics derived from FileDecision event in MetricsSink
			yield* emit(
				PluginEvent.FileDecision({
					ctx: { buildId, packageName },
					file: apiMetaJsonRelPath,
					status: apiMetaOldSnapshot ? "modified" : "new",
					contentHash: apiMetaContentHash,
					frontmatterHash: "",
					source: "snapshot",
					level: "debug",
				}),
			);
		} else {
			// Metrics derived from FileDecision event in MetricsSink
			yield* emit(
				PluginEvent.FileDecision({
					ctx: { buildId, packageName },
					file: apiMetaJsonRelPath,
					status: "unchanged",
					contentHash: apiMetaContentHash,
					frontmatterHash: "",
					source: "snapshot",
					level: "debug",
				}),
			);
		}

		yield* snapshotSvc
			.upsert({
				outputDir: resolvedOutputDir,
				filePath: apiMetaJsonRelPath,
				publishedTime: apiMetaPublished,
				modifiedTime: apiMetaModified,
				contentHash: apiMetaContentHash,
				frontmatterHash: "",
				buildTime,
			})
			.pipe(Effect.ignore);

		generatedFiles.add(apiMetaJsonRelPath);

		// ── 2. Main index page ────────────────────────────────────────────────────

		const mainIndex = buildIndexPage({ packageName, baseRoute });
		const mainIndexContent = emitIndexPage(mainIndex);

		// routePath is e.g. "/api/index" → relative path "index.mdx"
		const indexRelativePath = `${mainIndex.route.replace(baseRoute, "").replace(/^\//, "")}.mdx`;
		const indexAbsolutePath = path.join(resolvedOutputDir, indexRelativePath);

		const indexFileExists = yield* fileSystem.exists(indexAbsolutePath).pipe(Effect.orElseSucceed(() => false));

		if (!indexFileExists) {
			const indexDirPath = path.dirname(indexAbsolutePath);
			yield* fileSystem.makeDirectory(indexDirPath, { recursive: true }).pipe(Effect.orDie);
			yield* fileSystem.writeFileString(indexAbsolutePath, mainIndexContent).pipe(Effect.orDie);
			yield* Metric.update(BuildMetrics.filesTotal, 1);
			yield* Metric.update(BuildMetrics.filesNew, 1);
		} else {
			yield* Metric.update(BuildMetrics.filesTotal, 1);
			yield* Metric.update(BuildMetrics.filesUnchanged, 1);
		}

		generatedFiles.add("index.mdx");

		// ── 3. Category _meta.json files ──────────────────────────────────────────

		// Build and write each category _meta.json from the tree's groups
		const metaSnapshots = yield* Effect.forEach(
			navTree.groups,
			(group) =>
				Effect.gen(function* () {
					const categoryConfig = group.category;
					const categoryMetaPath = path.join(resolvedOutputDir, categoryConfig.folderName, "_meta.json");
					const relPath = path.join(categoryConfig.folderName, "_meta.json");
					const content = renderCategoryMeta(group);
					const contentHash = hashContent(content);
					const oldSnapshot = existingSnapshots.get(relPath);

					let isUnchanged = false;
					let publishedTime: string;
					let modifiedTime: string;

					const fileExists = yield* fileSystem.exists(categoryMetaPath).pipe(Effect.orElseSucceed(() => false));

					if (!fileExists) {
						publishedTime = oldSnapshot?.publishedTime || buildTime;
						modifiedTime = buildTime;
						isUnchanged = false;
					} else if (!oldSnapshot) {
						const existingContent = yield* fileSystem
							.readFileString(categoryMetaPath)
							.pipe(Effect.orElseSucceed(() => null as string | null));
						const existingData = existingContent
							? yield* Effect.try(() => JSON.parse(existingContent) as unknown).pipe(Effect.orElseSucceed(() => null))
							: null;
						const normalizedExisting = existingData ? JSON.stringify(existingData, null, "\t") : null;

						if (normalizedExisting === content) {
							publishedTime = "2024-01-01T00:00:00.000Z";
							modifiedTime = "2024-01-01T00:00:00.000Z";
							isUnchanged = true;
						} else {
							publishedTime = "2024-01-01T00:00:00.000Z";
							modifiedTime = buildTime;
						}
					} else if (oldSnapshot.contentHash === contentHash) {
						publishedTime = oldSnapshot.publishedTime;
						modifiedTime = oldSnapshot.modifiedTime;
						isUnchanged = true;
					} else {
						publishedTime = oldSnapshot.publishedTime;
						modifiedTime = buildTime;
					}

					if (!isUnchanged) {
						const categoryDir = path.dirname(categoryMetaPath);
						yield* fileSystem.makeDirectory(categoryDir, { recursive: true }).pipe(Effect.orDie);
						yield* fileSystem.writeFileString(categoryMetaPath, content).pipe(Effect.orDie);
						// Metrics derived from FileDecision event in MetricsSink
						yield* emit(
							PluginEvent.FileDecision({
								ctx: { buildId, packageName },
								file: relPath,
								status: oldSnapshot ? "modified" : "new",
								contentHash,
								frontmatterHash: "",
								source: "snapshot",
								level: "debug",
							}),
						);
					} else {
						// Metrics derived from FileDecision event in MetricsSink
						yield* emit(
							PluginEvent.FileDecision({
								ctx: { buildId, packageName },
								file: relPath,
								status: "unchanged",
								contentHash,
								frontmatterHash: "",
								source: "snapshot",
								level: "debug",
							}),
						);
					}

					generatedFiles.add(relPath);

					if (isUnchanged) {
						return null;
					}

					return {
						outputDir: resolvedOutputDir,
						filePath: relPath,
						publishedTime,
						modifiedTime,
						contentHash,
						frontmatterHash: "",
						buildTime,
					};
				}),
			{ concurrency: "unbounded" },
		);

		// Batch-update all category _meta.json snapshots (filter out nulls for unchanged files)
		const metaSnapshotsToUpdate = metaSnapshots.filter((s): s is FileSnapshot => s !== null);
		if (metaSnapshotsToUpdate.length > 0) {
			yield* snapshotSvc.batchUpsert(metaSnapshotsToUpdate).pipe(Effect.ignore);
		}
	});
}

export interface CleanupAndCommitInput {
	readonly buildId: string;
	readonly fileResults: readonly FileWriteResult[];
	readonly resolvedOutputDir: string;
	readonly generatedFiles: ReadonlySet<string>;
}

/**
 * Batch-upsert snapshots for written files, then delete stale and orphaned files
 * from disk and the snapshot database. Finally, remove any empty subdirectories.
 *
 * Steps:
 * 1. Filter fileResults to written files (status !== "unchanged"), extract snapshots,
 *    and batch-upsert them into the snapshot DB.
 * 2. Call snapshotManager.cleanupStaleFiles() to find files tracked in DB but not
 *    generated in this build, then delete them from disk.
 * 3. Read the output directory recursively; for each .mdx or _meta.json file not in
 *    generatedFiles, delete it from disk and remove its snapshot.
 * 4. After deleting orphans, remove empty subdirectories deepest-first.
 */
export function cleanupAndCommit(
	input: CleanupAndCommitInput,
): Effect.Effect<void, never, FileSystem.FileSystem | SnapshotService> {
	return Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const snapshotSvc = yield* SnapshotService;
		const { buildId, fileResults, resolvedOutputDir, generatedFiles } = input;

		// 1. Batch-upsert snapshots for written (non-unchanged) files only
		const snapshotsToUpdate = fileResults.filter((r) => r.status !== "unchanged").map((r) => r.snapshot);

		if (snapshotsToUpdate.length > 0) {
			yield* snapshotSvc.batchUpsert(snapshotsToUpdate).pipe(Effect.ignore);
		}

		// 2. Stale file cleanup: files in DB but not generated in this build
		const staleFiles = yield* snapshotSvc
			.cleanupStale(resolvedOutputDir, generatedFiles)
			.pipe(Effect.orElseSucceed(() => [] as ReadonlyArray<string>));
		yield* Effect.forEach(
			staleFiles,
			(staleFile) =>
				Effect.gen(function* () {
					const fullPath = path.join(resolvedOutputDir, staleFile);
					yield* fileSystem.remove(fullPath).pipe(Effect.ignore);
					yield* emit(PluginEvent.StaleDeleted({ ctx: { buildId }, file: staleFile, level: "trace" }));
				}),
			{ concurrency: "unbounded" },
		);

		// 3. Orphan file cleanup: files on disk not tracked in generatedFiles
		const allFiles = yield* fileSystem
			.readDirectory(resolvedOutputDir, { recursive: true })
			.pipe(Effect.orElseSucceed(() => [] as string[]));
		const orphanedFiles: string[] = [];
		for (const entry of allFiles) {
			const relPath = typeof entry === "string" ? entry : String(entry);
			// Only consider .mdx and _meta.json files
			if (!relPath.endsWith(".mdx") && !relPath.endsWith("_meta.json")) continue;
			// Normalize path separators to forward slashes for comparison
			const normalizedRelPath = relPath.replace(/\\/g, "/");
			if (!generatedFiles.has(normalizedRelPath)) {
				orphanedFiles.push(normalizedRelPath);
			}
		}

		// Delete orphaned files from disk and snapshot DB
		yield* Effect.forEach(
			orphanedFiles,
			(orphan) =>
				Effect.gen(function* () {
					const fullPath = path.join(resolvedOutputDir, orphan);
					yield* fileSystem.remove(fullPath).pipe(Effect.ignore);
					yield* snapshotSvc.deleteSnapshot(resolvedOutputDir, orphan).pipe(Effect.ignore);
					yield* emit(PluginEvent.OrphanDeleted({ ctx: { buildId }, file: orphan, level: "trace" }));
				}),
			{ concurrency: "unbounded" },
		);

		// 4. Remove empty subdirectories after file deletion (deepest-first).
		// Stale files are deleted before the orphan scan reads the tree, so
		// their directories never appear as orphan parents — both deletion
		// lists feed the sweep. Each ancestor chain is included because
		// removing a child directory can empty its parent; the output root
		// itself (".") is never swept.
		const removedFiles = [...staleFiles, ...orphanedFiles];
		if (removedFiles.length > 0) {
			const dirs = new Set<string>();
			for (const removed of removedFiles) {
				let dir = path.dirname(removed.replace(/\\/g, "/"));
				while (dir !== "." && dir !== "/" && !dirs.has(dir)) {
					dirs.add(dir);
					dir = path.dirname(dir);
				}
			}
			// Sort deepest-first so child dirs are removed before parents
			const sortedDirs = [...dirs].sort((a, b) => b.split("/").length - a.split("/").length);
			for (const dir of sortedDirs) {
				const fullDir = path.join(resolvedOutputDir, dir);
				const entries = yield* fileSystem
					.readDirectory(fullDir)
					.pipe(Effect.orElseSucceed(() => ["placeholder"] as string[]));
				if (entries.length === 0) {
					// remove() without recursive fails on directories even when empty;
					// emptiness was just verified so recursive cannot over-delete
					yield* fileSystem.remove(fullDir, { recursive: true }).pipe(Effect.ignore);
					yield* emit(PluginEvent.EmptyDirRemoved({ ctx: { buildId }, dir, level: "trace" }));
				}
			}
		}
	});
}

export interface BuildPipelineInput {
	readonly buildId: string;
	readonly workItems: readonly WorkItem[];
	readonly baseRoute: string;
	readonly packageName: string;
	readonly apiScope: string;
	readonly apiName?: string;
	readonly source?: SourceConfig;
	readonly buildTime: string;
	readonly resolvedOutputDir: string;
	readonly pageConcurrency: number;
	readonly existingSnapshots: Map<string, FileSnapshot>;
	readonly suppressExampleErrors?: boolean;
	readonly llmsPlugin?: LlmsPlugin;
	/** The prose cross-linker built from this API's route map. */
	readonly linker: CrossLinker;
	readonly siteUrl?: string;
	readonly docsRoot?: string;
	readonly ogImage?: OpenGraphImageConfig;
	/** Per-API structured-data context, derived once by the caller. */
	readonly structuredDataPkg?: PackageContext;
}

/**
 * Effect Stream pipeline: workItems → generate → write (no-op for unchanged) → fold
 *
 * Unchanged files are NOT filtered out. They flow through the write stage as
 * no-ops and appear in the fold output with status: "unchanged". This is
 * required because ALL generated files must be tracked for:
 * - generatedFiles set (stale/orphan cleanup)
 * - fileContextMap (remark plugin Twoslash error attribution)
 * - _meta.json navigation entries
 *
 * The Stream.filter only removes nulls (unsupported ApiItemKind). All other
 * items — including unchanged ones — flow through to the fold accumulator.
 */
export function buildPipelineForApi(
	input: BuildPipelineInput,
): Effect.Effect<FileWriteResult[], never, FileSystem.FileSystem | OgService> {
	const generateCtx: GenerateSinglePageContext = {
		buildId: input.buildId,
		existingSnapshots: input.existingSnapshots,
		baseRoute: input.baseRoute,
		packageName: input.packageName,
		apiScope: input.apiScope,
		...(input.apiName != null ? { apiName: input.apiName } : {}),
		...(input.source != null ? { source: input.source } : {}),
		buildTime: input.buildTime,
		resolvedOutputDir: input.resolvedOutputDir,
		...(input.suppressExampleErrors != null ? { suppressExampleErrors: input.suppressExampleErrors } : {}),
		...(input.llmsPlugin != null ? { llmsPlugin: input.llmsPlugin } : {}),
		linker: input.linker,
		...(input.docsRoot !== undefined ? { docsRoot: input.docsRoot } : {}),
		...(input.siteUrl != null ? { siteUrl: input.siteUrl } : {}),
		...(input.ogImage != null ? { ogImage: input.ogImage } : {}),
		...(input.structuredDataPkg != null ? { structuredDataPkg: input.structuredDataPkg } : {}),
	};

	const writeCtx: WriteSingleFileContext = {
		buildId: input.buildId,
		resolvedOutputDir: input.resolvedOutputDir,
		buildTime: input.buildTime,
		...(input.docsRoot !== undefined ? { docsRoot: input.docsRoot } : {}),
		...(input.siteUrl != null ? { siteUrl: input.siteUrl } : {}),
		...(input.ogImage != null ? { ogImage: input.ogImage } : {}),
		...(input.packageName != null ? { packageName: input.packageName } : {}),
		...(input.apiName != null ? { apiName: input.apiName } : {}),
		...(input.structuredDataPkg != null ? { structuredDataPkg: input.structuredDataPkg } : {}),
	};

	return Stream.fromIterable(input.workItems).pipe(
		// Stage 1: Generate page content + hashes + timestamps
		Stream.mapEffect((workItem) => generateSinglePage(workItem, generateCtx), {
			concurrency: input.pageConcurrency,
		}),
		// Filter nulls (unsupported item kinds only)
		Stream.filter((result): result is GeneratedPageResult => result !== null),
		// Stage 2: Write file to disk (no-op for unchanged)
		Stream.mapEffect((result) => writeSingleFile(result, writeCtx), {
			concurrency: input.pageConcurrency,
		}),
		// Fold: accumulate ALL results (unchanged + written)
		Stream.runFold(
			() => [] as FileWriteResult[],
			(acc, result) => [...acc, result],
		),
	);
}
