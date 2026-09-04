/* v8 ignore start -- service interface + Context.Tag, no testable logic */
import type { PackageManifest } from "@effected/package-json";
import type { ApiPackage } from "@microsoft/api-extractor-model";
import type { PublishedOpenGraphImage, ResolvedBundle } from "@tsdoctor/bundle";
import type { OpenGraphImageConfig } from "@tsdoctor/seo";
import type { FileSystem, Path } from "effect";
import { Context, Effect, Layer } from "effect";
import type { ConfigValidationError } from "../errors.js";
import type { PackageJson } from "../internal-types.js";
import { makeConfigService } from "../layers/config-resolution.js";
import type { ShikiThemeConfig } from "../markdown/shiki-utils.js";
import type { CategoryConfig, LlmsPlugin, SourceConfig } from "../schemas/config.js";
import type { PluginConfig } from "./PluginConfig.js";
import type { TwoslashCacheService } from "./TwoslashCacheService.js";
import type { TwoslashEnvironments } from "./TwoslashEnvironments.js";
import type { TypeRegistryService } from "./TypeRegistryService.js";
/**
 * Subset of RSPress config needed by ConfigService.
 * Extracted from the UserConfig in beforeBuild/config hooks.
 */
export interface RspressConfigSubset {
	readonly multiVersion?: { default: string; versions: string[] };
	readonly locales?: ReadonlyArray<{ lang: string }>;
	readonly lang?: string;
	readonly root?: string;
	/**
	 * RSPress's `siteOrigin` and `base`, the source of the canonical site URL.
	 *
	 * @remarks
	 * These replace the plugin's former `siteUrl` option. RSPress already knows
	 * where the site is deployed, and a second plugin-level answer could
	 * contradict it — emitting canonical and `og:url` tags for a host the site
	 * is not served from, with nothing to flag the disagreement.
	 */
	readonly siteOrigin?: string;
	readonly base?: string;
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
	/**
	 * The same manifest decoded through `@effected/package-json`'s
	 * `PackageManifest` — typed `Person` / `Repository` / SPDX license, which is
	 * the shape the SEO layer derives attribution from.
	 *
	 * @remarks
	 * Deliberately NOT the discovery-tier `LenientManifest`, which leaves
	 * `author` and `repository` as raw `string | Record` unions with no
	 * decoding at all. `PackageManifest` is presence-lenient but shape-strict,
	 * so one malformed field fails the whole decode — and that degrades to this
	 * field being absent (with a `ConfigValidationWarning` emitted), never to a
	 * failed build.
	 *
	 * The loose {@link ResolvedApiConfig.packageJson} above stays alongside it:
	 * it feeds dependency extraction, and replacing it is a separate refactor.
	 */
	readonly manifest?: PackageManifest;
	readonly llmsPlugin?: LlmsPlugin;
	readonly siteUrl?: string;
	readonly ogImage?: OpenGraphImageConfig;
	readonly docsRoot?: string;
	readonly theme?: ShikiThemeConfig;
	/**
	 * The API's bundle, resolved with provenance across the manifest tiers.
	 *
	 * @remarks
	 * Always present: a bundle with no `tsdoctor.json` still resolves, its
	 * `name` falling back to the api.json model's own name.
	 */
	readonly bundle: ResolvedBundle;
	/**
	 * The site's display name, for `og:site_name`.
	 *
	 * @remarks
	 * `resolved.project?.value.name ?? resolved.name.value` — a monorepo's
	 * project identity when the manifest carries one, else the package's own
	 * resolved name.
	 */
	readonly siteName?: string;
	/**
	 * The bundle manifest's Open Graph image, published into the site's public
	 * directory.
	 *
	 * @remarks
	 * Absent when the bundle declares no `openGraph` block, when publishing
	 * failed (degrades to a `ConfigValidationWarning`) or when `siteUrl` is
	 * unset. The legacy `ogImage` option, resolved through {@link OgService},
	 * always outranks this — see `generateSinglePage`.
	 */
	readonly bundleOgImage?: PublishedOpenGraphImage;
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
		ConfigValidationError,
		TwoslashCacheService | TwoslashEnvironments | FileSystem.FileSystem | Path.Path
	>;
}

export class ConfigService extends Context.Service<ConfigService, ConfigServiceShape>()(
	"rspress-plugin-api-extractor/ConfigService",
) {
	/**
	 * Config resolution over the plugin options and the RSPress config.
	 *
	 * @remarks
	 * A plain `const`, not a factory. It used to take the plugin options as an
	 * argument, which made it a layer-RETURNING function: layers memoize by
	 * reference, so a second call would build a second `ConfigService` with its
	 * own captured `TypeRegistry`. The options come from {@link PluginConfig}
	 * now, so there is nothing to pass and "call it twice" is a type error
	 * rather than a test case.
	 *
	 * `Effect.suspend` because {@link makeConfigService} is imported from a
	 * module this one is also imported BY: a static initializer runs while the
	 * module body is still evaluating, so reading the binding eagerly can throw
	 * at import time with a completely clean typecheck.
	 */
	static readonly layer: Layer.Layer<ConfigService, never, TypeRegistryService | PluginConfig> = Layer.effect(
		this,
		Effect.suspend(() => makeConfigService),
	);

	/**
	 * An in-memory double whose unstubbed member dies naming itself.
	 *
	 * @remarks
	 * **No default `resolve`.** Returning an empty array by default would be a
	 * silent "this site documents nothing" — the exact state an inert plugin
	 * produces — so a test that forgot to stub it would assert against a build
	 * that generated no pages and pass. Stub it explicitly, or provide
	 * {@link ConfigService.layer} over real inputs.
	 */
	static readonly makeTest = (overrides: Partial<ConfigServiceShape> = {}): ConfigServiceShape => ({
		resolve: overrides.resolve ?? (() => unstubbed("resolve")),
	});

	/** {@link ConfigService.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<ConfigServiceShape> = {}): Layer.Layer<ConfigService> =>
		Layer.succeed(ConfigService, ConfigService.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`ConfigService.makeTest: ${member}() was called but not stubbed — pass an override.`);
};
