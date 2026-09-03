/**
 * API scope naming — the helpers that turn a package name and a base route
 * into the identifiers every adapter must agree on.
 *
 * @remarks
 * These sit beside the navigation tree rather than in an adapter because the
 * scope string is load-bearing across frameworks: it keys Twoslash cache
 * generations and names the per-package llms files. Two adapters deriving it
 * differently would silently miss each other's caches. The multiVersion /
 * i18n output-directory layout is NOT here — that is a framework's product
 * policy and stays adapter-side.
 *
 * @packageDocumentation
 */

/**
 * Extract the unscoped name from a possibly scoped package name:
 * `@scope/pkg` becomes `pkg`, `pkg` stays `pkg`.
 *
 * @public
 */
export function unscopedName(packageName: string): string {
	return packageName.startsWith("@") ? (packageName.split("/")[1] ?? packageName) : packageName;
}

/**
 * Normalize a base route: ensure a leading slash, strip a trailing slash,
 * and keep the root as `/`.
 *
 * @public
 */
export function normalizeBaseRoute(route: string): string {
	const withSlash = route.startsWith("/") ? route : `/${route}`;
	const stripped = withSlash.endsWith("/") ? withSlash.slice(0, -1) : withSlash;
	return stripped === "" ? "/" : stripped;
}

/**
 * The API scope key derived from a base route: its first path segment,
 * falling back to the package name so a single-API site mounted at `/`
 * still gets a non-empty scope.
 *
 * @remarks
 * Load-bearing and previously duplicated. Config resolution registers each
 * API's Twoslash environment under this key and the build program looks it
 * up by the same key; if two derivations disagree, every lookup misses and
 * per-scope type-checking degrades to build-wide with no error and nothing
 * visibly wrong in the output. One definition matters more than the
 * duplication was costing.
 *
 * @public
 */
export function apiScopeOf(baseRoute: string, packageName: string): string {
	return baseRoute.replace(/^\//, "").split("/")[0] || packageName;
}
