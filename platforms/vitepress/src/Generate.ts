/**
 * The generation program: discover the bundle, load the model, build the
 * virtual file system and compiler options, lift every item into a
 * `@tsdoctor/pages` `Page`, emit it as VitePress markdown and write it under
 * the site's source directory.
 *
 * @remarks
 * This is the minimal path for the alpha. The RSPress plugin runs the same
 * sequence inside its `ConfigService` (`layers/config-resolution.ts`), which
 * is adapter-shaped — events, metrics, the multi-API and multi-version
 * cascades — so the neutral parts are re-spelled here rather than extracted;
 * the duplication (model → VFS → import prepending, dependency extraction,
 * compiler-option resolution) is the recorded Tier 2 item. Every file is
 * written unconditionally: snapshot-tracked incremental writes are not
 * wired for the alpha.
 *
 * @packageDocumentation
 */

import { PackageManifest } from "@effected/package-json";
import type { ApiEntryPoint, ApiPackage } from "@microsoft/api-extractor-model";
import { discoverBundle } from "@tsdoctor/bundle";
import { ApiExtractedPackage, CrossLinker, Model, TypeReferenceExtractor } from "@tsdoctor/model";
import type { CrossLinkData, NavEntry, WorkItem } from "@tsdoctor/pages";
import { buildIndexPage, buildNav, buildPage, prepareWorkItems } from "@tsdoctor/pages";
import type { TypeRegistry } from "@tsdoctor/registry";
import type { HeadTag, PackageContext } from "@tsdoctor/seo";
import { attributionFacts, deriveScriptBody, deriveSiteUrl, headTags, packageContext } from "@tsdoctor/seo";
import type { TypeResolutionCompilerOptions, Vfs } from "@tsdoctor/vfs";
import { resolveTypeScriptConfig } from "@tsdoctor/vfs";
import { Effect, FileSystem, Option, Path } from "effect";
import type { CategoryConfig } from "./Categories.js";
import { DEFAULT_CATEGORIES, navCategory } from "./Categories.js";
import { emitFrontmatter } from "./emit/frontmatter.js";
import { emitMarkdownBody } from "./emit/markdown.js";
import type { SidebarMulti } from "./emit/sidebar.js";
import { sidebarFor } from "./emit/sidebar.js";
import type { ExternalPackage, ExternalTypesReport } from "./Registry.js";
import { externalPackagesOf, loadExternalTypes } from "./Registry.js";

/**
 * The input to {@link generate}.
 *
 * @public
 */
export interface GenerateInput {
	/** The bundle folder: the api.json model plus its package.json and tsconfig. */
	readonly dir: string;
	/** Base for resolving `dir` and `docsDir`. */
	readonly cwd: string;
	/** VitePress's source directory; pages are written under it. */
	readonly docsDir: string;
	/** The route the API is mounted at, e.g. `/api`. */
	readonly baseRoute: string;
	/** The API's display name — the last title part, when the site names one. */
	readonly apiName?: string | undefined;
	/** The site origin, for canonical and Open Graph URLs; absent leaves them root-relative. */
	readonly siteOrigin?: string | undefined;
	/** VitePress's `base`. */
	readonly base?: string | undefined;
	/** Category overrides, merged over {@link DEFAULT_CATEGORIES} by key. */
	readonly categories?: Readonly<Record<string, Partial<CategoryConfig>>> | undefined;
	/** External packages to load declarations for; defaults to the manifest's dependencies. */
	readonly externalPackages?: ReadonlyArray<ExternalPackage> | undefined;
	/** Whether examples carry `@noErrors`; defaults to `true`. */
	readonly suppressExampleErrors?: boolean | undefined;
	/** The source repository, when the site links to it. */
	readonly source?: { readonly url: string; readonly ref?: string | undefined } | undefined;
}

/**
 * What generation produced, for the site's config and for the report.
 *
 * @public
 */
export interface GenerateResult {
	/** The documented package's name. */
	readonly packageName: string;
	/** The API's base route. */
	readonly baseRoute: string;
	/** The `themeConfig.sidebar` entry. */
	readonly sidebar: SidebarMulti;
	/** The combined virtual file system Twoslash checks against. */
	readonly vfs: Vfs;
	/** The resolved compiler options. */
	readonly compilerOptions: TypeResolutionCompilerOptions;
	/** Every page route written, in generation order. */
	readonly routes: ReadonlyArray<string>;
	/** The cross-link route map the pages were linked against. */
	readonly crossLinkData: CrossLinkData;
	/** What external type loading did. */
	readonly externalTypes: ExternalTypesReport;
	/** Items no category matched; they got no page. */
	readonly uncategorized: ReadonlyArray<string>;
	/** Examples Prettier could not format, by page route. */
	readonly formatFailures: ReadonlyArray<string>;
}

/**
 * Prepend `import type` statements for external references to each entry
 * point's declaration file, in place.
 */
function prependImportsToVfs(vfs: Vfs, apiPackage: ApiPackage, packageName: string): void {
	const extractor = new TypeReferenceExtractor(apiPackage, packageName);
	for (const entryPoint of apiPackage.entryPoints) {
		const entry = entryPoint as ApiEntryPoint;
		const statements = TypeReferenceExtractor.formatImports(extractor.extractImportsForEntryPoint(entry));
		if (statements.length === 0) continue;
		const file = `node_modules/${packageName}/${entry.displayName ? `${entry.displayName}.d.ts` : "index.d.ts"}`;
		const existing = vfs.get(file);
		if (existing) vfs.set(file, `${statements.join("\n")}\n\n${existing}`);
	}
}

function resolveCategories(
	overrides: Readonly<Record<string, Partial<CategoryConfig>>> | undefined,
): Record<string, CategoryConfig> {
	const result: Record<string, CategoryConfig> = { ...DEFAULT_CATEGORIES };
	for (const [key, override] of Object.entries(overrides ?? {})) {
		const base = result[key];
		if (base) result[key] = { ...base, ...override };
		else if (override.displayName && override.singularName && override.folderName) {
			result[key] = override as CategoryConfig;
		}
	}
	return result;
}

/** The file a route is written to under `docsDir`. */
const fileFor = (docsDir: string, route: string): string => `${docsDir}${route}.md`;

/**
 * Generate the API pages for one bundle.
 *
 * @remarks
 * Fails typed on what a user can fix — a missing bundle folder, an
 * unreadable model — and degrades on what is an enhancement (external types,
 * a manifest the SEO layer cannot decode, an example Prettier rejects). The
 * error channel is the union of `@tsdoctor/bundle`'s discovery errors,
 * `@tsdoctor/model`'s load errors and the platform's write errors.
 *
 * @public
 */
export const generate = Effect.fn("Generate.generate")(function* (input: GenerateInput) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;

	// 1. The bundle: model, package.json, tsconfig.
	const descriptor = yield* discoverBundle(input.dir, { cwd: input.cwd });
	const apiPackage = yield* Model.load(descriptor.modelPath);
	const packageName = descriptor.name;

	const packageJson: Record<string, unknown> | undefined =
		descriptor.packageJsonPath === undefined
			? undefined
			: yield* fs.readFileString(descriptor.packageJsonPath).pipe(
					Effect.map((text) => JSON.parse(text) as Record<string, unknown>),
					Effect.orElseSucceed(() => undefined),
				);
	// Presence-lenient but shape-strict; a decode failure drops attribution
	// rather than the build.
	const manifest = packageJson === undefined ? undefined : yield* decodeManifest(packageJson);

	// 2. The virtual file system: the package's own declarations, their
	//    external imports prepended, then its dependencies' declarations.
	const vfs: Vfs = ApiExtractedPackage.fromPackage(apiPackage, packageName).toVfs();
	prependImportsToVfs(vfs, apiPackage, packageName);
	const externalTypes = yield* loadExternalTypes(
		vfs,
		input.externalPackages ?? externalPackagesOf(packageJson),
		new Set([packageName]),
	);

	// 3. Compiler options from the bundle's tsconfig, over the defaults.
	const compilerOptions = yield* Effect.promise(() =>
		resolveTypeScriptConfig(
			descriptor.dir,
			undefined,
			descriptor.tsconfigPath === undefined ? undefined : { tsconfig: descriptor.tsconfigPath },
		),
	);

	// 4. Work items and the route map.
	const categories = resolveCategories(input.categories);
	const prepared = prepareWorkItems({ apiPackage, categories, baseRoute: input.baseRoute });
	if (prepared.collisions.length > 0) {
		return yield* Effect.die(
			new Error(
				`route collisions under ${input.baseRoute}: ${prepared.collisions
					.map((c) => `${c.route} <- ${c.items.map((i) => i.displayName).join(", ")}`)
					.join("; ")}`,
			),
		);
	}
	const linker = CrossLinker.fromRoutes(prepared.crossLinkData.routes);

	// 5. SEO facts derived once per API.
	const siteUrl = deriveSiteUrl(input.siteOrigin, input.base);
	const structuredDataPkg: PackageContext | undefined =
		manifest === undefined
			? undefined
			: packageContext({
					siteUrl,
					baseRoute: input.baseRoute,
					packageName,
					...(manifest.version != null ? { version: manifest.version.toString() } : {}),
					...(manifest.description != null ? { description: manifest.description } : {}),
					attribution: attributionFacts(manifest),
				});
	const buildTime = new Date().toISOString();

	// 6. Pages.
	const docsDir = path.resolve(input.cwd, input.docsDir);
	const entries: NavEntry[] = [];
	const routes: string[] = [];
	const formatFailures: string[] = [];
	for (const workItem of prepared.workItems) {
		const written = yield* writePage(workItem, {
			input,
			packageName,
			linker,
			siteUrl,
			structuredDataPkg,
			buildTime,
			docsDir,
			onFormatFailure: (route) => formatFailures.push(route),
		});
		if (Option.isSome(written)) {
			entries.push(written.value.nav);
			routes.push(written.value.route);
		}
	}

	// 7. The index page and the sidebar.
	const nav = buildNav({
		baseRoute: input.baseRoute,
		categories: Object.fromEntries(Object.entries(categories).map(([key, config]) => [key, navCategory(config)])),
		entries,
	});
	const index = buildIndexPage({ packageName, baseRoute: input.baseRoute });
	const indexBody = [
		`# ${index.title}`,
		"",
		index.description,
		"",
		...nav.groups.flatMap((group) => [
			`## ${group.category.displayName}`,
			"",
			...group.pages.map((page) => `- [${page.label}](${page.route})`),
			"",
		]),
	].join("\n");
	yield* writeFile(fs, path, fileFor(docsDir, `${input.baseRoute}/index`), emitFrontmatter(index) + indexBody);

	return {
		packageName,
		baseRoute: input.baseRoute,
		sidebar: sidebarFor(nav),
		vfs,
		compilerOptions,
		routes,
		crossLinkData: prepared.crossLinkData,
		externalTypes,
		uncategorized: prepared.uncategorized.map((item) => item.displayName),
		formatFailures,
	} satisfies GenerateResult;
});

/** Everything {@link writePage} needs beyond the work item. */
interface PageContext {
	readonly input: GenerateInput;
	readonly packageName: string;
	readonly linker: CrossLinker;
	readonly siteUrl: string;
	readonly structuredDataPkg: PackageContext | undefined;
	readonly buildTime: string;
	readonly docsDir: string;
	readonly onFormatFailure: (route: string) => void;
}

const writePage = Effect.fn("Generate.writePage")(function* (workItem: WorkItem<CategoryConfig>, ctx: PageContext) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const { item, categoryConfig } = workItem;
	const built = yield* buildPage({
		item,
		categoryKey: workItem.categoryKey,
		singularName: categoryConfig.singularName,
		folderName: categoryConfig.folderName,
		baseRoute: ctx.input.baseRoute,
		packageName: ctx.packageName,
		apiName: ctx.input.apiName,
		namespaceMember: workItem.namespaceMember,
		availableFrom: workItem.availableFrom,
		syntheticBase: workItem.syntheticBase,
		memberAnchors: workItem.memberAnchors,
		source: ctx.input.source,
		suppressExampleErrors: ctx.input.suppressExampleErrors,
		linker: ctx.linker,
		onExampleFormatError: () => Effect.sync(() => ctx.onFormatFailure(item.displayName)),
	});
	if (Option.isNone(built)) return Option.none();
	const page = built.value;

	// Head tags: canonical, Open Graph, Twitter and — when the manifest
	// decoded — the JSON-LD graph. Both timestamps are the build time: there
	// is no snapshot to preserve an earlier one from.
	const structuredData =
		ctx.structuredDataPkg === undefined
			? undefined
			: deriveScriptBody(ctx.structuredDataPkg, {
					pageRoute: page.route,
					symbolName: item.displayName,
					description: page.description,
					section: categoryConfig.displayName,
					publishedTime: ctx.buildTime,
					modifiedTime: ctx.buildTime,
				});
	const tags: ReadonlyArray<HeadTag> = headTags({
		siteUrl: ctx.siteUrl,
		pageRoute: page.route,
		description: page.description,
		publishedTime: ctx.buildTime,
		modifiedTime: ctx.buildTime,
		section: categoryConfig.displayName,
		packageName: ctx.packageName,
		...(structuredData !== undefined && structuredData._tag === "Success"
			? { structuredData: structuredData.success }
			: {}),
	});

	const body = yield* Effect.fromResult(emitMarkdownBody(page)).pipe(Effect.orDie);
	const content = emitFrontmatter({ title: page.title, description: page.description, headTags: tags }) + body;
	yield* writeFile(fs, path, fileFor(ctx.docsDir, page.route), content);
	return Option.some({ route: page.route, nav: page.nav });
});

function writeFile(fs: FileSystem.FileSystem, path: Path.Path, file: string, content: string) {
	return fs
		.makeDirectory(path.dirname(file), { recursive: true })
		.pipe(Effect.andThen(fs.writeFileString(file, content)));
}

function decodeManifest(packageJson: Record<string, unknown>) {
	return PackageManifest.decode(packageJson).pipe(
		Effect.map((manifest) => manifest as PackageManifest),
		Effect.orElseSucceed((): PackageManifest | undefined => undefined),
	);
}

/**
 * The services {@link generate} runs over: the platform plus the registry.
 *
 * @public
 */
export type GenerateServices = FileSystem.FileSystem | Path.Path | TypeRegistry;
