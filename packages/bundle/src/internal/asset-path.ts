/**
 * Shared traversal guard for bundle-relative asset paths.
 *
 * @remarks
 * Not exported from `index.ts` — internal to the package. Both the fetch
 * plane ({@link "../BundleFetch.js"}) and the publish plane
 * ({@link "../BundleAssets.js"}) read a manifest-declared, bundle-relative
 * `openGraph.images[].path` and must reject the same shapes before touching
 * the filesystem: no absolute paths, no `.`/`..` traversal segments, no
 * separators hiding inside a segment.
 *
 * @internal
 */

const SAFE_SEGMENT = /^(?!\.{1,2}$)[^/\\\s]+$/;

/**
 * Whether `assetPath` is a relative path confined to the bundle directory —
 * no leading slash, no `.`/`..` segment, no unsafe characters in any
 * segment.
 *
 * @internal
 */
export function isSafeAssetPath(assetPath: string): boolean {
	if (assetPath.length === 0 || assetPath.startsWith("/") || assetPath.startsWith("\\")) {
		return false;
	}
	return assetPath.split(/[/\\]/).every((segment) => SAFE_SEGMENT.test(segment));
}
