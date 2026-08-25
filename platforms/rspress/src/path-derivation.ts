import path from "node:path";

/** Extract unscoped name from a potentially scoped package name */
export function unscopedName(packageName: string): string {
	return packageName.startsWith("@") ? (packageName.split("/")[1] ?? packageName) : packageName;
}

/** Normalize baseRoute: ensure leading slash, strip trailing slash, preserve root "/" */
export function normalizeBaseRoute(route: string): string {
	const withSlash = route.startsWith("/") ? route : `/${route}`;
	const stripped = withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
	return stripped === "" ? "/" : stripped;
}

export interface PathDerivationInput {
	mode: "single" | "multi";
	docsRoot: string;
	baseRoute: string;
	apiFolder: string | null;
	locales: readonly string[];
	defaultLang: string | undefined;
	versions: readonly string[];
	defaultVersion: string | undefined;
}

export interface DerivedPath {
	outputDir: string;
	routeBase: string;
	version: string | undefined;
	locale: string | undefined;
}

export function deriveOutputPaths(input: PathDerivationInput): DerivedPath[] {
	const { docsRoot, baseRoute, apiFolder, locales, defaultLang, versions, defaultVersion } = input;
	const results: DerivedPath[] = [];

	const folder = apiFolder ?? undefined;
	const baseSegment = baseRoute === "/" ? undefined : baseRoute.replace(/^\//, "");

	const versionList = versions.length > 0 ? versions : [undefined];
	const localeList = locales.length > 0 ? locales : [undefined];

	for (const version of versionList) {
		for (const locale of localeList) {
			const dirParts = [docsRoot, version, locale, baseSegment, folder].filter((p): p is string => p !== undefined);
			const outputDir = dirParts.length > 0 ? path.join(...dirParts) : docsRoot;

			const isDefaultVersion = version === defaultVersion;
			const isDefaultLocale = locale === defaultLang;

			const routeParts = [
				!isDefaultVersion ? version : undefined,
				!isDefaultLocale ? locale : undefined,
				baseSegment,
				folder,
			].filter((p): p is string => p !== undefined);

			const routeBase = routeParts.length > 0 ? `/${routeParts.join("/")}` : "/";

			results.push({ outputDir, routeBase, version, locale });
		}
	}

	return results;
}

/**
 * The API scope key derived from a base route.
 *
 * @remarks
 * Load-bearing and previously duplicated. Config resolution registers each
 * API's Twoslash environment under this key and the build program looks it up
 * by the same key; if the two derivations disagree, every lookup misses and
 * `getTransformer` falls back to the build-wide environment. Per-scope
 * type-checking degrades to build-wide with no error and nothing visibly
 * wrong in the output — the failure mode is silent, which is why one
 * definition matters more here than the duplication was costing.
 *
 * Falls back to the package name so a single-API site mounted at `/` still
 * gets a non-empty scope.
 */
export function apiScopeOf(baseRoute: string, packageName: string): string {
	return baseRoute.replace(/^\//, "").split("/")[0] || packageName;
}
