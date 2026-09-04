import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Path } from "effect";
import type { ResolvedOpenGraphImage } from "../src/index.js";
import { BundleAssetError, publishBundleAssets } from "../src/index.js";

/** A minimal valid 1×1 transparent PNG, used to exercise measurement from bytes. */
const onePixelPng = Uint8Array.from(
	Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64"),
);

const testLayer = (seed: MemoryFileSystemSeed) => Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);

/** Counts `writeFile` calls against the real FileSystem, so a no-op rebuild can be asserted directly. */
const countingWrites = (seed: MemoryFileSystemSeed, counter: { writes: number }) =>
	Layer.effect(
		FileSystem.FileSystem,
		Effect.gen(function* () {
			const base = yield* FileSystem.FileSystem;
			return {
				...base,
				writeFile: (...args: Parameters<typeof base.writeFile>) =>
					Effect.suspend(() => {
						counter.writes += 1;
						return base.writeFile(...args);
					}),
			} satisfies FileSystem.FileSystem;
		}),
	).pipe(Layer.provideMerge(Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer)));

const pathImage = (overrides: Partial<ResolvedOpenGraphImage> = {}): ResolvedOpenGraphImage => ({
	path: "og/kitchensink.png",
	alt: { value: "Kitchen Sink API documentation", source: "inferred" },
	...overrides,
});

const urlImage = (overrides: Partial<ResolvedOpenGraphImage> = {}): ResolvedOpenGraphImage => ({
	url: "https://cdn.example.com/kitchensink.png",
	alt: { value: "Kitchen Sink API documentation", source: "inferred" },
	...overrides,
});

describe("publishBundleAssets", () => {
	it.effect("copies a path image and returns it as an absolute URL, measuring dimensions from bytes", () =>
		Effect.gen(function* () {
			const [published] = yield* publishBundleAssets({
				bundleDir: "/bundles/kitchensink",
				images: [pathImage({ type: { value: "image/png", source: "inferred" } })],
				publicDir: "/site/public",
				siteUrl: "https://example.com",
				unscopedName: "kitchensink",
			});
			assert.isDefined(published);
			assert.strictEqual(published?.url, "https://example.com/tsdoctor/kitchensink/kitchensink.png");
			assert.strictEqual(published?.type, "image/png");
			assert.strictEqual(published?.width, 1);
			assert.strictEqual(published?.height, 1);
			assert.strictEqual(published?.alt, "Kitchen Sink API documentation");

			const fs = yield* FileSystem.FileSystem;
			const bytes = yield* fs.readFile("/site/public/tsdoctor/kitchensink/kitchensink.png");
			assert.strictEqual(bytes.byteLength, onePixelPng.byteLength);
		}).pipe(
			Effect.provide(
				testLayer({
					"/bundles/kitchensink/og/kitchensink.png": onePixelPng,
				}),
			),
		),
	);

	it.effect("uses the resolved width/height when the manifest already declares them", () =>
		Effect.gen(function* () {
			const [published] = yield* publishBundleAssets({
				bundleDir: "/bundles/kitchensink",
				images: [pathImage({ width: 1200, height: 630 })],
				publicDir: "/site/public",
				siteUrl: "https://example.com",
				unscopedName: "kitchensink",
			});
			assert.strictEqual(published?.width, 1200);
			assert.strictEqual(published?.height, 630);
		}).pipe(
			Effect.provide(
				testLayer({
					"/bundles/kitchensink/og/kitchensink.png": onePixelPng,
				}),
			),
		),
	);

	it.effect("never lets a measured dimension override a declared one, even when only one is declared", () =>
		Effect.gen(function* () {
			const [published] = yield* publishBundleAssets({
				bundleDir: "/bundles/kitchensink",
				images: [pathImage({ width: 1200 })],
				publicDir: "/site/public",
				siteUrl: "https://example.com",
				unscopedName: "kitchensink",
			});
			assert.strictEqual(published?.width, 1200);
			assert.strictEqual(published?.height, 1);
		}).pipe(
			Effect.provide(
				testLayer({
					"/bundles/kitchensink/og/kitchensink.png": onePixelPng,
				}),
			),
		),
	);

	it.effect("passes an external url image through unchanged", () =>
		Effect.gen(function* () {
			const [published] = yield* publishBundleAssets({
				bundleDir: "/bundles/kitchensink",
				images: [urlImage({ type: { value: "image/png", source: "inferred" }, width: 100, height: 100 })],
				publicDir: "/site/public",
				siteUrl: "https://example.com",
				unscopedName: "kitchensink",
			});
			assert.deepStrictEqual(published, {
				url: "https://cdn.example.com/kitchensink.png",
				type: "image/png",
				width: 100,
				height: 100,
				alt: "Kitchen Sink API documentation",
			});
		}).pipe(Effect.provide(testLayer({}))),
	);

	it.effect("does not rewrite a destination file whose bytes are unchanged", () => {
		const counter = { writes: 0 };
		const input = {
			bundleDir: "/bundles/kitchensink",
			images: [pathImage()],
			publicDir: "/site/public",
			siteUrl: "https://example.com",
			unscopedName: "kitchensink",
		};
		return Effect.gen(function* () {
			yield* publishBundleAssets(input);
			const firstWrites = counter.writes;
			yield* publishBundleAssets(input);
			assert.strictEqual(counter.writes, firstWrites);

			const fs = yield* FileSystem.FileSystem;
			const bytes = yield* fs.readFile("/site/public/tsdoctor/kitchensink/kitchensink.png");
			assert.strictEqual(bytes.byteLength, onePixelPng.byteLength);
		}).pipe(Effect.provide(countingWrites({ "/bundles/kitchensink/og/kitchensink.png": onePixelPng }, counter)));
	});

	it.effect("fails typed when the bundle-relative path does not exist", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				publishBundleAssets({
					bundleDir: "/bundles/kitchensink",
					images: [pathImage()],
					publicDir: "/site/public",
					siteUrl: "https://example.com",
					unscopedName: "kitchensink",
				}),
			);
			assert.instanceOf(error, BundleAssetError);
			assert.strictEqual(error.path, "/bundles/kitchensink/og/kitchensink.png");
		}).pipe(Effect.provide(testLayer({}))),
	);

	it.effect("yields a root-relative url when siteUrl is empty", () =>
		Effect.gen(function* () {
			const [published] = yield* publishBundleAssets({
				bundleDir: "/bundles/kitchensink",
				images: [pathImage()],
				publicDir: "/site/public",
				siteUrl: "",
				unscopedName: "kitchensink",
			});
			assert.strictEqual(published?.url, "/tsdoctor/kitchensink/kitchensink.png");
		}).pipe(
			Effect.provide(
				testLayer({
					"/bundles/kitchensink/og/kitchensink.png": onePixelPng,
				}),
			),
		),
	);

	it.effect("rejects a manifest image path that escapes the bundle directory", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				publishBundleAssets({
					bundleDir: "/bundles/kitchensink",
					images: [pathImage({ path: "../evil.png" })],
					publicDir: "/site/public",
					siteUrl: "https://example.com",
					unscopedName: "kitchensink",
				}),
			);
			assert.instanceOf(error, BundleAssetError);

			const fs = yield* FileSystem.FileSystem;
			const wrote = yield* fs.exists("/site/public/tsdoctor/kitchensink/evil.png");
			assert.isFalse(wrote);
		}).pipe(
			Effect.provide(
				testLayer({
					"/bundles/kitchensink/evil.png": onePixelPng,
					"/evil.png": onePixelPng,
				}),
			),
		),
	);

	it.effect("rejects a manifest image path that is absolute", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(
				publishBundleAssets({
					bundleDir: "/bundles/kitchensink",
					images: [pathImage({ path: "/abs.png" })],
					publicDir: "/site/public",
					siteUrl: "https://example.com",
					unscopedName: "kitchensink",
				}),
			);
			assert.instanceOf(error, BundleAssetError);

			const fs = yield* FileSystem.FileSystem;
			const wrote = yield* fs.exists("/site/public/tsdoctor/kitchensink/abs.png");
			assert.isFalse(wrote);
		}).pipe(
			Effect.provide(
				testLayer({
					"/abs.png": onePixelPng,
				}),
			),
		),
	);

	it.effect("namespaces the published route under an optional subdir", () =>
		Effect.gen(function* () {
			const [published] = yield* publishBundleAssets({
				bundleDir: "/bundles/kitchensink",
				images: [pathImage()],
				publicDir: "/site/public",
				siteUrl: "https://example.com",
				unscopedName: "kitchensink",
				subdir: "v2",
			});
			assert.strictEqual(published?.url, "https://example.com/tsdoctor/kitchensink/v2/kitchensink.png");

			const fs = yield* FileSystem.FileSystem;
			const bytes = yield* fs.readFile("/site/public/tsdoctor/kitchensink/v2/kitchensink.png");
			assert.strictEqual(bytes.byteLength, onePixelPng.byteLength);
		}).pipe(
			Effect.provide(
				testLayer({
					"/bundles/kitchensink/og/kitchensink.png": onePixelPng,
				}),
			),
		),
	);

	it.effect("carries the resolved image's alt text", () =>
		Effect.gen(function* () {
			const [published] = yield* publishBundleAssets({
				bundleDir: "/bundles/kitchensink",
				images: [pathImage({ alt: { value: "A custom alt", source: "manifest.leaf" } })],
				publicDir: "/site/public",
				siteUrl: "https://example.com",
				unscopedName: "kitchensink",
			});
			assert.strictEqual(published?.alt, "A custom alt");
		}).pipe(
			Effect.provide(
				testLayer({
					"/bundles/kitchensink/og/kitchensink.png": onePixelPng,
				}),
			),
		),
	);
});
