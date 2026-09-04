/**
 * Publishing a resolved bundle's Open Graph images into a site's public
 * directory.
 *
 * @remarks
 * `resolveBundle` produces `ResolvedOpenGraphImage` values whose `path` field
 * (when present) is bundle-relative — a location inside the bundle directory,
 * not the site's own output tree. An adapter must copy that file somewhere a
 * built site actually serves and hand back an absolute URL a `<head>` tag can
 * use; `url` images need no copy and pass straight through.
 *
 * @packageDocumentation
 */

import { Effect, FileSystem, Path, Schema } from "effect";
import { imageSize } from "image-size";
import type { ResolvedOpenGraphImage } from "./BundleResolver.js";
import { isSafeAssetPath } from "./internal/asset-path.js";

/**
 * A bundle-relative Open Graph image could not be published: the source file
 * could not be read, or the destination could not be written.
 *
 * @public
 */
export class BundleAssetError extends Schema.TaggedError<BundleAssetError>()("BundleAssetError", {
	/** The source or destination path at fault. */
	path: Schema.String,
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Could not publish bundle asset ${this.path}`;
	}
}

/**
 * One Open Graph image after publication: an absolute URL a `<head>` tag can
 * use directly, plus whatever facts are known about it.
 *
 * @public
 */
export interface PublishedOpenGraphImage {
	/** Absolute (or, when `siteUrl` is `""`, root-relative) URL. */
	readonly url: string;
	readonly type?: string;
	readonly width?: number;
	readonly height?: number;
	readonly alt: string;
}

/**
 * Input to {@link publishBundleAssets}.
 *
 * @public
 */
export interface PublishBundleAssetsInput {
	/** The bundle directory a resolved image's `path` is relative to. */
	readonly bundleDir: string;
	readonly images: ReadonlyArray<ResolvedOpenGraphImage>;
	/** The site's static-asset root (e.g. `docs/public`). */
	readonly publicDir: string;
	/** The site's absolute origin; `""` yields root-relative URLs. */
	readonly siteUrl: string;
	/** The route segment a package's published assets are namespaced under. */
	readonly unscopedName: string;
	/**
	 * An additional route segment inserted after `unscopedName`, for a site
	 * that publishes more than one build of the same package (e.g. one
	 * version per `VersionConfig`) under one public directory.
	 *
	 * @remarks
	 * Without it, two versions of the same package that both carry an
	 * `openGraph` image publish to the identical
	 * `tsdoctor/<unscopedName>/<basename>` route and overwrite each other on
	 * every build — differing bytes defeat the identical-bytes skip, and
	 * whichever version built last wins for every version's pages.
	 */
	readonly subdir?: string;
}

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
	a.byteLength === b.byteLength && a.every((value, index) => value === b[index]);

interface MeasuredSize {
	readonly width?: number;
	readonly height?: number;
}

/** `imageSize` throws on bytes it cannot parse; that degrades to no measurement, never a failure. */
function safeSize(bytes: Uint8Array): MeasuredSize | undefined {
	try {
		const size = imageSize(bytes);
		return {
			...(size.width !== undefined ? { width: size.width } : {}),
			...(size.height !== undefined ? { height: size.height } : {}),
		};
	} catch {
		return undefined;
	}
}

/**
 * Copy every bundle-relative image into `<publicDir>/tsdoctor/<unscopedName>/`
 * and return every image — bundle-relative or external — as a
 * {@link PublishedOpenGraphImage} carrying an absolute URL.
 *
 * @remarks
 * Identical bytes are not rewritten, so a rebuild over an unchanged image
 * leaves the published file's own metadata (mtime and any framework cache
 * keyed on it) untouched. Width and height are read from the resolved image
 * when the manifest declared them, and measured from the file's bytes only
 * when it did not.
 *
 * @public
 */
export const publishBundleAssets = Effect.fn("publishBundleAssets")(function* (input: PublishBundleAssetsInput) {
	const fs = yield* FileSystem.FileSystem;
	const path = yield* Path.Path;
	const out: PublishedOpenGraphImage[] = [];

	for (const image of input.images) {
		const common = {
			...(image.type !== undefined ? { type: image.type.value } : {}),
			...(image.width !== undefined ? { width: image.width } : {}),
			...(image.height !== undefined ? { height: image.height } : {}),
			alt: image.alt.value,
		};

		if (image.url !== undefined) {
			out.push({ url: image.url, ...common });
			continue;
		}

		if (image.path === undefined) {
			// A path-XOR-url image (`BundleResolver.ts`'s own filter) can never
			// reach this branch with neither set — a schema-impossible state
			// stated as a typed failure rather than silently reading the bundle
			// directory itself as a file.
			return yield* Effect.fail(new BundleAssetError({ path: input.bundleDir, cause: "image has no path or url" }));
		}
		if (!isSafeAssetPath(image.path)) {
			return yield* Effect.fail(
				new BundleAssetError({ path: image.path, cause: `openGraph image path escapes the bundle: "${image.path}"` }),
			);
		}

		const source = path.join(input.bundleDir, image.path);
		const bytes = yield* fs
			.readFile(source)
			.pipe(Effect.mapError((cause) => new BundleAssetError({ path: source, cause })));

		const basename = path.basename(source);
		const destSegments = [input.publicDir, "tsdoctor", input.unscopedName, ...(input.subdir ? [input.subdir] : [])];
		const destDir = path.join(...destSegments);
		const dest = path.join(destDir, basename);

		const existing = yield* fs.readFile(dest).pipe(Effect.option);
		if (existing._tag === "None" || !bytesEqual(existing.value, bytes)) {
			yield* fs
				.makeDirectory(destDir, { recursive: true })
				.pipe(Effect.mapError((cause) => new BundleAssetError({ path: destDir, cause })));
			yield* fs.writeFile(dest, bytes).pipe(Effect.mapError((cause) => new BundleAssetError({ path: dest, cause })));
		}

		const measured = image.width === undefined || image.height === undefined ? safeSize(bytes) : undefined;
		const urlSegments = ["tsdoctor", input.unscopedName, ...(input.subdir ? [input.subdir] : []), basename];

		out.push({
			url: `${input.siteUrl}/${urlSegments.join("/")}`,
			// Measured dimensions fill in ONLY what the manifest left undeclared —
			// spread first, then `common` (which carries any declared width/height)
			// so a declared value always wins over a measured one, never the reverse.
			...(image.width === undefined && measured?.width !== undefined ? { width: measured.width } : {}),
			...(image.height === undefined && measured?.height !== undefined ? { height: measured.height } : {}),
			...common,
		});
	}

	return out as ReadonlyArray<PublishedOpenGraphImage>;
});
