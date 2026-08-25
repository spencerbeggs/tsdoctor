import type { PathLike } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import type { ApiModel, ApiPackage } from "@microsoft/api-extractor-model";
import { Model } from "@tsdoctor/model";
import { Effect } from "effect";
import { isLoadedModel, isVersionConfig } from "./config-utils.js";
import type { LoadedModel, PackageJson } from "./internal-types.js";
import type {
	AutoDetectDependencies,
	CategoryConfig,
	ExternalPackageSpec,
	LlmsPlugin,
	SourceConfig,
	VersionConfig,
} from "./schemas/config.js";
import type { OpenGraphImageConfig } from "./schemas/opengraph.js";

/**
 * The typed failures a model load can produce. Path loads fail with
 * not-found/parse errors; loader-function results that carry no usable
 * package fail with {@link Model.EmptyModelError}.
 */
export type ModelLoadError = Model.ModelNotFoundError | Model.ModelParseError | Model.EmptyModelError;

/** A loaded model plus the source config a LoadedModel-returning loader supplied. */
export interface LoadedApiModel {
	readonly apiPackage: ApiPackage;
	readonly source?: SourceConfig;
}

/** The resolved pieces of a version config after loading. */
export interface LoadedVersionModel {
	readonly apiPackage: ApiPackage;
	readonly packageJson?: PackageJson;
	readonly categories?: Record<string, CategoryConfig>;
	readonly source?: SourceConfig;
	readonly externalPackages?: ExternalPackageSpec[];
	readonly autoDetectDependencies?: AutoDetectDependencies;
	readonly ogImage?: OpenGraphImageConfig;
	readonly llmsPlugin?: LlmsPlugin;
}

/**
 * Load package.json from a path (string, URL, or Buffer).
 */
async function loadPackageJsonFromPath(pkgPath: PathLike): Promise<PackageJson> {
	const resolvedPath = path.resolve(pkgPath.toString());
	if (!fs.existsSync(resolvedPath)) {
		throw new Error(`Package.json file not found: ${resolvedPath}`);
	}

	const content = fs.readFileSync(resolvedPath, "utf-8");
	try {
		return JSON.parse(content) as PackageJson;
	} catch (error) {
		throw new Error(`Failed to parse package.json at ${resolvedPath}: ${(error as Error).message}`);
	}
}

/**
 * Load package.json from PathLike or async function.
 */
export async function loadPackageJson(
	loader: PathLike | (() => Promise<PackageJson>),
): Promise<PackageJson | undefined> {
	if (typeof loader === "function") {
		return await loader();
	}
	return await loadPackageJsonFromPath(loader);
}

/** Extract the first package from a user-loader result (ApiModel-shaped object). */
const packageFromLoaderResult = (result: unknown): Effect.Effect<ApiPackage, Model.EmptyModelError> => {
	if (result && typeof result === "object" && "packages" in result) {
		return Model.firstPackage(result as ApiModel).pipe(
			Effect.mapError(
				() => new Model.EmptyModelError({ reason: "API model returned by function contains no packages" }),
			),
		);
	}
	return Effect.fail(new Model.EmptyModelError({ reason: "API model loader function must return an ApiModel" }));
};

/**
 * Load an API model from a PathLike (via `Model.load`, typed errors) or a
 * user-supplied async loader function (ApiModel or LoadedModel result).
 */
export function loadApiModel(
	loader: PathLike | (() => Promise<ApiModel | LoadedModel>),
): Effect.Effect<LoadedApiModel, ModelLoadError> {
	if (typeof loader !== "function") {
		return Model.load(loader.toString()).pipe(Effect.map((apiPackage) => ({ apiPackage })));
	}
	return Effect.gen(function* () {
		const result = yield* Effect.promise(() => loader());
		if (isLoadedModel(result)) {
			const apiPackage = yield* packageFromLoaderResult(result.model);
			return result.source != null ? { apiPackage, source: result.source } : { apiPackage };
		}
		const apiPackage = yield* packageFromLoaderResult(result);
		return { apiPackage };
	});
}

/**
 * Resolve and load a version config (full VersionConfig, or a bare model
 * path/loader).
 */
export function loadVersionModel(
	versionValue: PathLike | (() => Promise<ApiModel | LoadedModel>) | VersionConfig,
): Effect.Effect<LoadedVersionModel, ModelLoadError> {
	if (!isVersionConfig(versionValue)) {
		return loadApiModel(versionValue);
	}
	return Effect.gen(function* () {
		const { apiPackage, source: loaderSource } = yield* loadApiModel(
			versionValue.model as PathLike | (() => Promise<ApiModel | LoadedModel>),
		);
		const packageJson = versionValue.packageJson
			? yield* Effect.promise(() =>
					loadPackageJson(versionValue.packageJson as PathLike | (() => Promise<PackageJson>)),
				)
			: undefined;

		const versionResult: {
			apiPackage: ApiPackage;
			packageJson?: PackageJson;
			categories?: Record<string, CategoryConfig>;
			source?: SourceConfig;
			externalPackages?: ExternalPackageSpec[];
			autoDetectDependencies?: AutoDetectDependencies;
			ogImage?: OpenGraphImageConfig;
			llmsPlugin?: LlmsPlugin;
		} = { apiPackage };
		if (packageJson != null) versionResult.packageJson = packageJson;
		if (versionValue.categories != null) versionResult.categories = versionValue.categories;
		const resolvedSource = loaderSource || versionValue.source;
		if (resolvedSource != null) versionResult.source = resolvedSource;
		if (versionValue.externalPackages != null) versionResult.externalPackages = versionValue.externalPackages;
		if (versionValue.autoDetectDependencies != null)
			versionResult.autoDetectDependencies = versionValue.autoDetectDependencies;
		if (versionValue.ogImage != null) versionResult.ogImage = versionValue.ogImage;
		if (versionValue.llmsPlugin != null) versionResult.llmsPlugin = versionValue.llmsPlugin;
		return versionResult;
	});
}
