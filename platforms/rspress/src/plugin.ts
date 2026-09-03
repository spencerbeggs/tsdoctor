/* v8 ignore start -- RSPress plugin adapter, requires RSPress runtime */
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { RspressPlugin, UserConfig } from "@rspress/core";
import { normalizeBaseRoute, unscopedName } from "@tsdoctor/pages";
import { Effect, FileSystem, ManagedRuntime, Option, Ref, Schema } from "effect";
import type { GenerateApiDocsResult } from "./build-program.js";
import { generateApiDocs } from "./build-program.js";
import { fromDir, fromParentDir } from "./config-helpers.js";
import { classifyApiConfig, mergeLlmsPluginConfig } from "./config-utils.js";
import { makeAppLayers } from "./layers/AppLayer.js";
import { buildEventBus, logBuildSummary } from "./layers/observability.js";
import { normalizeThemeConfig } from "./markdown/shiki-utils.js";
import { emit } from "./observability/EventBus.js";
import { PluginEvent } from "./observability/events.js";
import type { ProgressPhase } from "./observability/heartbeat.js";
import { runHeartbeat } from "./observability/heartbeat.js";
import { codeBlockReport } from "./observability/metric-report.js";
import { writeIssuesJson } from "./observability/sinks/issues-sink.js";
import { writeRenderPhaseJson } from "./observability/sinks/render-sink.js";
import { emitSync, installSyncEmitter } from "./observability/sync-emitter.js";
import { deriveOutputPaths } from "./path-derivation.js";
import { remarkApiCodeblocks } from "./remark-api-codeblocks.js";
import { remarkWithApi } from "./remark-with-api.js";
import { PluginOptions } from "./schemas/config.js";
import { resolveObservability } from "./schemas/observability.js";
import { ConfigService } from "./services/ConfigService.js";
import { TwoslashCacheService } from "./services/TwoslashCacheService.js";
import { TwoslashEnvironments } from "./services/TwoslashEnvironments.js";
import { clearTwoslashAccess, installTwoslashAccess, twoslashTransformerFor } from "./twoslash-access.js";
import { clearTypeRoutes } from "./twoslash-transformer.js";
import { VfsRegistry } from "./vfs-registry.js";

/**
 * Best-effort read of the consuming site's `package.json` `name`, used to tag
 * the `.api-docs/build/issues.json` artifact. Falls back to "unknown" when the file
 * is missing or unreadable — never fails.
 */
const readSitePackageName: Effect.Effect<string, never, FileSystem.FileSystem> = Effect.gen(function* () {
	const fileSystem = yield* FileSystem.FileSystem;
	const pkgJsonPath = path.resolve(process.cwd(), "package.json");
	const content = yield* fileSystem.readFileString(pkgJsonPath).pipe(Effect.orElseSucceed(() => ""));
	try {
		const parsed: unknown = JSON.parse(content);
		if (parsed && typeof parsed === "object" && "name" in parsed && typeof parsed.name === "string") {
			return parsed.name;
		}
	} catch {
		// malformed JSON — fall through to "unknown"
	}
	return "unknown";
});

/**
 * RSPress plugin for generating API documentation from API Extractor model files
 */
function ApiExtractorPluginImpl(rawOptions: PluginOptions): RspressPlugin {
	// Validate and decode options at factory time — catches structural issues via ParseError
	const options = Schema.decodeUnknownSync(PluginOptions)(rawOptions);
	// `api: null` / `apis: null` / `apis: []` opt into an inert plugin: options are
	// still validated, but nothing is generated and no artifacts are written, so a
	// site can pre-configure the plugin before any API model exists.
	const isInert = classifyApiConfig(options) === "disabled";
	// Resolve unified observability config (logLevel, trace, thresholds).
	const envLogLevel = process.env.LOG_LEVEL?.toLowerCase();
	const buildId = `${process.pid}-${performance.now().toString(36)}`;
	const { resolved: obs } = resolveObservability({
		...(options.observability ? { observability: options.observability } : {}),
		...(envLogLevel ? { envLogLevel } : {}),
		cwd: process.cwd(),
		buildId,
	});
	const {
		layer: eventBusLayer,
		trace: traceSink,
		issues: issuesSink,
		render: renderSink,
		metrics: metricStore,
	} = buildEventBus(obs);

	const dbPath = path.resolve(process.cwd(), ".api-docs", "snapshot", "api-docs.db");
	// SQLite opens the file eagerly at layer construction, so the snapshot
	// directory must exist first (cwd always does; `.api-docs/snapshot` may not).
	// Created even for an inert plugin: the runtime is not built on the inert
	// path, but a stray sync emitter (a deprecation warning, a `with-api` code
	// block) can still build it, and SQLite would then fail to open the file.
	fs.mkdirSync(path.dirname(dbPath), { recursive: true });
	// Bound to a const: this is a layer FACTORY, and layers memoize by
	// reference, so a second call would mint a second stack — a second
	// highlighter, a second snapshot database, a second metric registry.
	const appLayers = makeAppLayers({
		options,
		obs,
		buildId,
		dbPath,
		pageConcurrency: os.cpus().length,
		eventBus: eventBusLayer,
		metrics: metricStore,
	});

	const effectRuntime = ManagedRuntime.make(appLayers.app);

	// The sync-island emitters get their OWN runtime over the observability
	// layers alone, and it must stay synchronously buildable.
	//
	// `makeRuntimeEmitter` calls `runtime.runSync`, which first builds the
	// runtime's layer. Chunk 2 moved the sqlite caches from lazy per-call
	// acquisition to layer construction, which made `EffectAppLayer`
	// ASYNCHRONOUS to build — so the first sync emit from a remark plugin or a
	// Shiki callback died with `AsyncFiberError: An asynchronous Effect was
	// executed with Effect.runSync`.
	//
	// Splitting them is the right shape independently of that: an event emitter
	// has no business forcing a database open, and these three layers are all
	// `Layer.succeed`. `metricStore.layer` is shared BY REFERENCE with
	// `BaseLayer`, so the metrics sink and `logBuildSummary` still read and
	// write one registry.
	const emitterRuntime = ManagedRuntime.make(appLayers.emitter);
	installSyncEmitter(emitterRuntime);

	// File context map (shared across hooks)
	const fileContextMap = new Map<string, { api?: string; version?: string; file: string }>();

	// Capture RSPress root directory for OG image auto-detection
	let docsRoot: string | undefined;

	// Track first build to avoid repeating summary on HMR rebuilds
	let isFirstBuild = true;

	// LLMs post-processing state
	let rspressLlmsEnabled = false;
	let rspressOutDir = "dist";
	const buildResults: GenerateApiDocsResult[] = [];
	const resolvedLlmsPlugin = mergeLlmsPluginConfig(options.llmsPlugin);
	const packageRoutes = new Map<string, string>();

	return {
		name: "rspress-plugin-api-docs",

		// beforeBuild is intentionally empty — doc generation happens in config()
		// which runs BEFORE RSPress route scanning, ensuring generated files exist
		// on disk when routes are built (fixes cold-start issues in dev mode).
		async beforeBuild(_config: UserConfig, _isProd: boolean): Promise<void> {},

		// Use afterBuild hook to log statistics
		async afterBuild(_config: UserConfig, isProd: boolean): Promise<void> {
			// Only emit detailed summary on first build (skip on HMR rebuilds to reduce
			// noise). An inert plugin generated nothing, so there is no summary to log,
			// no issues to write and no LLMs output to post-process.
			if (isFirstBuild && !isInert) {
				// Read the render-phase rollup before logging: RSPress's MDX loader runs
				// on the Rspack main thread, in this module instance, so every
				// CodeBlockProcessed event from the render pass has already reached the
				// sink by the time afterBuild runs.
				const renderSamples = renderSink.snapshot();
				const report = await effectRuntime.runPromise(codeBlockReport);

				// Persist the Twoslash results this build produced. The service holds
				// the generation — the render pass that fills it runs between
				// config() and here — and writes only when it is dirty.
				await effectRuntime.runPromise(
					Effect.gen(function* () {
						const svc = yield* TwoslashCacheService;
						const saved = yield* svc.persist();
						if (Option.isNone(saved)) return;
						const stats = saved.value;
						yield* emit(
							PluginEvent.TwoslashCacheSaved({
								ctx: { buildId },
								level: "info",
								envHash: stats.envHash,
								hits: stats.hits,
								misses: stats.misses,
								entries: stats.entries,
								persisted: stats.dirty,
							}),
						);
					}),
				);

				// Log build summary via Effect metrics
				await effectRuntime.runPromise(logBuildSummary(obs.thresholds.slowCodeBlock, report));

				// Write .api-docs/build/*.json artifacts on prod builds only
				if (isProd) {
					await effectRuntime.runPromise(
						Effect.gen(function* () {
							const packageName = yield* readSitePackageName;
							const generatedAt = new Date().toISOString();
							yield* writeIssuesJson(issuesSink.snapshot(), {
								cwd: process.cwd(),
								packageName,
								generatedAt,
							});
							yield* writeRenderPhaseJson(report, renderSamples, {
								cwd: process.cwd(),
								packageName,
								generatedAt,
							});
						}),
					);
				}

				// Post-process LLMs files when RSPress llms plugin and our llmsPlugin are both enabled
				if (rspressLlmsEnabled && resolvedLlmsPlugin.enabled) {
					const { processLlmsFiles } = await import("./llms-program.js");
					await effectRuntime.runPromise(
						processLlmsFiles({
							outDir: path.resolve(process.cwd(), rspressOutDir),
							buildResults,
							llmsPlugin: resolvedLlmsPlugin,
							packageRoutes,
							buildId,
						}),
					);
				}

				// Mark first build as complete
				isFirstBuild = false;
			}

			if (traceSink) traceSink.flush();

			// Only dispose the runtime in production builds.
			// In dev mode, the runtime must stay alive for HMR rebuilds —
			// disposing it would destroy the SnapshotService layer (DB connection)
			// and subsequent builds would fail.
			if (isProd) {
				await effectRuntime.dispose();
				await emitterRuntime.dispose();
			}
		},

		// config() hook: runs BEFORE route scanning.
		// We generate API docs here so files exist when RSPress builds its route table.
		async config(_config: UserConfig, _utils: unknown, isProd: boolean): Promise<UserConfig> {
			const buildStartTime = performance.now();

			// Capture docs root for OG image auto-detection (resolve to absolute path)
			if (_config.root) {
				docsRoot = path.isAbsolute(_config.root) ? _config.root : path.resolve(process.cwd(), _config.root);
			}

			// Read RSPress config values for path derivation
			const rspressRoot = docsRoot || process.cwd();
			const rspressLocales = (_config as { locales?: Array<{ lang: string }> }).locales?.map((l) => l.lang) ?? [];
			const rspressLang = (_config as { lang?: string }).lang;
			const rspressMultiVersion = (_config as { multiVersion?: { default: string; versions: string[] } }).multiVersion;
			// The canonical site URL comes from RSPress, not from a plugin option:
			// it concatenates as `siteOrigin + base + routePath`, and the plugin's
			// former `siteUrl` could disagree with it silently.
			const rspressSiteOrigin = _config.siteOrigin;
			const rspressBase = _config.base;

			// Capture RSPress LLMs config for afterBuild processing
			rspressLlmsEnabled = Boolean((_config as { llms?: boolean | object }).llms);
			rspressOutDir = _config.outDir ?? "dist";

			// Pre-create output directories so RSPress's auto-nav-sidebar doesn't fail
			if (options.api) {
				const api = options.api;
				const baseRoute = normalizeBaseRoute(api.baseRoute ?? "/");
				const versions = rspressMultiVersion?.versions ?? [];
				const derivedPaths = deriveOutputPaths({
					mode: "single",
					docsRoot: rspressRoot,
					baseRoute,
					apiFolder: api.apiFolder ?? "api",
					locales: rspressLocales,
					defaultLang: rspressLang,
					versions,
					defaultVersion: rspressMultiVersion?.default,
				});
				for (const dp of derivedPaths) {
					fs.mkdirSync(dp.outputDir, { recursive: true });
				}
			} else if (options.apis) {
				for (const api of options.apis) {
					const baseRoute = normalizeBaseRoute(api.baseRoute ?? `/${unscopedName(api.packageName)}`);
					const derivedPaths = deriveOutputPaths({
						mode: "multi",
						docsRoot: rspressRoot,
						baseRoute,
						apiFolder: api.apiFolder ?? "api",
						locales: rspressLocales,
						defaultLang: rspressLang,
						versions: [],
						defaultVersion: undefined,
					});
					for (const dp of derivedPaths) {
						fs.mkdirSync(dp.outputDir, { recursive: true });
					}
				}
			}

			// === Generate API documentation ===
			// This runs in config() (before route scanning) so generated files
			// are on disk when RSPress builds its route table.
			VfsRegistry.clear();
			// The render pass reads this build's Twoslash environments through a
			// module-level holder. A dev HMR session reuses the process, so a
			// holder left installed from the previous build would hand out
			// transformers built against declarations that have since changed.
			clearTwoslashAccess();
			// Cross-link routes accumulate across APIs within a build and were never
			// cleared between builds, so a dev session kept routes for items that had
			// since been renamed or removed.
			clearTypeRoutes();
			fileContextMap.clear();
			// Reset the issues sink's buckets each build so a dev runtime kept alive
			// across HMR rebuilds does not accumulate diagnostics without bound.
			issuesSink.reset();

			// An inert plugin (`api: null` / `apis: null` / `apis: []`) skips the whole
			// program: no model loading, no Effect runtime, no snapshot database.
			if (!isInert) {
				try {
					const rspressConfigSubset = {
						...(rspressMultiVersion != null ? { multiVersion: rspressMultiVersion } : {}),
						...(rspressLocales.length > 0 ? { locales: rspressLocales.map((lang) => ({ lang })) } : {}),
						...(rspressLang != null ? { lang: rspressLang } : {}),
						...(docsRoot != null ? { root: docsRoot } : {}),
						...(rspressSiteOrigin != null ? { siteOrigin: rspressSiteOrigin } : {}),
						...(rspressBase != null ? { base: rspressBase } : {}),
					};

					await effectRuntime.runPromise(
						Effect.gen(function* () {
							const apiCount = options.api ? 1 : (options.apis?.length ?? 0);
							yield* emit(PluginEvent.BuildStarted({ ctx: { buildId }, level: "info", mode: "prod", apiCount }));

							const phaseRef = yield* Ref.make<ProgressPhase>("resolve");
							if (isProd && obs.progressIntervalMs !== null) {
								yield* Effect.forkScoped(
									runHeartbeat({
										phaseRef,
										intervalMs: obs.progressIntervalMs,
										startTime: buildStartTime,
										apisTotal: apiCount,
										buildId,
									}),
								);
							}

							// Bind the render pass to this build's Twoslash environments.
							// Wired here, beside the other seams, rather than inside
							// ConfigService.layer — config resolution should compute a value,
							// not also mutate module state as a side effect. See
							// twoslash-access.ts for why this is a holder and not a
							// runtime-bound accessor.
							installTwoslashAccess(yield* TwoslashEnvironments);

							const configSvc = yield* ConfigService;
							const apiConfigs = yield* configSvc.resolve(rspressConfigSubset);

							// Clear previous build results (for HMR rebuilds)
							buildResults.length = 0;

							yield* Ref.set(phaseRef, "generate");

							yield* Effect.forEach(
								apiConfigs,
								(apiConfig) =>
									generateApiDocs(apiConfig, fileContextMap).pipe(
										Effect.tap((result) => {
											buildResults.push(result);
											return emit(
												PluginEvent.ApiDocsCompleted({
													ctx: { buildId },
													level: "debug",
													packageName: result.packageName,
												}),
											);
										}),
									),
								{ concurrency: 2 },
							);

							yield* Ref.set(phaseRef, "done");

							const totalMs = performance.now() - buildStartTime;
							yield* emit(
								PluginEvent.BuildCompleted({ ctx: { buildId }, level: "info", durationMs: totalMs, totals: {} }),
							);
						}).pipe(Effect.scoped),
					);
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					emitSync(PluginEvent.BuildFailed({ ctx: { buildId }, level: "error", phase: "generate", error: message }));
					if (traceSink) traceSink.flush();

					// Best-effort: write .api-docs/build/issues.json on the fatal path too, since
					// afterBuild (where this normally happens) never runs when config()
					// throws. Collision/model-load errors emitted above (RouteCollisionDetected,
					// ModelLoadFailed) would otherwise never reach disk. Never mask the
					// original build failure with a write failure.
					if (isProd) {
						try {
							await effectRuntime.runPromise(
								Effect.gen(function* () {
									const packageName = yield* readSitePackageName;
									yield* writeIssuesJson(issuesSink.snapshot(), {
										cwd: process.cwd(),
										packageName,
										generatedAt: new Date().toISOString(),
									});
								}),
							);
						} catch {
							// ignore — never mask the build failure
						}
					}

					throw error;
				}
			}

			// === RSPress configuration modifications ===
			const updatedConfig = { ..._config };

			// Ensure runtime components are included for proper module resolution
			if (!updatedConfig.builderConfig) {
				updatedConfig.builderConfig = {};
			}
			if (!updatedConfig.builderConfig.source) {
				updatedConfig.builderConfig.source = {};
			}

			// Replace RSPress's LlmsViewOptions with our custom version via resolve.alias.
			// This lets us extend the default dropdown with package-level actions.
			// Skipped when inert — there are no package scopes to add.
			if (!isInert && rspressLlmsEnabled && resolvedLlmsPlugin.enabled && resolvedLlmsPlugin.scopes) {
				if (!updatedConfig.builderConfig.resolve) {
					updatedConfig.builderConfig.resolve = {};
				}
				const pluginDir = path.dirname(fileURLToPath(import.meta.url));
				// The runtime is emitted bundleless next to `index.js` (mirroring the
				// `src/runtime` tree), so each component has its own published `.js`
				// file. This zero-level resolve is layout-invariant across the dev
				// (`dist/dev`) and published (flat root) layouts. RSPress compiles the
				// referenced file, resolving `import.meta.env.SSG_MD` per build.
				const customLlmsViewOptions = path.resolve(pluginDir, "runtime/components/ApiLlmsViewOptions/index.js");
				// Use createRequire to resolve from the bundled plugin's location,
				// which has @rspress/core in its node_modules tree
				const pluginRequire = createRequire(import.meta.url);
				const rspressCoreDir = path.dirname(pluginRequire.resolve("@rspress/core/package.json"));
				const originalLlmsViewOptions = path.join(rspressCoreDir, "dist/theme/components/Llms/LlmsViewOptions.js");
				const existingAlias = (updatedConfig.builderConfig.resolve as Record<string, unknown>).alias;
				updatedConfig.builderConfig.resolve.alias = {
					...(typeof existingAlias === "object" && existingAlias !== null ? existingAlias : {}),
					[originalLlmsViewOptions]: customLlmsViewOptions,
				};
			}
			const existingInclude = updatedConfig.builderConfig.source.include || [];
			if (!existingInclude.includes("rspress-plugin-api-extractor/runtime")) {
				updatedConfig.builderConfig.source.include = [...existingInclude, "rspress-plugin-api-extractor/runtime"];
			}

			if (!updatedConfig.markdown) {
				updatedConfig.markdown = {};
			}

			// Add remark plugin for user-authored `with-api` code blocks
			if (!updatedConfig.markdown.remarkPlugins) {
				updatedConfig.markdown.remarkPlugins = [];
			}

			const firstApiTheme = options.api?.theme ?? options.apis?.[0]?.theme;
			const remarkTheme = normalizeThemeConfig(firstApiTheme);

			updatedConfig.markdown.remarkPlugins.push([
				remarkWithApi,
				{
					// Scope-aware: a `with-api` fence in a package's docs is checked
					// under that package's tsconfig, not whichever API happened to be
					// listed first. This is the correctness half of per-scope
					// environments (see type-loading-vfs.md).
					getTransformer: (apiScope?: string) => twoslashTransformerFor(apiScope),
					theme: remarkTheme,
				},
			]);

			updatedConfig.markdown.remarkPlugins.push([remarkApiCodeblocks]);

			// Inject API scope metadata into themeConfig for the runtime UI component
			// (e.g., per-scope llms.txt links). Only when both RSPress llms plugin and our
			// scopes are enabled, and never when inert (no packages, so no scopes).
			if (!isInert && rspressLlmsEnabled && resolvedLlmsPlugin.enabled && resolvedLlmsPlugin.scopes) {
				// Populate the packageRoutes map (hoisted to plugin level for afterBuild use).
				// Maps packageName -> package-level route (without apiFolder).
				// e.g., "kitchensink" -> "/kitchensink" (not "/kitchensink/api")
				packageRoutes.clear();
				if (options.api) {
					packageRoutes.set(options.api.packageName, normalizeBaseRoute(options.api.baseRoute ?? "/"));
				} else if (options.apis) {
					for (const api of options.apis) {
						packageRoutes.set(
							api.packageName,
							normalizeBaseRoute(api.baseRoute ?? `/${unscopedName(api.packageName)}`),
						);
					}
				}

				const scopes = buildResults.map((result) => ({
					name: result.apiName ?? result.packageName,
					packageName: result.packageName,
					// packageRoute is the broader scope for UI matching (e.g., "/kitchensink")
					packageRoute: packageRoutes.get(result.packageName) ?? result.baseRoute,
					// baseRoute is the API-specific route (e.g., "/kitchensink/api")
					baseRoute: result.baseRoute,
					version: null, // TODO: populate from DerivedPath when version support is wired
					locale: null, // TODO: populate from DerivedPath when locale support is wired
					llmsTxt: `${packageRoutes.get(result.packageName) ?? result.baseRoute}/llms.txt`,
					llmsFullTxt: `${packageRoutes.get(result.packageName) ?? result.baseRoute}/llms-full.txt`,
					llmsDocsTxt: `${packageRoutes.get(result.packageName) ?? result.baseRoute}/llms-docs.txt`,
					llmsApiTxt: resolvedLlmsPlugin.apiTxt
						? `${packageRoutes.get(result.packageName) ?? result.baseRoute}/llms-api.txt`
						: null,
				}));

				if (!updatedConfig.themeConfig) {
					updatedConfig.themeConfig = {};
				}
				(updatedConfig.themeConfig as Record<string, unknown>).apiExtractorScopes = scopes;

				// Register the scope-aware LLM actions component as a global UI component.
				// The runtime is emitted bundleless next to `index.js`, so this
				// zero-level resolve to the component's published `.js` is layout-
				// invariant across the dev and published package shapes. RSPress
				// compiles it, resolving `import.meta.env.SSG_MD` per build.
				if (!updatedConfig.globalUIComponents) {
					updatedConfig.globalUIComponents = [];
				}
				const llmsComponentPluginDir = path.dirname(fileURLToPath(import.meta.url));
				const llmsComponentPath = path.resolve(
					llmsComponentPluginDir,
					"runtime/components/ApiLlmsPackageActions/index.js",
				);
				updatedConfig.globalUIComponents.push(llmsComponentPath);
			}

			return updatedConfig;
		},
	};
}

/**
 * RSPress plugin for generating API documentation from API Extractor model
 * files. Config helpers are available under `ApiExtractorPlugin.api` (single
 * package → one config for the `api:` option) and `ApiExtractorPlugin.apis`
 * (parent directory → array for the `apis:` option).
 *
 * @public
 */
export const ApiExtractorPlugin = Object.assign(ApiExtractorPluginImpl, {
	api: { fromDir },
	apis: { fromDir: fromParentDir },
});
