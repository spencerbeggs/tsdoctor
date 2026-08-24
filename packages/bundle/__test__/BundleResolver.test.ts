import { assert, describe, it } from "@effect/vitest";
import { PackageManifest } from "@effected/package-json";
import type { ResolvedTsconfig } from "@effected/tsconfig-json";
import { Effect } from "effect";
import type { BundleManifest } from "../src/index.js";
import { decodeBundleManifest, resolveBundle } from "../src/index.js";

const apiModel = { name: "@modules/kitchensink" };

const leafManifest = (overrides: Record<string, unknown> = {}): Effect.Effect<BundleManifest, unknown> =>
	decodeBundleManifest({ spec: 1, ...overrides });

describe("resolveBundle", () => {
	it.effect("layer 0 alone resolves: name falls through to the api model", () =>
		Effect.gen(function* () {
			const resolved = resolveBundle({ apiModel });
			assert.deepStrictEqual(resolved.name, { value: "@modules/kitchensink", source: "apiModel" });
			assert.strictEqual(resolved.version, undefined);
			assert.strictEqual(resolved.description, undefined);
			assert.strictEqual(resolved.openGraph, undefined);
			return yield* Effect.void;
		}),
	);

	it.effect("each tier wins in rank order for name and description", () =>
		Effect.gen(function* () {
			const packageJson = yield* PackageManifest.decode({
				name: "@modules/kitchensink",
				version: "1.2.3",
				description: "From package.json",
			});
			const manifest = yield* leafManifest({ name: "Kitchen Sink", description: "From the leaf manifest" });

			// packageJson over apiModel.
			const fromPackageJson = resolveBundle({ apiModel, packageJson });
			assert.deepStrictEqual(fromPackageJson.name, { value: "@modules/kitchensink", source: "packageJson" });
			assert.deepStrictEqual(fromPackageJson.description, { value: "From package.json", source: "packageJson" });

			// leaf manifest over packageJson.
			const fromLeaf = resolveBundle({ apiModel, packageJson, manifest });
			assert.deepStrictEqual(fromLeaf.name, { value: "Kitchen Sink", source: "manifest.leaf" });
			assert.deepStrictEqual(fromLeaf.description, { value: "From the leaf manifest", source: "manifest.leaf" });

			// platform over everything.
			const fromPlatform = resolveBundle({
				apiModel,
				packageJson,
				manifest,
				platform: { name: "Platform Name", description: "From platform options" },
			});
			assert.deepStrictEqual(fromPlatform.name, { value: "Platform Name", source: "manifest.platform" });
			assert.deepStrictEqual(fromPlatform.description, {
				value: "From platform options",
				source: "manifest.platform",
			});
		}),
	);

	it.effect("the project tier supplies the tagline when the leaf does not", () =>
		Effect.gen(function* () {
			const manifest = yield* leafManifest({ project: { name: "Effected", tagline: "The kit tagline" } });
			const resolved = resolveBundle({ apiModel, manifest });
			assert.deepStrictEqual(resolved.tagline, { value: "The kit tagline", source: "manifest.project" });
			assert.deepStrictEqual(resolved.project, {
				value: { name: "Effected", tagline: "The kit tagline" },
				source: "manifest.project",
			});
			// The display name deliberately never falls through to the project tier.
			assert.deepStrictEqual(resolved.name, { value: "@modules/kitchensink", source: "apiModel" });

			const withLeafTagline = yield* leafManifest({
				tagline: "Leaf tagline",
				project: { tagline: "The kit tagline" },
			});
			const leafWins = resolveBundle({ apiModel, manifest: withLeafTagline });
			assert.deepStrictEqual(leafWins.tagline, { value: "Leaf tagline", source: "manifest.leaf" });
		}),
	);

	it.effect("version, dependencies and peerDependencies pass through from package.json", () =>
		Effect.gen(function* () {
			const packageJson = yield* PackageManifest.decode({
				name: "@modules/kitchensink",
				version: "1.2.3",
				dependencies: { zebra: "^1.0.0", aardvark: "^2.0.0" },
				peerDependencies: { effect: "^4.0.0" },
			});
			const resolved = resolveBundle({ apiModel, packageJson });
			assert.deepStrictEqual(resolved.version, { value: "1.2.3", source: "packageJson" });
			// Key-sorted for deterministic hashing.
			assert.deepStrictEqual(Object.keys(resolved.dependencies?.value ?? {}), ["aardvark", "zebra"]);
			assert.deepStrictEqual(resolved.peerDependencies, {
				value: { effect: "^4.0.0" },
				source: "packageJson",
			});
		}),
	);

	it.effect("tsconfig compiler options pass through with the tsconfig source", () =>
		Effect.gen(function* () {
			const tsconfig: ResolvedTsconfig = {
				configPath: "/bundles/kitchensink/tsconfig.json",
				extendedPaths: ["/bundles/kitchensink/tsconfig.json"],
				compilerOptions: { strict: true },
			};
			const resolved = resolveBundle({ apiModel, tsconfig });
			assert.deepStrictEqual(resolved.compilerOptions, { value: { strict: true }, source: "tsconfig" });
			return yield* Effect.void;
		}),
	);

	it.effect("sbom and registries resolve platform over leaf", () =>
		Effect.gen(function* () {
			const manifest = yield* leafManifest({
				sbom: { path: "sbom.spdx.json" },
				registries: [{ type: "npm", name: "npm", url: "https://npmjs.com/x" }],
			});
			const leafOnly = resolveBundle({ apiModel, manifest });
			assert.strictEqual(leafOnly.sbom?.source, "manifest.leaf");
			assert.strictEqual(leafOnly.registries?.source, "manifest.leaf");

			const platformWins = resolveBundle({
				apiModel,
				manifest,
				platform: { registries: [{ type: "jsr", name: "jsr", url: "https://jsr.io/x" }] },
			});
			assert.deepStrictEqual(platformWins.registries, {
				value: [{ type: "jsr", name: "jsr", url: "https://jsr.io/x" }],
				source: "manifest.platform",
			});
			// sbom was not overridden, so the leaf still supplies it.
			assert.strictEqual(platformWins.sbom?.source, "manifest.leaf");
		}),
	);

	describe("openGraph inference", () => {
		it.effect("authored alt and type are pinned to the supplying tier", () =>
			Effect.gen(function* () {
				const manifest = yield* leafManifest({
					openGraph: { images: [{ path: "assets/og.png", type: "image/x-custom", alt: "Authored alt" }] },
				});
				const resolved = resolveBundle({ apiModel, manifest });
				const image = resolved.openGraph?.value.images[0];
				assert.deepStrictEqual(image?.alt, { value: "Authored alt", source: "manifest.leaf" });
				assert.deepStrictEqual(image?.type, { value: "image/x-custom", source: "manifest.leaf" });
			}),
		);

		it.effect("alt inference chain: tagline, then description, then the name fallback", () =>
			Effect.gen(function* () {
				const image = { path: "assets/og.png" };

				const withTagline = yield* leafManifest({ tagline: "The tagline", openGraph: { images: [image] } });
				assert.deepStrictEqual(resolveBundle({ apiModel, manifest: withTagline }).openGraph?.value.images[0]?.alt, {
					value: "The tagline",
					source: "inferred",
				});

				const withDescription = yield* leafManifest({
					description: "The description",
					openGraph: { images: [image] },
				});
				assert.deepStrictEqual(resolveBundle({ apiModel, manifest: withDescription }).openGraph?.value.images[0]?.alt, {
					value: "The description",
					source: "inferred",
				});

				const bare = yield* leafManifest({ openGraph: { images: [image] } });
				assert.deepStrictEqual(resolveBundle({ apiModel, manifest: bare }).openGraph?.value.images[0]?.alt, {
					value: "@modules/kitchensink API documentation",
					source: "inferred",
				});
			}),
		);

		it.effect("a resolved tagline from a HIGHER tier feeds the inferred alt", () =>
			Effect.gen(function* () {
				const manifest = yield* leafManifest({
					tagline: "Leaf tagline",
					openGraph: { images: [{ path: "assets/og.png" }] },
				});
				const resolved = resolveBundle({ apiModel, manifest, platform: { tagline: "Platform tagline" } });
				assert.deepStrictEqual(resolved.openGraph?.value.images[0]?.alt, {
					value: "Platform tagline",
					source: "inferred",
				});
			}),
		);

		it.effect("MIME type is inferred from the extension for path and url images", () =>
			Effect.gen(function* () {
				const manifest = yield* leafManifest({
					openGraph: {
						images: [
							{ path: "assets/og.png" },
							{ url: "https://cdn.example/card.jpg?v=2" },
							{ path: "assets/strange.xyz" },
						],
					},
				});
				const images = resolveBundle({ apiModel, manifest }).openGraph?.value.images ?? [];
				assert.deepStrictEqual(images[0]?.type, { value: "image/png", source: "inferred" });
				assert.deepStrictEqual(images[1]?.type, { value: "image/jpeg", source: "inferred" });
				assert.strictEqual(images[2]?.type, undefined);
			}),
		);
	});
});
