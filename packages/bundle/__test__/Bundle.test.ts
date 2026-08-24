import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Option, Path } from "effect";
import type { BundleDescriptor } from "../src/index.js";
import { readApiModelInfo, readBundle } from "../src/index.js";

const apiModelText = JSON.stringify({
	metadata: { toolPackage: "@microsoft/api-extractor", toolVersion: "7.59.0", schemaVersion: 1011 },
	kind: "Package",
	name: "@modules/kitchensink",
	members: [],
});

const testLayer = (seed: MemoryFileSystemSeed) => Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);

const fullDescriptor: BundleDescriptor = {
	dir: "/bundles/kitchensink",
	dirname: "kitchensink",
	name: "@modules/kitchensink",
	version: "0.1.0",
	modelPath: "/bundles/kitchensink/kitchensink.api.json",
	packageJsonPath: "/bundles/kitchensink/package.json",
	tsconfigPath: "/bundles/kitchensink/tsconfig.json",
	manifestPath: "/bundles/kitchensink/tsdoctor.json",
};

describe("readApiModelInfo", () => {
	it.effect("reads the package name from the model header", () =>
		Effect.gen(function* () {
			const info = yield* readApiModelInfo("/m/pkg.api.json");
			assert.strictEqual(info.name, "@modules/kitchensink");
		}).pipe(Effect.provide(testLayer({ "/m/pkg.api.json": apiModelText }))),
	);

	it.effect("a malformed model fails typed as the apiModel layer", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(readApiModelInfo("/m/pkg.api.json"));
			assert.strictEqual(error._tag, "BundleLayerError");
			assert.strictEqual(error.layer, "apiModel");
			assert.strictEqual(error.path, "/m/pkg.api.json");
		}).pipe(Effect.provide(testLayer({ "/m/pkg.api.json": "not json" }))),
	);
});

describe("readBundle", () => {
	it.effect("reads all four layers into typed structures", () =>
		Effect.gen(function* () {
			const bundle = yield* readBundle(fullDescriptor);
			assert.strictEqual(bundle.apiModel.name, "@modules/kitchensink");
			assert.isTrue(Option.isSome(bundle.packageJson));
			assert.strictEqual(
				Option.isSome(bundle.packageJson) ? String(bundle.packageJson.value.version) : undefined,
				"0.1.0",
			);
			assert.isTrue(Option.isSome(bundle.tsconfig));
			assert.strictEqual(
				Option.isSome(bundle.tsconfig) ? bundle.tsconfig.value.compilerOptions.strict : undefined,
				true,
			);
			assert.isTrue(Option.isSome(bundle.manifest));
			assert.strictEqual(Option.isSome(bundle.manifest) ? bundle.manifest.value.name : undefined, "Kitchen Sink");
		}).pipe(
			Effect.provide(
				testLayer({
					"/bundles/kitchensink/kitchensink.api.json": apiModelText,
					"/bundles/kitchensink/package.json": JSON.stringify({
						name: "@modules/kitchensink",
						version: "0.1.0",
						description: "Fixture",
						dependencies: { zod: "^3.0.0" },
					}),
					"/bundles/kitchensink/tsconfig.json": JSON.stringify({ compilerOptions: { strict: true } }),
					"/bundles/kitchensink/tsdoctor.json": JSON.stringify({ spec: 1, name: "Kitchen Sink" }),
				}),
			),
		),
	);

	it.effect("absent optional layers read as none — enrich, never gate", () =>
		Effect.gen(function* () {
			const bundle = yield* readBundle({
				dir: "/bundles/bare",
				dirname: "bare",
				name: "@modules/kitchensink",
				modelPath: "/bundles/bare/bare.api.json",
			});
			assert.isTrue(Option.isNone(bundle.packageJson));
			assert.isTrue(Option.isNone(bundle.tsconfig));
			assert.isTrue(Option.isNone(bundle.manifest));
		}).pipe(Effect.provide(testLayer({ "/bundles/bare/bare.api.json": apiModelText }))),
	);

	it.effect("a present-but-invalid package.json fails typed as the packageJson layer", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(readBundle(fullDescriptor));
			assert.strictEqual(error._tag, "BundleLayerError");
			assert.isTrue(error._tag === "BundleLayerError" && error.layer === "packageJson");
		}).pipe(
			Effect.provide(
				testLayer({
					"/bundles/kitchensink/kitchensink.api.json": apiModelText,
					// Parses as JSON but violates the manifest schema (bad semver).
					"/bundles/kitchensink/package.json": JSON.stringify({ name: "x", version: "not-semver" }),
					"/bundles/kitchensink/tsconfig.json": JSON.stringify({ compilerOptions: {} }),
					"/bundles/kitchensink/tsdoctor.json": JSON.stringify({ spec: 1 }),
				}),
			),
		),
	);

	it.effect("a present-but-invalid tsdoctor.json fails typed as a manifest error", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(readBundle(fullDescriptor));
			assert.strictEqual(error._tag, "BundleManifestError");
			assert.isTrue(error._tag === "BundleManifestError" && error.path === "/bundles/kitchensink/tsdoctor.json");
		}).pipe(
			Effect.provide(
				testLayer({
					"/bundles/kitchensink/kitchensink.api.json": apiModelText,
					"/bundles/kitchensink/package.json": JSON.stringify({ name: "@modules/kitchensink", version: "0.1.0" }),
					"/bundles/kitchensink/tsconfig.json": JSON.stringify({ compilerOptions: {} }),
					"/bundles/kitchensink/tsdoctor.json": JSON.stringify({ spec: 99 }),
				}),
			),
		),
	);
});
