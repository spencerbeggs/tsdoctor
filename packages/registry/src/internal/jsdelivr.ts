import { Schema } from "effect";
import type { PackageSpec } from "../PackageSpec.js";
import { isSafeRelativePath } from "./resolution.js";

/** Base URL for the jsDelivr data/metadata API. */
export const DATA_API = "https://data.jsdelivr.com/v1";

/** Base URL for the jsDelivr file-serving CDN. */
export const CDN = "https://cdn.jsdelivr.net";

/**
 * Matches TypeScript declaration file names: the standard `.d.ts`, `.d.mts`
 * and `.d.cts` suffixes, plus the arbitrary-extension form `.d.<ext>.ts`
 * (TS 5 `allowArbitraryExtensions`, e.g. `styles.d.css.ts`). The middle
 * segment is only valid before a plain `.ts` — `.d.<ext>.mts`/`.cts` are not
 * declaration forms — and cannot span path separators, so a directory named
 * `assets.d.css` does not make `assets.d.css/index.ts` a declaration file.
 */
export const TYPE_FILE_PATTERN = /(\.d\.[cm]?ts|\.d\.[^./\\]+\.ts)$/i;

/** The package metadata endpoint: versions and dist-tags. */
export const versionsUrl = (name: string): string => `${DATA_API}/package/npm/${name}`;

/** The flat file-tree endpoint for a pinned package version. */
export const fileTreeUrl = (pkg: PackageSpec): string => `${DATA_API}/package/npm/${pkg.name}@${pkg.version}/flat`;

/**
 * The CDN URL for one file of a pinned package version. Each path segment is
 * percent-encoded so a file name containing `?`, `#` or `%` cannot rewrite
 * the URL's query, fragment or escaping, and a path that escapes the pinned
 * package (`..` segments, absolute forms) throws before a URL exists —
 * `encodeURIComponent` leaves dots active, so encoding alone cannot stop
 * URL normalization from resolving a `..` outside the package. Service
 * callers wrap the throw into a typed failure.
 */
export const fileUrl = (pkg: PackageSpec, filePath: string): string => {
	const relative = filePath.replace(/^\/+/, "");
	if (!isSafeRelativePath(relative)) {
		throw new Error(`file path escapes the pinned package: ${filePath}`);
	}
	const encoded = relative
		.split("/")
		.filter((segment) => segment !== "" && segment !== ".")
		.map(encodeURIComponent)
		.join("/");
	return `${CDN}/npm/${pkg.name}@${pkg.version}/${encoded}`;
};

/** The CDN URL for a pinned package version's `package.json`. */
export const packageJsonUrl = (pkg: PackageSpec): string => fileUrl(pkg, "package.json");

/**
 * The `/package/npm/:name` response: published versions plus dist-tags.
 * Lenient — only the two fields the resolver reads.
 */
export const VersionsResponse = Schema.Struct({
	versions: Schema.Array(Schema.String),
	tags: Schema.Record(Schema.String, Schema.String),
});

/**
 * The `/package/npm/:pkg@:version/flat` response. `default` is metadata only
 * (`null` for packages that declare none, e.g. `ink`); the loader consumes
 * `files`, never `default`. `size` (bytes) is used to pre-check the
 * type-file download budget before any request is made.
 */
export const FileTreeResponse = Schema.Struct({
	default: Schema.NullOr(Schema.String),
	files: Schema.Array(
		Schema.Struct({
			name: Schema.String,
			size: Schema.optionalKey(Schema.Number),
		}),
	),
});
