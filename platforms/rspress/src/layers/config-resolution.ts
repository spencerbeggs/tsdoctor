import type { PathLike } from "node:fs";
import path from "node:path";
import type { ApiEntryPoint, ApiModel, ApiPackage } from "@microsoft/api-extractor-model";
import type { VirtualFileSystem } from "@tsdoctor/registry";
import { hashContent } from "@tsdoctor/snapshot";
import { Effect, Metric } from "effect";
import { ApiExtractedPackage } from "../api-extracted-package.js";
import { BuildId } from "../BuildEnv.js";
import { CategoryResolver } from "../category-resolver.js";
import {
	classifyApiConfig,
	extractAutoDetectedPackages,
	isVersionConfig,
	mergeLlmsPluginConfig,
	validateExternalPackages,
} from "../config-utils.js";
import { ConfigValidationError } from "../errors.js";
import type { LoadedModel, PackageJson, TypeResolutionCompilerOptions, TypeScriptConfig } from "../internal-types.js";
import { normalizeThemeConfig } from "../markdown/shiki-utils.js";
import type { ModelLoadError } from "../model-loader.js";
import { loadApiModel, loadPackageJson, loadVersionModel } from "../model-loader.js";
import { emit, wantsLevel } from "../observability/EventBus.js";
import type { ImportRef } from "../observability/events.js";
import { PluginEvent } from "../observability/events.js";
import { withPhase } from "../observability/spans.js";
import { deriveSiteUrl } from "../og-resolver.js";
import { apiScopeOf, deriveOutputPaths, normalizeBaseRoute, unscopedName } from "../path-derivation.js";
import type {
	ExternalPackageSpec,
	MultiApiConfig,
	PluginOptions,
	SingleApiConfig,
	VersionConfig,
} from "../schemas/config.js";
import { DEFAULT_CATEGORIES } from "../schemas/config.js";
import type { ConfigServiceShape, ResolvedApiConfig, RspressConfigSubset } from "../services/ConfigService.js";
import { PluginConfig } from "../services/PluginConfig.js";
import { TypeRegistryService } from "../services/TypeRegistryService.js";
import { TypeReferenceExtractor } from "../type-reference-extractor.js";
import type { ApiResultAccumulator, VfsEntryPayload } from "./api-results.js";
import { emitVfsPayloadEvents, mergeApiResult } from "./api-results.js";
import { BuildMetrics } from "./build-metrics.js";
import { mergeExternalTypes } from "./external-types.js";
import { registerTypeEnvironments, resolveTsConfigTyped } from "./type-environment.js";

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

interface RspressMultiVersion {
	default: string;
	versions: string[];
}

/**
 * Prepend import statements for external type references to the VFS declaration files.
 * Returns per-entry payloads for event emission (heavy content/importRefs gated on wantTrace).
 */
function prependImportsToVfs(
	vfs: VirtualFileSystem,
	apiPackage: ApiPackage,
	packageName: string,
	wantTrace: boolean,
): VfsEntryPayload[] {
	const extractor = new TypeReferenceExtractor(apiPackage, packageName);
	const payloads: VfsEntryPayload[] = [];
	for (const entryPoint of apiPackage.entryPoints) {
		const entryEp = entryPoint as ApiEntryPoint;
		const imports = extractor.extractImportsForEntryPoint(entryEp);
		const importStatements = TypeReferenceExtractor.formatImports(imports);
		const entryName = entryEp.displayName || "";
		const fileName = entryName ? `${entryName}.d.ts` : "index.d.ts";
		const file = `node_modules/${packageName}/${fileName}`;

		const hasImports = importStatements.length > 0;
		if (hasImports) {
			const existing = vfs.get(file);
			if (existing) {
				vfs.set(file, `${importStatements.join("\n")}\n\n${existing}`);
			}
		}

		const content = vfs.get(file) ?? "";
		const declCount = entryEp.members.length;
		const contentHash = hashContent(content);
		const importRefs: readonly ImportRef[] =
			wantTrace && hasImports
				? imports.map((i) => ({ from: i.packageName, symbols: [...i.symbols] as readonly string[] }))
				: [];
		payloads.push({
			file,
			entryPoint: entryName,
			declCount,
			contentHash,
			content: wantTrace ? content : "",
			hasImports,
			importRefs,
		});
	}
	return payloads;
}

/**
 * Validate plugin options and return an Effect that fails with ConfigValidationError.
 */
function validateOptions(
	options: PluginOptions,
	rspressConfig: { multiVersion?: RspressMultiVersion },
): Effect.Effect<void, ConfigValidationError> {
	return Effect.gen(function* () {
		const api = options.api ?? undefined;
		const apis = options.apis != null && options.apis.length > 0 ? options.apis : undefined;
		const { multiVersion } = rspressConfig;

		if (api && apis) {
			return yield* new ConfigValidationError({
				field: "api/apis",
				reason:
					"Cannot provide both 'api' and 'apis'. Use 'api' for single-package sites or 'apis' for multi-package portals.",
			});
		}
		if (!api && !apis) {
			// `api: null` / `apis: null` / `apis: []` explicitly opt into an inert
			// plugin — valid, and resolved to an empty build context. Omitting both
			// keys is still a misconfiguration.
			if (classifyApiConfig(options) === "missing") {
				return yield* new ConfigValidationError({
					field: "api/apis",
					reason: "Must provide either 'api' or 'apis'.",
				});
			}
			return;
		}

		if (apis) {
			if (multiVersion) {
				return yield* new ConfigValidationError({
					field: "apis",
					reason:
						"multiVersion is not supported with 'apis' (multi-API mode). Use 'api' (single-API mode) for versioned documentation.",
				});
			}
			return;
		}

		if (api) {
			if (multiVersion) {
				if (!api.versions) {
					return yield* new ConfigValidationError({
						field: "api.versions",
						reason: "'versions' is required when multiVersion is active.",
					});
				}

				const pluginKeys = new Set(Object.keys(api.versions));
				const rspressKeys = new Set(multiVersion.versions);

				if (pluginKeys.size !== rspressKeys.size || ![...pluginKeys].every((k) => rspressKeys.has(k))) {
					return yield* new ConfigValidationError({
						field: "api.versions",
						reason: `api.versions keys [${[...pluginKeys].join(", ")}] must exactly match multiVersion.versions [${[...rspressKeys].join(", ")}].`,
					});
				}
			} else {
				if (api.versions) {
					yield* emit(
						PluginEvent.ConfigCascadeWarning({
							ctx: {},
							level: "warn",
							field: "versions",
							chosen: "(none — multiVersion not configured)",
							ignored: ["api.versions"],
						}),
					);
				}
				if (!api.model) {
					return yield* new ConfigValidationError({
						field: "api.model",
						reason: "'model' is required when multiVersion is not active.",
					});
				}
			}
		}
	});
}

// ---------------------------------------------------------------------------
// Layer factory
// ---------------------------------------------------------------------------

/**
 * Resolve plugin options + RSPress config into the API configs the pipeline
 * runs over.
 *
 * @remarks
 * A module-level `const`, not a factory. It took the plugin options as an
 * argument and was called inline at the merge site, which made it a
 * layer-returning function: layers memoize by reference, so a second call
 * would build a second `ConfigService` with its own captured `TypeRegistry`.
 * The options come from {@link PluginConfig} now, so there is nothing to pass
 * and nothing to call twice.
 *
 * The `Layer` around this lives on the service, as `ConfigService.layer`. The
 * implementation stays here rather than in the service module because it is
 * the bulk of config resolution; the service module declares the contract.
 */
export const makeConfigService: Effect.Effect<ConfigServiceShape, never, TypeRegistryService | PluginConfig> =
	Effect.gen(function* () {
		// Capture services from the layer context
		const typeRegistry = yield* TypeRegistryService;
		const options = yield* PluginConfig;

		return {
			resolve: (rspressConfig: RspressConfigSubset) =>
				Effect.gen(function* () {
					const buildId = yield* BuildId;
					const loadStart = performance.now();

					// Gate heavy VFS payloads behind trace level
					const wantTrace = yield* wantsLevel("trace");

					// --- 1. Validate options ---
					yield* validateOptions(options, {
						...(rspressConfig.multiVersion
							? {
									multiVersion: {
										default: rspressConfig.multiVersion.default,
										versions: [...rspressConfig.multiVersion.versions],
									},
								}
							: {}),
					});

					// --- 2. Derive RSPress context ---
					const rspressMultiVersion = rspressConfig.multiVersion;
					const rspressLocales = rspressConfig.locales?.map((l) => l.lang) ?? [];
					const rspressLang = rspressConfig.lang;
					const docsRoot = rspressConfig.root;
					const rspressRoot = docsRoot || process.cwd();
					// Derived from RSPress's own config rather than a plugin option — see
					// `deriveSiteUrl`. `undefined` when the site declares no `siteOrigin`,
					// which turns the OG path off rather than emitting relative URLs.
					const siteUrl = deriveSiteUrl(rspressConfig.siteOrigin, rspressConfig.base);

					// --- 3. Category resolution ---
					const categoryResolver = new CategoryResolver();
					const pluginDefaults = categoryResolver.mergeCategories(DEFAULT_CATEGORIES, options.defaultCategories);

					// --- 4. Collect configs from models ---
					const apiConfigs: ResolvedApiConfig[] = [];
					const combinedVfs = new Map<string, string>();
					const allExternalPackages: ExternalPackageSpec[] = [];
					/** The three above, as one value the merge helper can take. */
					const acc: ApiResultAccumulator = { apiConfigs, combinedVfs, allExternalPackages };

					let firstApiTsconfig: SingleApiConfig["tsconfig"] | MultiApiConfig["tsconfig"];
					let firstApiCompilerOptions: SingleApiConfig["compilerOptions"] | MultiApiConfig["compilerOptions"];
					/**
					 * Raw TypeScript config per API scope. Each documented package is
					 * type-checked under its OWN configuration; the build no longer picks
					 * one and applies it to everything.
					 */
					const scopeTsConfigs = new Map<string, TypeScriptConfig | undefined>();

					/**
					 * Emit a typed ModelLoadFailed event for a failed model load, then
					 * convert the typed failure to a defect — a missing or unparsable
					 * model remains fatal to the build, exactly as before, but the
					 * event now rides the error channel instead of a sync-island seam.
					 */
					const withModelLoadEvents = <A>(self: Effect.Effect<A, ModelLoadError>): Effect.Effect<A> =>
						self.pipe(
							Effect.tapError((error) =>
								emit(
									PluginEvent.ModelLoadFailed({
										ctx: { buildId },
										level: "error",
										modelPath: "modelPath" in error ? error.modelPath : "<loader function>",
										reason: error.message,
									}),
								),
							),
							Effect.orDie,
						);

					/**
					 * Helper to process a single API model (shared by single and multi modes).
					 */
					const processSimpleApi = (
						api: SingleApiConfig | MultiApiConfig,
						model: NonNullable<SingleApiConfig["model"]> | MultiApiConfig["model"],
						outputDir: string,
						fullRoute: string,
						wantTrace: boolean,
					) =>
						Effect.gen(function* () {
							const { apiPackage, source: loaderSource } = yield* withModelLoadEvents(
								loadApiModel(model as PathLike | (() => Promise<ApiModel | LoadedModel>)),
							);
							{
								const resolvedCategories = categoryResolver.resolveCategoryConfig(pluginDefaults, api.categories);
								const resolvedSource = categoryResolver.resolveSourceConfig(api.source, loaderSource);
								const resolvedLlms = mergeLlmsPluginConfig(options.llmsPlugin, api.llmsPlugin);

								// Load package.json. A missing or malformed file is a user
								// misconfiguration, not bad wiring, so it fails TYPED — it used
								// to throw from inside an `Effect.promise` body and escape as an
								// untyped defect, which killed the build with no `issues.json`
								// entry (the issues sink only ever sees events).
								const packageJson = api.packageJson
									? yield* Effect.tryPromise({
											try: () => loadPackageJson(api.packageJson as PathLike | (() => Promise<PackageJson>)),
											catch: (cause) =>
												new ConfigValidationError({
													field: "packageJson",
													reason: cause instanceof Error ? cause.message : String(cause),
													cause,
												}),
										})
									: undefined;

								// Validate that explicit externalPackages don't conflict with
								// peerDependencies. Typed for the same reason as above.
								yield* Effect.try({
									try: () => validateExternalPackages(api.externalPackages, packageJson),
									catch: (cause) =>
										new ConfigValidationError({
											field: "externalPackages",
											reason: cause instanceof Error ? cause.message : String(cause),
											cause,
										}),
								});

								// Collect external packages
								const externalPackages =
									api.externalPackages || extractAutoDetectedPackages(packageJson, api.autoDetectDependencies);

								// Track external packages. `yield*` rather than `Effect.runSync`:
								// run from inside the fiber, this resolves the BUILD's metric
								// registry. A bare `runSync` here resolved the `MetricRegistry`
								// Reference DEFAULT instead, so the count landed in a
								// process-wide registry that `logBuildSummary` never reads.
								if (externalPackages && externalPackages.length > 0) {
									yield* Metric.update(BuildMetrics.externalPackagesTotal, externalPackages.length);
								}

								// Generate virtual file system from API model for Twoslash
								const pkg = ApiExtractedPackage.fromPackage(apiPackage, api.packageName);
								const vfs = pkg.generateVfs();
								const vfsPayloads = prependImportsToVfs(vfs, apiPackage, api.packageName, wantTrace);

								// Resolve ogImage with cascading: API > global
								const resolvedOgImage = api.ogImage ?? options.ogImage;

								// Normalize theme configuration
								const resolvedTheme = normalizeThemeConfig(api.theme);

								return {
									vfs,
									vfsPayloads,
									externalPackages: externalPackages || [],
									config: {
										apiPackage,
										packageName: api.packageName,
										...(api.name != null ? { apiName: api.name } : {}),
										outputDir,
										baseRoute: fullRoute,
										categories: resolvedCategories,
										...(resolvedSource != null ? { source: resolvedSource } : {}),
										...(packageJson != null ? { packageJson } : {}),
										...(resolvedLlms != null ? { llmsPlugin: resolvedLlms } : {}),
										...(siteUrl != null ? { siteUrl } : {}),
										...(resolvedOgImage != null ? { ogImage: resolvedOgImage } : {}),
										docsDir: path.dirname(outputDir),
										...(docsRoot != null ? { docsRoot } : {}),
										...(resolvedTheme != null ? { theme: resolvedTheme } : {}),
									} satisfies ResolvedApiConfig,
								};
							}
						});

					// Model loading + VFS reconstruction. These are fused inside the
					// same Effect.promise bodies (processSimpleApi / the versioned
					// branch), so the modelLoad phase necessarily includes VFS
					// generation — isolating pure model-load would require
					// restructuring the loaders.
					yield* withPhase(
						"modelLoad",
						{ buildId },
						Effect.gen(function* () {
							if (options.api) {
								// === Single-API mode ===
								const api = options.api;
								const baseRoute = normalizeBaseRoute(api.baseRoute ?? "/");

								// Capture tsconfig for later resolution
								firstApiTsconfig = api.tsconfig;
								firstApiCompilerOptions = api.compilerOptions;
								scopeTsConfigs.set(apiScopeOf(baseRoute, api.packageName), rawTsConfig(api));

								if (rspressMultiVersion && api.versions) {
									// Versioned single-API mode
									const versionResults = yield* Effect.forEach(
										Object.entries(api.versions),
										([version, versionValue]) =>
											Effect.gen(function* () {
												// Derive versioned output paths
												const versionDerivedPaths = deriveOutputPaths({
													mode: "single",
													docsRoot: rspressRoot,
													baseRoute,
													apiFolder: api.apiFolder ?? "api",
													locales: rspressLocales,
													defaultLang: rspressLang,
													versions: [version],
													defaultVersion: rspressMultiVersion?.default,
												});
												const versionDp = versionDerivedPaths[0];
												if (!versionDp) {
													return {
														vfs: new Map<string, string>(),
														vfsPayloads: [] as VfsEntryPayload[],
														externalPackages: [] as ExternalPackageSpec[],
														config: null as ResolvedApiConfig | null,
													};
												}

												// Normalize version value to VersionConfig
												const versionConfig: VersionConfig = isVersionConfig(versionValue)
													? versionValue
													: { model: versionValue };

												const {
													apiPackage,
													packageJson: versionPackageJson,
													categories: versionCategories,
													source: versionSource,
													externalPackages: versionExternalPackages,
													autoDetectDependencies: versionAutoDetectDependencies,
													llmsPlugin: versionLlms,
													ogImage: versionOgImage,
												} = yield* withModelLoadEvents(loadVersionModel(versionConfig));

												{
													// `yield*`, not `Effect.runSync`: see the note on the same
													// metric in processSimpleApi above — a bare `runSync` resolves
													// the `MetricRegistry` Reference DEFAULT, writing to a
													// process-wide registry `logBuildSummary` never reads.
													yield* Metric.update(BuildMetrics.apiVersionsLoaded, 1);
													const resolvedCategories = categoryResolver.resolveCategoryConfig(
														pluginDefaults,
														api.categories,
														versionCategories,
													);
													const resolvedSource = categoryResolver.resolveSourceConfig(api.source, versionSource);
													const resolvedLlms = mergeLlmsPluginConfig(options.llmsPlugin, api.llmsPlugin, versionLlms);

													// Load package.json (version config takes precedence). Typed:
													// a missing or malformed file is a user misconfiguration.
													const packageJson =
														versionPackageJson ||
														(api.packageJson
															? yield* Effect.tryPromise({
																	try: () =>
																		loadPackageJson(api.packageJson as PathLike | (() => Promise<PackageJson>)),
																	catch: (cause) =>
																		new ConfigValidationError({
																			field: "packageJson",
																			reason: cause instanceof Error ? cause.message : String(cause),
																			cause,
																		}),
																})
															: undefined);

													// Validate external packages
													yield* Effect.try({
														try: () =>
															validateExternalPackages(versionExternalPackages || api.externalPackages, packageJson),
														catch: (cause) =>
															new ConfigValidationError({
																field: "externalPackages",
																reason: cause instanceof Error ? cause.message : String(cause),
																cause,
															}),
													});

													// Collect external packages (version > package > auto-detected)
													const autoDetectOptions = versionAutoDetectDependencies || api.autoDetectDependencies;
													const externalPackages =
														versionExternalPackages ||
														api.externalPackages ||
														extractAutoDetectedPackages(packageJson, autoDetectOptions);

													if (externalPackages && externalPackages.length > 0) {
														yield* Metric.update(BuildMetrics.externalPackagesTotal, externalPackages.length);
													}

													// Generate VFS
													const pkg = ApiExtractedPackage.fromPackage(apiPackage, api.packageName);
													const vfs = pkg.generateVfs();
													const vfsPayloads = prependImportsToVfs(vfs, apiPackage, api.packageName, wantTrace);

													// Resolve ogImage with cascading: version > API > global
													const resolvedOgImage = versionOgImage ?? api.ogImage ?? options.ogImage;
													const resolvedTheme = normalizeThemeConfig(api.theme);

													const outputDir = versionDp.outputDir;
													const fullRoute = versionDp.routeBase;

													return {
														vfs,
														vfsPayloads,
														externalPackages: externalPackages || [],
														config: {
															apiPackage,
															packageName: `${api.packageName} (${version})`,
															...(api.name != null ? { apiName: api.name } : {}),
															outputDir,
															baseRoute: fullRoute,
															categories: resolvedCategories,
															...(resolvedSource != null ? { source: resolvedSource } : {}),
															...(packageJson != null ? { packageJson } : {}),
															...(resolvedLlms != null ? { llmsPlugin: resolvedLlms } : {}),
															...(siteUrl != null ? { siteUrl } : {}),
															...(resolvedOgImage != null ? { ogImage: resolvedOgImage } : {}),
															docsDir: path.dirname(outputDir),
															...(docsRoot != null ? { docsRoot } : {}),
															...(resolvedTheme != null ? { theme: resolvedTheme } : {}),
														} satisfies ResolvedApiConfig,
													};
												}
											}),
										{ concurrency: "unbounded" },
									);

									// Flatten and merge version results
									for (const result of versionResults) {
										mergeApiResult(acc, result);
										yield* emitVfsPayloadEvents(api.packageName, result.vfsPayloads, wantTrace);
									}
								} else if (api.model) {
									// Non-versioned single-API mode
									const derivedPaths = deriveOutputPaths({
										mode: "single",
										docsRoot: rspressRoot,
										baseRoute,
										apiFolder: api.apiFolder ?? "api",
										locales: rspressLocales,
										defaultLang: rspressLang,
										versions: [],
										defaultVersion: undefined,
									});

									const dp = derivedPaths[0];
									if (dp) {
										const result = yield* processSimpleApi(api, api.model, dp.outputDir, dp.routeBase, wantTrace);
										mergeApiResult(acc, result);
										yield* emitVfsPayloadEvents(api.packageName, result.vfsPayloads, wantTrace);
									}
								}
							} else if (options.apis) {
								// === Multi-API mode ===
								// Each API is type-checked under its own configuration. The
								// first API's config is still tracked, but only as the fallback
								// for code blocks that belong to no documented scope.
								const apisWithTsconfig = options.apis.filter((a) => a.tsconfig);
								if (apisWithTsconfig.length > 0) {
									firstApiTsconfig = apisWithTsconfig[0].tsconfig;
								}
								const apisWithCompilerOptions = options.apis.filter((a) => a.compilerOptions);
								if (apisWithCompilerOptions.length > 0) {
									firstApiCompilerOptions = apisWithCompilerOptions[0].compilerOptions;
								}
								for (const a of options.apis) {
									const scopeRoute = normalizeBaseRoute(a.baseRoute ?? `/${unscopedName(a.packageName)}`);
									scopeTsConfigs.set(apiScopeOf(scopeRoute, a.packageName), rawTsConfig(a));
								}

								const multiResults = yield* Effect.forEach(
									options.apis,
									(api) =>
										Effect.gen(function* () {
											const apiBaseRoute = normalizeBaseRoute(api.baseRoute ?? `/${unscopedName(api.packageName)}`);
											const derivedPaths = deriveOutputPaths({
												mode: "multi",
												docsRoot: rspressRoot,
												baseRoute: apiBaseRoute,
												apiFolder: api.apiFolder ?? "api",
												locales: rspressLocales,
												defaultLang: rspressLang,
												versions: [],
												defaultVersion: undefined,
											});

											const dp = derivedPaths[0];
											if (!dp) return [];

											const result = yield* processSimpleApi(api, api.model, dp.outputDir, dp.routeBase, wantTrace);
											yield* emitVfsPayloadEvents(api.packageName, result.vfsPayloads, wantTrace);
											return [result];
										}),
									{ concurrency: "unbounded" },
								);

								// Flatten and merge results. Events were emitted inside the
								// per-API effect above, so this path only merges.
								for (const results of multiResults) {
									for (const result of results) {
										mergeApiResult(acc, result);
									}
								}
							}
						}),
					);

					const loadMs = performance.now() - loadStart;
					yield* emit(
						PluginEvent.ModelLoaded({
							ctx: {},
							level: "debug",
							entryPoints: apiConfigs.length,
							itemCount: apiConfigs.reduce(
								(sum, cfg) => sum + cfg.apiPackage.entryPoints.reduce((s, ep) => s + ep.members.length, 0),
								0,
							),
							durationMs: Math.round(loadMs),
						}),
					);

					// --- 5. Resolve TypeScript compiler options ---
					const projectRoot = process.cwd();
					let globalTsConfig: TypeScriptConfig | undefined;
					if (firstApiTsconfig || firstApiCompilerOptions) {
						globalTsConfig = {};
						if (firstApiTsconfig != null) {
							globalTsConfig.tsconfig = firstApiTsconfig as PathLike | (() => Promise<TypeResolutionCompilerOptions>);
						}
						if (firstApiCompilerOptions != null) {
							globalTsConfig.compilerOptions = firstApiCompilerOptions as TypeResolutionCompilerOptions;
						}
					}
					const resolvedCompilerOptions: TypeResolutionCompilerOptions = yield* resolveTsConfigTyped(
						projectRoot,
						globalTsConfig,
					);

					yield* emit(
						PluginEvent.TsCacheCreated({
							ctx: {},
							level: "debug",
							compilerOptions: `target=${resolvedCompilerOptions.target}, module=${resolvedCompilerOptions.module}, lib=[${resolvedCompilerOptions.lib?.join(", ") ?? ""}]`,
							durationMs: 0,
						}),
					);

					// --- 6. External type loading (recoverable) ---
					yield* mergeExternalTypes(typeRegistry, combinedVfs, apiConfigs, allExternalPackages);

					// --- 7. Twoslash init ---
					yield* registerTypeEnvironments({
						combinedVfs,
						resolvedCompilerOptions,
						scopeTsConfigs,
						projectRoot,
					});

					return apiConfigs;
				}),
		};
	});

/** The raw TypeScript config an API declares, or undefined when it declares none. */
function rawTsConfig(api: { tsconfig?: unknown; compilerOptions?: unknown }): TypeScriptConfig | undefined {
	if (api.tsconfig == null && api.compilerOptions == null) return undefined;
	const cfg: TypeScriptConfig = {};
	if (api.tsconfig != null) cfg.tsconfig = api.tsconfig as NonNullable<TypeScriptConfig["tsconfig"]>;
	if (api.compilerOptions != null) {
		cfg.compilerOptions = api.compilerOptions as NonNullable<TypeScriptConfig["compilerOptions"]>;
	}
	return cfg;
}
