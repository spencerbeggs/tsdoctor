/* v8 ignore start -- service interface + Context.Tag, no testable logic */
import type { ApiPackage } from "@microsoft/api-extractor-model";
import type { Effect, Scope } from "effect";
import { Context } from "effect";
import type { ApiModelLoadError, ConfigValidationError, TypeRegistryError } from "../errors.js";
import type { PackageJson } from "../internal-types.js";
import type { ShikiThemeConfig } from "../markdown/shiki-utils.js";
import type { CategoryConfig, LlmsPlugin, OpenGraphImageConfig, SourceConfig } from "../schemas/index.js";
import type { TwoslashCacheService } from "./TwoslashCacheService.js";
import type { TwoslashEnvironments } from "./TwoslashEnvironments.js";
/**
 * Subset of RSPress config needed by ConfigService.
 * Extracted from the UserConfig in beforeBuild/config hooks.
 */
export interface RspressConfigSubset {
	readonly multiVersion?: { default: string; versions: string[] };
	readonly locales?: ReadonlyArray<{ lang: string }>;
	readonly lang?: string;
	readonly root?: string;
}

/**
 * Fully resolved config for a single API. Produced after model loading,
 * category merging, path derivation, and package resolution.
 * Plain interface (not Schema) because it contains ApiPackage.
 */
export interface ResolvedApiConfig {
	readonly apiPackage: ApiPackage;
	readonly packageName: string;
	readonly apiName?: string;
	readonly outputDir: string;
	readonly baseRoute: string;
	readonly categories: Record<string, CategoryConfig>;
	readonly source?: SourceConfig;
	readonly packageJson?: PackageJson;
	readonly llmsPlugin?: LlmsPlugin;
	readonly siteUrl?: string;
	readonly ogImage?: OpenGraphImageConfig;
	readonly docsDir?: string;
	readonly docsRoot?: string;
	readonly theme?: ShikiThemeConfig;
}

/**
 * ConfigService resolves plugin options + RSPress config into the fully
 * resolved API configurations the doc generation pipeline runs over.
 *
 * @remarks
 * `resolve` returns the API configs and nothing else. It used to return a
 * 16-field `ResolvedBuildContext` — a highlighter, an OG resolver, a
 * cross-linker, a Twoslash transformer, a live mutable cache, compiler
 * options, thresholds, concurrency — most of which config resolution neither
 * produced nor owned; it was a bag the build carried because there was nowhere
 * else to put things. Chunks 2–4 gave every one of those a home, and with one
 * field left the type stopped earning its name.
 */
export interface ConfigServiceShape {
	readonly resolve: (
		rspressConfig: RspressConfigSubset,
	) => Effect.Effect<
		ReadonlyArray<ResolvedApiConfig>,
		ConfigValidationError | ApiModelLoadError | TypeRegistryError,
		Scope.Scope | TwoslashCacheService | TwoslashEnvironments
	>;
}

export class ConfigService extends Context.Service<ConfigService, ConfigServiceShape>()(
	"rspress-plugin-api-extractor/ConfigService",
) {}
