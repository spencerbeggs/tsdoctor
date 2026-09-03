import path from "node:path";

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
