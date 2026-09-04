import { assert, describe, it } from "@effect/vitest";
import type { GitHubReleaseShape } from "@effected/github";
import { GitHubRelease, ReleaseAsset, ReleaseInfo } from "@effected/github";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import type { NpmRegistryShape } from "@effected/npm";
import { NpmRegistry, PackageTarball, PublishedVersion } from "@effected/npm";
import { Cache } from "@effected/store";
import { AppDirs, Xdg } from "@effected/xdg";
import { Effect, FileSystem, Layer, Option, Path } from "effect";
import {
	fetchGitHubReleaseBundle,
	fetchNpmBundle,
	loadBundle,
	publishBundleAssets,
	resolveBundleFrom,
} from "../src/index.js";

/** A minimal valid 1×1 transparent PNG, mirroring bundle-assets.test.ts. */
const onePixelPng = Uint8Array.from(
	Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
);

const apiModelText = (name: string) =>
	JSON.stringify({
		metadata: { toolPackage: "@microsoft/api-extractor", toolVersion: "7.59.0", schemaVersion: 1011 },
		kind: "Package",
		name,
		members: [],
	});

/** An "extracted tarball" tree with the npm-style `package/` root. */
const extractedNpmSeed: MemoryFileSystemSeed = {
	"/extracted/package/sidecar.api.json": apiModelText("@vitest-agent/sidecar"),
	"/extracted/package/package.json": JSON.stringify({
		name: "@vitest-agent/sidecar",
		version: "2.1.9",
		description: "Fixture",
	}),
	"/extracted/package/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
	"/extracted/package/tsdoctor.json": JSON.stringify({ spec: 1, name: "Sidecar" }),
};

/** The base environment: memfs, Path, in-memory Cache, AppDirs pinned into memfs. */
const baseLayer = (seed: MemoryFileSystemSeed) => {
	const fsLayer = MemoryFileSystem.layerWith(seed);
	const platform = Layer.mergeAll(fsLayer, Path.layer);
	return Layer.mergeAll(
		platform,
		Cache.layerTest(),
		AppDirs.layer({
			namespace: "tsdoctor-test",
			dirs: {
				cache: "/xdg/cache",
				config: "/xdg/config",
				data: "/xdg/data",
				state: "/xdg/state",
			},
		}).pipe(Layer.provide(Layer.mergeAll(Xdg.layer, platform))),
	);
};

/** A PackageTarball double answering a fixed extraction directory. */
const tarballLayer = (dir: string, calls?: { count: number }) =>
	Layer.succeed(PackageTarball, {
		extract: () =>
			Effect.sync(() => {
				if (calls !== undefined) {
					calls.count += 1;
				}
				return dir;
			}),
	});

/** An NpmRegistry double serving one published version. */
const registryLayer = (overrides: Partial<NpmRegistryShape>) =>
	Layer.succeed(NpmRegistry, NpmRegistry.makeTest(overrides));

const publishedSidecar = PublishedVersion.make({
	name: "@vitest-agent/sidecar",
	version: "2.1.9",
	tarball: "https://registry.example/sidecar-2.1.9.tgz",
});

describe("fetchNpmBundle", () => {
	it.effect("fetches, caches and reads a bundle from a registry tarball", () =>
		Effect.gen(function* () {
			const bundle = yield* fetchNpmBundle({ name: "@vitest-agent/sidecar", version: "2.1.9" });
			// The descriptor points into the DURABLE cache dir, not the temp extraction.
			assert.strictEqual(bundle.descriptor.dir, "/xdg/cache/bundles/npm/@vitest-agent/sidecar/2.1.9");
			assert.strictEqual(bundle.apiModel.name, "@vitest-agent/sidecar");
			assert.isTrue(Option.isSome(bundle.manifest));
			const resolved = resolveBundleFrom(bundle);
			assert.deepStrictEqual(resolved.name, { value: "Sidecar", source: "manifest.leaf" });
			assert.deepStrictEqual(resolved.version, { value: "2.1.9", source: "packageJson" });
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					baseLayer(extractedNpmSeed),
					tarballLayer("/extracted/package"),
					registryLayer({ version: () => Effect.succeed(Option.some(publishedSidecar)) }),
				),
			),
		),
	);

	it.effect("a second fetch is a cache hit; refresh forces a refetch", () =>
		Effect.gen(function* () {
			const registryCalls = { count: 0 };
			const tarballCalls = { count: 0 };
			const env = Layer.mergeAll(
				baseLayer(extractedNpmSeed),
				tarballLayer("/extracted/package", tarballCalls),
				registryLayer({
					version: () =>
						Effect.sync(() => {
							registryCalls.count += 1;
							return Option.some(publishedSidecar);
						}),
				}),
			);
			const program = Effect.gen(function* () {
				yield* fetchNpmBundle({ name: "@vitest-agent/sidecar", version: "2.1.9" });
				yield* fetchNpmBundle({ name: "@vitest-agent/sidecar", version: "2.1.9" });
				assert.strictEqual(registryCalls.count, 1, "second fetch must not touch the registry");
				assert.strictEqual(tarballCalls.count, 1, "second fetch must not re-download");
				yield* fetchNpmBundle({ name: "@vitest-agent/sidecar", version: "2.1.9", refresh: true });
				assert.strictEqual(registryCalls.count, 2, "refresh must bypass the cache");
			});
			return yield* program.pipe(Effect.provide(env));
		}),
	);

	it.effect("an unpublished version fails typed as versionNotFound", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(fetchNpmBundle({ name: "ghost", version: "9.9.9" }));
			assert.strictEqual(error._tag, "BundleFetchError");
			assert.isTrue(error._tag === "BundleFetchError" && error.reason === "versionNotFound");
			assert.isTrue(error._tag === "BundleFetchError" && error.ref === "ghost@9.9.9");
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					baseLayer({}),
					tarballLayer("/nowhere"),
					registryLayer({ version: () => Effect.succeed(Option.none()) }),
				),
			),
		),
	);

	it.effect("a tarball without a *.api.json fails typed as notABundle", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(fetchNpmBundle({ name: "plain-pkg", version: "1.0.0" }));
			assert.isTrue(error._tag === "BundleFetchError" && error.reason === "notABundle");
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					baseLayer({
						"/extracted/package/package.json": JSON.stringify({ name: "plain-pkg", version: "1.0.0" }),
						"/extracted/package/index.js": "export {}",
					}),
					tarballLayer("/extracted/package"),
					registryLayer({
						version: () =>
							Effect.succeed(
								Option.some(PublishedVersion.make({ name: "plain-pkg", version: "1.0.0", tarball: "https://x/t.tgz" })),
							),
					}),
				),
			),
		),
	);

	it.effect("a traversal-shaped coordinate fails typed as invalidRef", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(fetchNpmBundle({ name: "..", version: "1.0.0" }));
			assert.isTrue(error._tag === "BundleFetchError" && error.reason === "invalidRef");
		}).pipe(Effect.provide(Layer.mergeAll(baseLayer({}), tarballLayer("/x"), registryLayer({})))),
	);
});

const release = ReleaseInfo.make({
	id: 42,
	tag: "@vitest-agent/sidecar@2.1.9",
	name: "sidecar 2.1.9",
	body: "",
	draft: false,
	prerelease: false,
	url: "https://github.com/spencerbeggs/vitest-agent/releases/tag/x",
	uploadUrl: "",
});

const metaAsset = ReleaseAsset.make({
	id: 7,
	name: "vitest-agent-sidecar-2.1.9.npm.meta.tgz",
	url: "https://github.com/spencerbeggs/vitest-agent/releases/download/x/vitest-agent-sidecar-2.1.9.npm.meta.tgz",
	size: 2917,
});

const githubLayer = (overrides: Partial<GitHubReleaseShape>) => GitHubRelease.layerTest(overrides);

/** The real meta.tgz layout: layer files under a `meta/` archive root. */
const extractedMetaSeed: MemoryFileSystemSeed = {
	// PackageTarball reports `<tmp>/package`; the real archive root is `meta/`.
	"/gh-extracted/package.tgz": "raw bytes stand-in",
	"/gh-extracted/meta/sidecar.api.json": apiModelText("@vitest-agent/sidecar"),
	"/gh-extracted/meta/package.json": JSON.stringify({ name: "@vitest-agent/sidecar", version: "2.1.9" }),
	"/gh-extracted/meta/tsconfig.json": JSON.stringify({ compilerOptions: {} }),
};

describe("fetchGitHubReleaseBundle", () => {
	// The tag is not cache-path-safe verbatim; use a simple tag in tests.
	const options = { owner: "spencerbeggs", repo: "vitest-agent", tag: "v2.1.9" };

	it.effect("fetches the single *.npm.meta.tgz asset and locates its meta/ root", () =>
		Effect.gen(function* () {
			const bundle = yield* fetchGitHubReleaseBundle(options);
			assert.strictEqual(
				bundle.descriptor.dir,
				"/xdg/cache/bundles/github/spencerbeggs/vitest-agent/v2.1.9/vitest-agent-sidecar-2.1.9.npm.meta.tgz",
			);
			assert.strictEqual(bundle.apiModel.name, "@vitest-agent/sidecar");
			assert.strictEqual(bundle.descriptor.version, "2.1.9");
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					baseLayer(extractedMetaSeed),
					tarballLayer("/gh-extracted/package"),
					githubLayer({
						getByTagOption: () => Effect.succeed(Option.some(release)),
						listAssets: () => Effect.succeed([metaAsset]),
					}),
				),
			),
		),
	);

	it.effect("a second fetch hits the cache without listing assets again", () =>
		Effect.gen(function* () {
			const listCalls = { count: 0 };
			const env = Layer.mergeAll(
				baseLayer(extractedMetaSeed),
				tarballLayer("/gh-extracted/package"),
				githubLayer({
					getByTagOption: () => Effect.succeed(Option.some(release)),
					listAssets: () =>
						Effect.sync(() => {
							listCalls.count += 1;
							return [metaAsset];
						}),
				}),
			);
			return yield* Effect.gen(function* () {
				// An explicit asset name makes the cache key known before the API is
				// consulted, so the hit path skips GitHub entirely.
				yield* fetchGitHubReleaseBundle({ ...options, asset: metaAsset.name });
				yield* fetchGitHubReleaseBundle({ ...options, asset: metaAsset.name });
				assert.strictEqual(listCalls.count, 1);
			}).pipe(Effect.provide(env));
		}),
	);

	it.effect("failure reasons: releaseNotFound, assetNotFound, assetAmbiguous", () =>
		Effect.gen(function* () {
			const missingRelease = yield* Effect.flip(
				fetchGitHubReleaseBundle(options).pipe(
					Effect.provide(
						Layer.mergeAll(
							baseLayer({}),
							tarballLayer("/x"),
							githubLayer({ getByTagOption: () => Effect.succeed(Option.none()) }),
						),
					),
				),
			);
			assert.isTrue(missingRelease._tag === "BundleFetchError" && missingRelease.reason === "releaseNotFound");

			const noAsset = yield* Effect.flip(
				fetchGitHubReleaseBundle(options).pipe(
					Effect.provide(
						Layer.mergeAll(
							baseLayer({}),
							tarballLayer("/x"),
							githubLayer({
								getByTagOption: () => Effect.succeed(Option.some(release)),
								listAssets: () => Effect.succeed([]),
							}),
						),
					),
				),
			);
			assert.isTrue(noAsset._tag === "BundleFetchError" && noAsset.reason === "assetNotFound");

			const second = ReleaseAsset.make({ ...metaAsset, id: 8, name: "other-2.1.9.npm.meta.tgz" });
			const ambiguous = yield* Effect.flip(
				fetchGitHubReleaseBundle(options).pipe(
					Effect.provide(
						Layer.mergeAll(
							baseLayer({}),
							tarballLayer("/x"),
							githubLayer({
								getByTagOption: () => Effect.succeed(Option.some(release)),
								listAssets: () => Effect.succeed([metaAsset, second]),
							}),
						),
					),
				),
			);
			assert.isTrue(ambiguous._tag === "BundleFetchError" && ambiguous.reason === "assetAmbiguous");
		}),
	);
});

const ogAsset = ReleaseAsset.make({
	id: 9,
	name: "vitest-agent-sidecar-og-2.1.9.npm.meta.tgz",
	url: "https://github.com/spencerbeggs/vitest-agent/releases/download/y/vitest-agent-sidecar-og-2.1.9.npm.meta.tgz",
	size: 3102,
});

/** A meta.tgz layout whose manifest declares an Open Graph image asset present in the archive. */
const extractedMetaSeedWithImage: MemoryFileSystemSeed = {
	"/gh-og-extracted/package.tgz": "raw bytes stand-in",
	"/gh-og-extracted/meta/kitchensink.api.json": apiModelText("@vitest-agent/kitchensink"),
	"/gh-og-extracted/meta/package.json": JSON.stringify({ name: "@vitest-agent/kitchensink", version: "1.0.0" }),
	"/gh-og-extracted/meta/tsconfig.json": JSON.stringify({ compilerOptions: {} }),
	"/gh-og-extracted/meta/tsdoctor.json": JSON.stringify({
		spec: 1,
		name: "Kitchen Sink",
		openGraph: { images: [{ path: "og/k.png" }] },
	}),
	"/gh-og-extracted/meta/og/k.png": onePixelPng,
};

/** The same layout, but the manifest declares an image path that escapes the bundle. */
const extractedMetaSeedTraversalImage: MemoryFileSystemSeed = {
	"/gh-og-traversal/package.tgz": "raw bytes stand-in",
	"/gh-og-traversal/meta/kitchensink.api.json": apiModelText("@vitest-agent/kitchensink"),
	"/gh-og-traversal/meta/package.json": JSON.stringify({ name: "@vitest-agent/kitchensink", version: "1.0.0" }),
	"/gh-og-traversal/meta/tsconfig.json": JSON.stringify({ compilerOptions: {} }),
	"/gh-og-traversal/meta/tsdoctor.json": JSON.stringify({
		spec: 1,
		name: "Kitchen Sink",
		openGraph: { images: [{ path: "../evil.png" }] },
	}),
	"/gh-og-traversal/evil.png": onePixelPng,
};

/** The same layout, but the manifest declares an asset the archive never packed. */
const extractedMetaSeedMissingImage: MemoryFileSystemSeed = {
	"/gh-missing-extracted/package.tgz": "raw bytes stand-in",
	"/gh-missing-extracted/meta/kitchensink.api.json": apiModelText("@vitest-agent/kitchensink"),
	"/gh-missing-extracted/meta/package.json": JSON.stringify({ name: "@vitest-agent/kitchensink", version: "1.0.0" }),
	"/gh-missing-extracted/meta/tsconfig.json": JSON.stringify({ compilerOptions: {} }),
	"/gh-missing-extracted/meta/tsdoctor.json": JSON.stringify({
		spec: 1,
		name: "Kitchen Sink",
		openGraph: { images: [{ path: "og/missing.png" }] },
	}),
};

describe("fetchGitHubReleaseBundle openGraph assets", () => {
	const options = { owner: "spencerbeggs", repo: "vitest-agent", tag: "og-v1.0.0", asset: ogAsset.name };

	it.effect("persists the manifest's declared image alongside the layer files", () =>
		Effect.gen(function* () {
			const bundle = yield* fetchGitHubReleaseBundle(options);
			const cacheDir = bundle.descriptor.dir;

			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			assert.isTrue(yield* fs.exists(path.join(cacheDir, "tsdoctor.json")));
			assert.isTrue(yield* fs.exists(path.join(cacheDir, "og", "k.png")));

			const loaded = yield* loadBundle(cacheDir);
			assert.isTrue(Option.isSome(loaded.manifest));
			const images = Option.isSome(loaded.manifest) ? (loaded.manifest.value.openGraph?.images ?? []) : [];
			assert.strictEqual(images[0]?.path, "og/k.png");

			const resolved = resolveBundleFrom(bundle);
			assert.isDefined(resolved.openGraph);
			const [published] = yield* publishBundleAssets({
				bundleDir: cacheDir,
				images: resolved.openGraph?.value.images ?? [],
				publicDir: "/site/public",
				siteUrl: "https://example.com",
				unscopedName: "kitchensink",
			});
			assert.strictEqual(published?.url, "https://example.com/tsdoctor/kitchensink/k.png");
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					baseLayer(extractedMetaSeedWithImage),
					tarballLayer("/gh-og-extracted/package"),
					githubLayer({
						getByTagOption: () => Effect.succeed(Option.some(release)),
						listAssets: () => Effect.succeed([ogAsset]),
					}),
				),
			),
		),
	);

	it.effect("a manifest-declared image missing from the archive fails typed missingAsset", () =>
		Effect.gen(function* () {
			const missingOptions = { ...options, tag: "og-v1.0.0-missing" };
			const error = yield* Effect.flip(fetchGitHubReleaseBundle(missingOptions));
			assert.strictEqual(error._tag, "BundleFetchError");
			assert.isTrue(error._tag === "BundleFetchError" && error.reason === "missingAsset");
			assert.isTrue(error._tag === "BundleFetchError" && error.detail?.includes("og/missing.png"));
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					baseLayer(extractedMetaSeedMissingImage),
					tarballLayer("/gh-missing-extracted/package"),
					githubLayer({
						getByTagOption: () => Effect.succeed(Option.some(release)),
						listAssets: () => Effect.succeed([ogAsset]),
					}),
				),
			),
		),
	);

	it.effect("a manifest-declared image path that escapes the bundle fails typed invalidRef", () =>
		Effect.gen(function* () {
			const traversalOptions = { ...options, tag: "og-v1.0.0-traversal" };
			const error = yield* Effect.flip(fetchGitHubReleaseBundle(traversalOptions));
			assert.strictEqual(error._tag, "BundleFetchError");
			assert.isTrue(error._tag === "BundleFetchError" && error.reason === "invalidRef");
			assert.isTrue(error._tag === "BundleFetchError" && error.detail?.includes("../evil.png"));
		}).pipe(
			Effect.provide(
				Layer.mergeAll(
					baseLayer(extractedMetaSeedTraversalImage),
					tarballLayer("/gh-og-traversal/package"),
					githubLayer({
						getByTagOption: () => Effect.succeed(Option.some(release)),
						listAssets: () => Effect.succeed([ogAsset]),
					}),
				),
			),
		),
	);

	it.effect("a second fetch is a cache hit that also verifies the image; a deleted image forces a refetch", () =>
		Effect.gen(function* () {
			const listCalls = { count: 0 };
			const env = Layer.mergeAll(
				baseLayer(extractedMetaSeedWithImage),
				tarballLayer("/gh-og-extracted/package"),
				githubLayer({
					getByTagOption: () => Effect.succeed(Option.some(release)),
					listAssets: () =>
						Effect.sync(() => {
							listCalls.count += 1;
							return [ogAsset];
						}),
				}),
			);
			return yield* Effect.gen(function* () {
				const first = yield* fetchGitHubReleaseBundle(options);
				yield* fetchGitHubReleaseBundle(options);
				assert.strictEqual(listCalls.count, 1, "second fetch must not touch the release API");

				const fs = yield* FileSystem.FileSystem;
				const path = yield* Path.Path;
				yield* fs.remove(path.join(first.descriptor.dir, "og", "k.png"));

				yield* fetchGitHubReleaseBundle(options);
				assert.strictEqual(listCalls.count, 2, "a missing cached image must force a refetch, not a false hit");
				assert.isTrue(yield* fs.exists(path.join(first.descriptor.dir, "og", "k.png")));
			}).pipe(Effect.provide(env));
		}),
	);
});
