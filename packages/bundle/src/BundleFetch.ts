import type { ReleaseAsset } from "@effected/github";
import { GitHubRelease, Repo, RepoRef } from "@effected/github";
import type { RegistryTarget } from "@effected/npm";
import { NpmRegistry, PackageTarball, PublishedVersion } from "@effected/npm";
import { Cache } from "@effected/store";
import { AppDirs } from "@effected/xdg";
import { Effect, FileSystem, Option, Path, Schema } from "effect";
import type { Bundle, BundleLayerError } from "./Bundle.js";
import { readBundle } from "./Bundle.js";
import { discoverBundle } from "./BundleDiscovery.js";
import type { BundleManifestError } from "./BundleManifest.js";

/**
 * Raised when a remote bundle cannot be fetched into the local cache.
 *
 * @remarks
 * Fetch-plane failures speak in remote terms (`ref` names the coordinate the
 * caller asked for, never a temp directory). Post-fetch READ failures — a
 * fetched artifact whose layer files are malformed — surface as the same
 * typed errors local reads produce (`BundleLayerError`,
 * `BundleManifestError`), so a consumer handles one vocabulary for both.
 *
 * @public
 */
export class BundleFetchError extends Schema.TaggedError<BundleFetchError>()("BundleFetchError", {
	/** Which fetcher failed. */
	source: Schema.Literals(["npm", "github"]),
	/** What went wrong, structurally. */
	reason: Schema.Literals([
		"invalidRef",
		"versionNotFound",
		"releaseNotFound",
		"assetNotFound",
		"assetAmbiguous",
		"download",
		"notABundle",
		"cache",
	]),
	/** The remote coordinate: `name@version` or `owner/repo@tag#asset`. */
	ref: Schema.String,
	/** Human context for the failure. */
	detail: Schema.optionalKey(Schema.String),
	/** The underlying failure, when one exists, preserved structurally. */
	cause: Schema.optionalKey(Schema.Defect()),
}) {
	override get message(): string {
		const detailPart = this.detail !== undefined ? `: ${this.detail}` : "";
		return `Bundle fetch failed (${this.reason}) for ${this.source} ${this.ref}${detailPart}`;
	}
}

/**
 * Options for {@link fetchNpmBundle}.
 *
 * @public
 */
export interface FetchNpmBundleOptions {
	/** The published package name. */
	readonly name: string;
	/**
	 * An exact version or a dist-tag (e.g. `"latest"`). Ranges are not
	 * resolved by this fetcher — resolve them upstream.
	 */
	readonly version: string;
	/**
	 * The registry to read — any `type: "npm"` (npm-protocol-family) registry,
	 * per the manifest's registries semantics. Defaults to the public npm
	 * registry.
	 */
	readonly target?: RegistryTarget;
	/** Bypass the cache and refetch. */
	readonly refresh?: boolean;
}

/**
 * Options for {@link fetchGitHubReleaseBundle}.
 *
 * @public
 */
export interface FetchGitHubReleaseBundleOptions {
	/** The repository owner. */
	readonly owner: string;
	/** The repository name. */
	readonly repo: string;
	/** The release tag. */
	readonly tag: string;
	/**
	 * The exact asset file name. When omitted, the release must carry exactly
	 * ONE `*.npm.meta.tgz` asset (the bundle release variant) and that asset
	 * is used.
	 */
	readonly asset?: string;
	/**
	 * Bypass the cache and refetch. Unlike npm versions, a git tag CAN move —
	 * the cache treats tags as immutable by default, and this is the escape
	 * hatch when one has.
	 */
	readonly refresh?: boolean;
}

/** The default asset suffix for the GitHub release bundle variant. */
const META_TGZ_SUFFIX = ".npm.meta.tgz";

/** Cache-record schema: which layer files a cached bundle dir holds. */
const CachedBundleRecord = Schema.Struct({
	files: Schema.Array(Schema.String),
});

/**
 * One path segment safe to join into the cache tree: no separators, no
 * traversal, no whitespace. Mirrors the registry's cache-key discipline —
 * lenient about npm's historical malformations, strict enough that a
 * coordinate can never escape its cache directory.
 */
const SAFE_SEGMENT = /^(?!\.{1,2}$)[^/\\\s]+$/;

const utf8Encode = (text: string): Uint8Array => new TextEncoder().encode(text);
const utf8Decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

/** Validate that every cache-path segment is traversal-safe. */
function validateSegments(
	source: "npm" | "github",
	ref: string,
	segments: ReadonlyArray<string>,
): Effect.Effect<void, BundleFetchError> {
	for (const segment of segments) {
		if (!SAFE_SEGMENT.test(segment)) {
			return Effect.fail(
				new BundleFetchError({ source, reason: "invalidRef", ref, detail: `unsafe path segment "${segment}"` }),
			);
		}
	}
	return Effect.void;
}

/** The durable cache directory for one remote bundle coordinate. */
function bundleCacheDir(segments: ReadonlyArray<string>): Effect.Effect<string, never, AppDirs | Path.Path> {
	return Effect.gen(function* () {
		const appDirs = yield* AppDirs;
		const path = yield* Path.Path;
		const cacheRoot = yield* appDirs.ensureCache.pipe(Effect.orDie);
		return path.join(cacheRoot, "bundles", ...segments);
	});
}

/**
 * The cache-hit probe: a metadata record exists AND every file it lists is
 * still on disk. Any inconsistency — missing record, undecodable record,
 * missing file, cache-read failure — reads as a miss, so a damaged cache
 * self-heals by refetching.
 */
function cachedBundle(
	key: string,
	dir: string,
): Effect.Effect<
	Option.Option<Bundle>,
	BundleLayerError | BundleManifestError,
	Cache | FileSystem.FileSystem | Path.Path
> {
	return Effect.gen(function* () {
		const cache = yield* Cache;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const entry = yield* cache.get(key).pipe(Effect.orElseSucceed(() => Option.none()));
		if (Option.isNone(entry)) {
			return Option.none();
		}
		const record = yield* Schema.decodeUnknownEffect(CachedBundleRecord)(
			yield* Effect.try(() => JSON.parse(utf8Decode(entry.value.value)) as unknown).pipe(
				Effect.orElseSucceed(() => null),
			),
		).pipe(Effect.option);
		if (Option.isNone(record)) {
			return Option.none();
		}
		for (const file of record.value.files) {
			const present = yield* fs.exists(path.join(dir, file)).pipe(Effect.orElseSucceed(() => false));
			if (!present) {
				return Option.none();
			}
		}
		const bundle = yield* Effect.flatMap(discoverBundle(dir), readBundle).pipe(Effect.option);
		return bundle;
	});
}

/**
 * Persist a fetched bundle's layer files from the (scoped, about-to-vanish)
 * extraction directory into the durable cache dir, and record them in the
 * metadata cache. The returned Bundle's descriptor points into the CACHE
 * directory, which outlives the extraction scope.
 */
function persistAndRead(
	source: "npm" | "github",
	ref: string,
	key: string,
	extractedDir: string,
	cacheDir: string,
): Effect.Effect<
	Bundle,
	BundleFetchError | BundleLayerError | BundleManifestError,
	Cache | FileSystem.FileSystem | Path.Path
> {
	return Effect.gen(function* () {
		const cache = yield* Cache;
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		const discovered = yield* discoverBundle(extractedDir).pipe(
			Effect.mapError(
				(cause) =>
					new BundleFetchError({
						source,
						reason: "notABundle",
						ref,
						detail: "the fetched artifact does not contain a readable bundle (no *.api.json model)",
						cause,
					}),
			),
		);

		const layerPaths = [
			discovered.modelPath,
			...(discovered.packageJsonPath !== undefined ? [discovered.packageJsonPath] : []),
			...(discovered.tsconfigPath !== undefined ? [discovered.tsconfigPath] : []),
			...(discovered.manifestPath !== undefined ? [discovered.manifestPath] : []),
		];

		const failCache = (cause: unknown): BundleFetchError =>
			new BundleFetchError({ source, reason: "cache", ref, cause });

		// Replace, never merge: stale files from an earlier fetch of the same
		// coordinate must not survive into the new record.
		yield* fs.remove(cacheDir, { recursive: true }).pipe(Effect.ignore);
		yield* fs.makeDirectory(cacheDir, { recursive: true }).pipe(Effect.mapError(failCache));
		const files: Array<string> = [];
		for (const layerPath of layerPaths) {
			const fileName = path.basename(layerPath);
			yield* fs.copyFile(layerPath, path.join(cacheDir, fileName)).pipe(Effect.mapError(failCache));
			files.push(fileName);
		}
		yield* cache
			.set({ key, value: utf8Encode(JSON.stringify({ files })), contentType: "application/json" })
			.pipe(Effect.mapError(failCache));

		return yield* Effect.flatMap(discoverBundle(cacheDir), readBundle).pipe(
			Effect.catchTag("BundleDiscoveryError", (cause) => Effect.fail(failCache(cause))),
		);
	});
}

/**
 * Fetch one published npm package version as a bundle, through the durable
 * XDG cache.
 *
 * @remarks
 * Works against any npm-protocol-family registry via `target` (the
 * `type: "npm"` semantics of the manifest's registries block). The tarball is
 * downloaded, integrity-verified and extracted by `@effected/npm`'s
 * `PackageTarball`, its bundle layer files are copied into
 * `<xdg-cache>/tsdoctor/bundles/npm/<name>/<version>/`, and the returned
 * {@link Bundle}'s descriptor points at that durable directory. A published
 * npm version is immutable, so a cache hit skips the network entirely;
 * `refresh: true` forces a refetch.
 *
 * Provide the `NpmRegistry`, `PackageTarball`, `Cache` and `AppDirs`
 * services (plus `FileSystem`/`Path`) at the application boundary.
 *
 * @public
 */
export function fetchNpmBundle(
	options: FetchNpmBundleOptions,
): Effect.Effect<
	Bundle,
	BundleFetchError | BundleLayerError | BundleManifestError,
	NpmRegistry | PackageTarball | Cache | AppDirs | FileSystem.FileSystem | Path.Path
> {
	const ref = `${options.name}@${options.version}`;
	return Effect.gen(function* () {
		const segments = ["npm", ...options.name.split("/"), options.version];
		yield* validateSegments("npm", ref, segments.slice(1));
		const cacheDir = yield* bundleCacheDir(segments);
		const key = `bundle:v1:npm:${ref}`;

		if (options.refresh !== true) {
			const hit = yield* cachedBundle(key, cacheDir);
			if (Option.isSome(hit)) {
				return hit.value;
			}
		}

		const registry = yield* NpmRegistry;
		const tarball = yield* PackageTarball;

		const published = yield* registry
			.version(options.name, options.version, options.target)
			.pipe(Effect.mapError((cause) => new BundleFetchError({ source: "npm", reason: "download", ref, cause })));
		if (Option.isNone(published)) {
			return yield* Effect.fail(
				new BundleFetchError({
					source: "npm",
					reason: "versionNotFound",
					ref,
					detail:
						"the registry reports no such published version (exact versions and dist-tags only; ranges are not resolved here)",
				}),
			);
		}

		return yield* Effect.gen(function* () {
			const extractedDir = yield* tarball.extract(published.value).pipe(
				Effect.mapError(
					(cause) =>
						new BundleFetchError({
							source: "npm",
							reason: cause.reason === "notFound" ? "versionNotFound" : "download",
							ref,
							cause,
						}),
				),
			);
			return yield* persistAndRead("npm", ref, key, extractedDir, cacheDir);
		}).pipe(Effect.scoped);
	});
}

/**
 * Locate the bundle root inside an extracted release archive. npm-style
 * archives unpack to `package/`; the real `*.npm.meta.tgz` release variant
 * unpacks to `meta/` (verified against vitest-agent's published assets); a
 * hand-rolled archive may put its files at the root. The first candidate
 * containing a `*.api.json` wins: `package/`, the archive root, then each
 * top-level subdirectory.
 */
function locateBundleRoot(
	extractedPackageDir: string,
): Effect.Effect<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;
		const archiveRoot = path.dirname(extractedPackageDir);
		const entries = yield* fs.readDirectory(archiveRoot).pipe(Effect.orElseSucceed(() => [] as Array<string>));
		const candidates = [
			extractedPackageDir,
			archiveRoot,
			...entries
				.filter((entry) => entry !== path.basename(extractedPackageDir))
				.map((entry) => path.join(archiveRoot, entry)),
		];
		for (const candidate of candidates) {
			const names = yield* fs.readDirectory(candidate).pipe(Effect.orElseSucceed(() => [] as Array<string>));
			if (names.some((name) => name.endsWith(".api.json"))) {
				return Option.some(candidate);
			}
		}
		return Option.none();
	});
}

/** Pick the release asset: an exact name, or the single `*.npm.meta.tgz`. */
function pickAsset(
	ref: string,
	assets: ReadonlyArray<ReleaseAsset>,
	wanted: string | undefined,
): Effect.Effect<ReleaseAsset, BundleFetchError> {
	if (wanted !== undefined) {
		const found = assets.find((asset) => asset.name === wanted);
		return found !== undefined
			? Effect.succeed(found)
			: Effect.fail(
					new BundleFetchError({
						source: "github",
						reason: "assetNotFound",
						ref,
						detail: `no asset named "${wanted}" (available: ${assets.map((asset) => asset.name).join(", ") || "none"})`,
					}),
				);
	}
	const candidates = assets.filter((asset) => asset.name.endsWith(META_TGZ_SUFFIX));
	if (candidates.length === 1) {
		return Effect.succeed(candidates[0] as ReleaseAsset);
	}
	if (candidates.length === 0) {
		return Effect.fail(
			new BundleFetchError({
				source: "github",
				reason: "assetNotFound",
				ref,
				detail: `no *${META_TGZ_SUFFIX} asset on the release; pass an explicit asset name`,
			}),
		);
	}
	return Effect.fail(
		new BundleFetchError({
			source: "github",
			reason: "assetAmbiguous",
			ref,
			detail: `multiple *${META_TGZ_SUFFIX} assets (${candidates.map((asset) => asset.name).join(", ")}); pass an explicit asset name`,
		}),
	);
}

/**
 * Fetch a bundle attached to a GitHub release as a `*.npm.meta.tgz`-style
 * asset, through the durable XDG cache.
 *
 * @remarks
 * The release is looked up by tag via `@effected/github`'s `GitHubRelease`
 * (the `Repo` context is provided internally from `owner`/`repo`), the chosen
 * asset is downloaded and extracted through the same verified
 * `PackageTarball` path the npm fetcher uses (no integrity is available for
 * release assets, so the download is unverified — the extractor logs this),
 * and the layer files land in
 * `<xdg-cache>/tsdoctor/bundles/github/<owner>/<repo>/<tag>/<asset>/`.
 *
 * A tarball with an npm-style `package/` root and one with its files at the
 * archive root are both accepted. Git tags CAN move; the cache treats them as
 * immutable and `refresh: true` is the escape hatch. Private-repo assets are
 * not supported yet: the asset's browser download URL is fetched directly,
 * which works for public releases only.
 *
 * @public
 */
export function fetchGitHubReleaseBundle(
	options: FetchGitHubReleaseBundleOptions,
): Effect.Effect<
	Bundle,
	BundleFetchError | BundleLayerError | BundleManifestError,
	GitHubRelease | PackageTarball | Cache | AppDirs | FileSystem.FileSystem | Path.Path
> {
	const ref = `${options.owner}/${options.repo}@${options.tag}${options.asset !== undefined ? `#${options.asset}` : ""}`;
	return Effect.gen(function* () {
		yield* validateSegments("github", ref, [
			options.owner,
			options.repo,
			options.tag,
			...(options.asset !== undefined ? [options.asset] : []),
		]);

		const cacheCoordinate = (assetName: string) => ({
			segments: ["github", options.owner, options.repo, options.tag, assetName],
			key: `bundle:v1:github:${options.owner}/${options.repo}@${options.tag}#${assetName}`,
		});

		// With an explicit asset name the cache slot is known up front, so a hit
		// never touches the GitHub API at all. The default (*.npm.meta.tgz)
		// selection needs the asset listing to know its slot, so it always
		// consults the API once per call.
		if (options.asset !== undefined && options.refresh !== true) {
			const coordinate = cacheCoordinate(options.asset);
			const earlyHit = yield* cachedBundle(coordinate.key, yield* bundleCacheDir(coordinate.segments));
			if (Option.isSome(earlyHit)) {
				return earlyHit.value;
			}
		}

		const releases = yield* GitHubRelease;
		const repoRef = RepoRef.make({ owner: options.owner, repo: options.repo });
		const withRepo = <A, E>(effect: Effect.Effect<A, E, Repo>): Effect.Effect<A, E> =>
			Effect.provideService(effect, Repo, repoRef);

		const failDownload = (cause: unknown): BundleFetchError =>
			new BundleFetchError({ source: "github", reason: "download", ref, cause });

		const release = yield* withRepo(releases.getByTagOption(options.tag)).pipe(Effect.mapError(failDownload));
		if (Option.isNone(release)) {
			return yield* Effect.fail(
				new BundleFetchError({ source: "github", reason: "releaseNotFound", ref, detail: "no release with that tag" }),
			);
		}

		const assets = yield* withRepo(releases.listAssets(release.value.id)).pipe(Effect.mapError(failDownload));
		const asset = yield* pickAsset(ref, assets, options.asset);

		// An unnamed request and its resolved asset share one cache slot, so a
		// later explicit-asset call hits what a default-selection call cached.
		const { segments, key } = cacheCoordinate(asset.name);
		const cacheDir = yield* bundleCacheDir(segments);

		if (options.refresh !== true && options.asset === undefined) {
			const hit = yield* cachedBundle(key, cacheDir);
			if (Option.isSome(hit)) {
				return hit.value;
			}
		}

		const tarball = yield* PackageTarball;
		return yield* Effect.gen(function* () {
			// Reuse the npm tarball pipeline for download + extraction by handing
			// it the asset URL as an integrity-less PublishedVersion.
			const extractedDir = yield* tarball
				.extract(PublishedVersion.make({ name: asset.name, version: options.tag, tarball: asset.url }))
				.pipe(
					Effect.mapError(
						(cause) =>
							new BundleFetchError({
								source: "github",
								reason: cause.reason === "notFound" ? "assetNotFound" : "download",
								ref,
								cause,
							}),
					),
				);
			// PackageTarball answers `<tmp>/package` (the npm layout), but the
			// meta.tgz release variant unpacks to `meta/` — locate the real root.
			const bundleRoot = yield* locateBundleRoot(extractedDir);
			if (Option.isNone(bundleRoot)) {
				return yield* Effect.fail(
					new BundleFetchError({
						source: "github",
						reason: "notABundle",
						ref,
						detail:
							"the release asset contains no *.api.json model at its root, in package/, or in any top-level directory",
					}),
				);
			}
			return yield* persistAndRead("github", ref, key, bundleRoot.value, cacheDir);
		}).pipe(Effect.scoped);
	});
}
