/**
 * Path predicates shared by the resolver and the cache. Manifest resolution
 * itself is `@effected/package-json`'s `PackageExports` (see
 * `TypeResolver.ts`); every path either one produces is untrusted, so it is
 * checked here before it reaches a CDN download URL or a cache join.
 */

import { isTypeDefinition } from "@tsdoctor/vfs";

/**
 * Whether a path names a TypeScript declaration file.
 *
 * Re-exported from `@tsdoctor/vfs`, which owns the single spelling of this
 * predicate — see its docs for why there must not be a second one. Imported
 * here so the registry's path predicates live in one module.
 */
export { isTypeDefinition };

/** Normalize backslashes to forward slashes. */
export const normalizePath = (path: string): string => path.replace(/\\/g, "/");

/**
 * Reject paths that are absolute or contain `..` segments. Shared by the
 * cache (paths from CDN file trees joined under the cache root) and the
 * resolver (paths from untrusted manifests that reach the CDN download URL).
 */
export const isSafeRelativePath = (filePath: string): boolean => {
	if (filePath.length === 0) return false;
	if (filePath.startsWith("/") || filePath.startsWith("\\")) return false;
	// Windows drive letters and UNC prefixes are absolute too.
	if (/^[A-Za-z]:/.test(filePath)) return false;
	return !filePath.split(/[/\\]+/).some((segment) => segment === "..");
};
