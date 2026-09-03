/**
 * The public helper a site's `.vitepress/config.mts` awaits at config-load
 * time: generates the pages, opens the Twoslash result cache and returns the
 * sidebar, the code transformer and the `buildEnd` hook that persists the
 * cache.
 *
 * @remarks
 * Generation happens HERE, at config load, because VitePress has no
 * pre-scan hook comparable to RSPress's `config()`: its config file is ESM
 * and may top-level await, and `buildEnd` / `postRender` run after the fact.
 * The result is merged into `defineConfig` by the site.
 *
 * @packageDocumentation
 */

import { Effect, Layer, ManagedRuntime } from "effect";
import type { ShikiTransformer } from "shiki";

import type { CategoryConfig } from "./Categories.js";
import type { SidebarMulti } from "./emit/sidebar.js";
import type { GenerateResult } from "./Generate.js";
import { generate } from "./Generate.js";
import type { ExternalPackage } from "./Registry.js";
import { PlatformLive, RegistryLive } from "./Registry.js";
import { environmentHash, makeTwoslashTransformer } from "./Twoslash.js";
import type { TwoslashCacheReport } from "./TwoslashCache.js";
import { TwoslashCacheStore } from "./TwoslashCache.js";

/**
 * The options {@link apiExtractor} takes.
 *
 * @public
 */
export interface ApiExtractorOptions {
	/** The bundle folder: the api.json model plus its package.json and tsconfig. */
	readonly dir: string;
	/** Base for resolving `dir` and `docsDir`. Defaults to `process.cwd()`. */
	readonly cwd?: string | undefined;
	/** VitePress's source directory. Defaults to `docs`. */
	readonly docsDir?: string | undefined;
	/** The route the API is mounted at. Defaults to `/api`. */
	readonly baseRoute?: string | undefined;
	/** The API's display name — the last title part, when the site names one. */
	readonly name?: string | undefined;
	/** The site origin, for canonical and Open Graph URLs. */
	readonly siteOrigin?: string | undefined;
	/** VitePress's `base`, when set. */
	readonly base?: string | undefined;
	/** Category overrides, merged over the defaults by key. */
	readonly categories?: Readonly<Record<string, Partial<CategoryConfig>>> | undefined;
	/** External packages to load declarations for; defaults to the manifest's dependencies. */
	readonly externalPackages?: ReadonlyArray<ExternalPackage> | undefined;
	/** Whether examples carry `@noErrors`. Defaults to `true`. */
	readonly suppressExampleErrors?: boolean | undefined;
	/** The source repository, when the site links to it. */
	readonly source?: { readonly url: string; readonly ref?: string | undefined } | undefined;
	/** Whether to print a one-line summary. Defaults to `true`. */
	readonly log?: boolean | undefined;
}

/**
 * What {@link apiExtractor} returns for the site to merge into its config.
 *
 * @public
 */
export interface ApiExtractorResult {
	/** The `themeConfig.sidebar` entry for the API. */
	readonly sidebar: SidebarMulti;
	/** The `markdown.codeTransformers` entries: the Twoslash transformer. */
	readonly codeTransformers: ReadonlyArray<ShikiTransformer>;
	/** Hooks for the site's config. */
	readonly hooks: {
		/** Persist the Twoslash result cache; the site's `buildEnd`. */
		readonly buildEnd: () => Promise<TwoslashCacheReport | undefined>;
	};
	/** What generation produced. */
	readonly generated: GenerateResult;
}

const AppLive = Layer.mergeAll(PlatformLive, RegistryLive, TwoslashCacheStore.layer);

/**
 * Generate the API pages and return what the site's config needs.
 *
 * @example
 * ```ts
 * // .vitepress/config.mts
 * import { defineConfig } from "vitepress";
 * import { apiExtractor } from "vitepress-plugin-api-extractor";
 *
 * const api = await apiExtractor({ dir: "./lib/models/kitchensink" });
 *
 * export default defineConfig({
 *   themeConfig: { sidebar: api.sidebar },
 *   markdown: { codeTransformers: [...api.codeTransformers] },
 *   buildEnd: async () => { await api.hooks.buildEnd(); },
 * });
 * ```
 *
 * @public
 */
export async function apiExtractor(options: ApiExtractorOptions): Promise<ApiExtractorResult> {
	const runtime = ManagedRuntime.make(AppLive);
	const cwd = options.cwd ?? process.cwd();
	const log = options.log ?? true;

	const generated = await runtime.runPromise(
		generate({
			dir: options.dir,
			cwd,
			docsDir: options.docsDir ?? "docs",
			baseRoute: options.baseRoute ?? "/api",
			apiName: options.name,
			siteOrigin: options.siteOrigin,
			base: options.base,
			categories: options.categories,
			externalPackages: options.externalPackages,
			suppressExampleErrors: options.suppressExampleErrors,
			source: options.source,
		}),
	);

	const envHash = environmentHash(generated.vfs);
	const typesCache = await runtime.runPromise(
		Effect.gen(function* () {
			const store = yield* TwoslashCacheStore;
			return yield* store.open(envHash);
		}),
	);
	const transformer = makeTwoslashTransformer({
		vfs: generated.vfs,
		compilerOptions: generated.compilerOptions,
		typesCache,
	});

	if (log) {
		const external =
			generated.externalTypes.loaded.length > 0 ? `, ${generated.externalTypes.loaded.length} external package(s)` : "";
		console.log(
			`[vitepress-plugin-api-extractor] ${generated.packageName}: ${generated.routes.length} pages under ${generated.baseRoute}, ${generated.vfs.size} declaration files${external}, twoslash cache ${typesCache.stats().entries} entries`,
		);
		if (generated.externalTypes.warning) {
			console.warn(`[vitepress-plugin-api-extractor] external types degraded: ${generated.externalTypes.warning}`);
		}
		for (const name of generated.uncategorized) {
			console.warn(`[vitepress-plugin-api-extractor] skipped ${name}: no category matched`);
		}
	}

	let persisted: Promise<TwoslashCacheReport | undefined> | undefined;
	const buildEnd = (): Promise<TwoslashCacheReport | undefined> => {
		persisted ??= runtime
			.runPromise(
				Effect.gen(function* () {
					const store = yield* TwoslashCacheStore;
					const report = yield* store.persist();
					return report._tag === "Some" ? report.value : undefined;
				}),
			)
			.then(async (report) => {
				if (log && report) {
					console.log(
						`[vitepress-plugin-api-extractor] twoslash cache: ${report.hits} hit(s), ${report.misses} miss(es), ${report.entries} entries${report.dirty ? " (saved)" : ""}${report.degraded ? " (degraded)" : ""}`,
					);
				}
				await runtime.dispose();
				return report;
			});
		return persisted;
	};

	return { sidebar: generated.sidebar, codeTransformers: [transformer], hooks: { buildEnd }, generated };
}
