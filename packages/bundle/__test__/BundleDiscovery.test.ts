import { fileURLToPath } from "node:url";
import { NodeFileSystem } from "@effect/platform-node";
import { assert, describe, it } from "@effect/vitest";
import type { MemoryFileSystemSeed } from "@effected/memfs";
import { MemoryFileSystem } from "@effected/memfs";
import { Effect, Layer, Option, Path } from "effect";
import { discoverBundle, discoverBundles, loadBundle, resolveBundleFrom } from "../src/index.js";

const apiModelText = (name: string) =>
	JSON.stringify({
		metadata: { toolPackage: "@microsoft/api-extractor", toolVersion: "7.59.0", schemaVersion: 1011 },
		kind: "Package",
		name,
		members: [],
	});

const memfsLayer = (seed: MemoryFileSystemSeed) => Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer);

const nodeLayer = Layer.mergeAll(NodeFileSystem.layer, Path.layer);

const fixturesDir = fileURLToPath(new URL("./fixtures", import.meta.url));

describe("discoverBundle", () => {
	it.effect("discovers a full bundle folder into a descriptor", () =>
		Effect.gen(function* () {
			const descriptor = yield* discoverBundle("/bundles/kitchensink");
			assert.strictEqual(descriptor.dir, "/bundles/kitchensink");
			assert.strictEqual(descriptor.dirname, "kitchensink");
			assert.strictEqual(descriptor.name, "@modules/kitchensink");
			assert.strictEqual(descriptor.version, "0.1.0");
			assert.strictEqual(descriptor.modelPath, "/bundles/kitchensink/kitchensink.api.json");
			assert.strictEqual(descriptor.packageJsonPath, "/bundles/kitchensink/package.json");
			assert.strictEqual(descriptor.tsconfigPath, "/bundles/kitchensink/tsconfig.json");
			assert.strictEqual(descriptor.manifestPath, "/bundles/kitchensink/tsdoctor.json");
		}).pipe(
			Effect.provide(
				memfsLayer({
					"/bundles/kitchensink/kitchensink.api.json": apiModelText("@modules/kitchensink"),
					"/bundles/kitchensink/package.json": JSON.stringify({ name: "@modules/kitchensink", version: "0.1.0" }),
					"/bundles/kitchensink/tsconfig.json": JSON.stringify({ compilerOptions: {} }),
					"/bundles/kitchensink/tsdoctor.json": JSON.stringify({ spec: 1 }),
				}),
			),
		),
	);

	it.effect("a layer-0-only bundle discovers with the model's own name", () =>
		Effect.gen(function* () {
			const descriptor = yield* discoverBundle("/bundles/bare");
			assert.strictEqual(descriptor.name, "@modules/bare");
			assert.strictEqual(descriptor.version, undefined);
			assert.strictEqual(descriptor.packageJsonPath, undefined);
			assert.strictEqual(descriptor.tsconfigPath, undefined);
			assert.strictEqual(descriptor.manifestPath, undefined);
		}).pipe(Effect.provide(memfsLayer({ "/bundles/bare/bare.api.json": apiModelText("@modules/bare") }))),
	);

	it.effect("among several models, <unscoped>.api.json for the package name wins", () =>
		Effect.gen(function* () {
			const descriptor = yield* discoverBundle("/bundles/multi");
			assert.strictEqual(descriptor.modelPath, "/bundles/multi/sdk.api.json");
		}).pipe(
			Effect.provide(
				memfsLayer({
					"/bundles/multi/other.api.json": apiModelText("@scope/other"),
					"/bundles/multi/sdk.api.json": apiModelText("@scope/sdk"),
					"/bundles/multi/package.json": JSON.stringify({ name: "@scope/sdk", version: "1.0.0" }),
				}),
			),
		),
	);

	it.effect("several models with no name match fail as ambiguous", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(discoverBundle("/bundles/multi"));
			assert.strictEqual(error._tag, "BundleDiscoveryError");
			assert.isTrue(error._tag === "BundleDiscoveryError" && error.reason === "ambiguousApiModel");
		}).pipe(
			Effect.provide(
				memfsLayer({
					"/bundles/multi/a.api.json": apiModelText("a"),
					"/bundles/multi/b.api.json": apiModelText("b"),
					"/bundles/multi/package.json": JSON.stringify({ name: "@scope/sdk" }),
				}),
			),
		),
	);

	it.effect("failure reasons: notFound, notADirectory, noApiModel, invalidPackageJson", () =>
		Effect.gen(function* () {
			const notFound = yield* Effect.flip(discoverBundle("/missing"));
			assert.isTrue(notFound._tag === "BundleDiscoveryError" && notFound.reason === "notFound");

			const notADirectory = yield* Effect.flip(discoverBundle("/file.txt"));
			assert.isTrue(notADirectory._tag === "BundleDiscoveryError" && notADirectory.reason === "notADirectory");

			const noModel = yield* Effect.flip(discoverBundle("/empty"));
			assert.isTrue(noModel._tag === "BundleDiscoveryError" && noModel.reason === "noApiModel");

			const badPackageJson = yield* Effect.flip(discoverBundle("/badpkg"));
			assert.isTrue(badPackageJson._tag === "BundleDiscoveryError" && badPackageJson.reason === "invalidPackageJson");
		}).pipe(
			Effect.provide(
				memfsLayer({
					"/file.txt": "not a directory",
					"/empty/README.md": "no model here",
					"/badpkg/pkg.api.json": apiModelText("pkg"),
					"/badpkg/package.json": "{ not json",
				}),
			),
		),
	);

	it.effect("caller overrides win over discovery", () =>
		Effect.gen(function* () {
			const descriptor = yield* discoverBundle("/bundles/kitchensink", {
				overrides: { name: "custom-name", version: "9.9.9", modelPath: "alt.api.json" },
			});
			assert.strictEqual(descriptor.name, "custom-name");
			assert.strictEqual(descriptor.version, "9.9.9");
			assert.strictEqual(descriptor.modelPath, "/bundles/kitchensink/alt.api.json");
		}).pipe(
			Effect.provide(
				memfsLayer({
					"/bundles/kitchensink/kitchensink.api.json": apiModelText("@modules/kitchensink"),
					"/bundles/kitchensink/alt.api.json": apiModelText("@modules/alt"),
					"/bundles/kitchensink/package.json": JSON.stringify({ name: "@modules/kitchensink", version: "0.1.0" }),
				}),
			),
		),
	);
});

describe("discoverBundles", () => {
	const parentSeed: MemoryFileSystemSeed = {
		"/models/alpha/alpha.api.json": apiModelText("@scope/alpha"),
		"/models/alpha/package.json": JSON.stringify({ name: "@scope/alpha", version: "1.0.0" }),
		"/models/beta/beta.api.json": apiModelText("@scope/beta"),
		"/models/.hidden/junk.txt": "skipped",
	};

	it.effect("discovers one bundle per subfolder, sorted, skipping dotfolders", () =>
		Effect.gen(function* () {
			const descriptors = yield* discoverBundles("/models");
			assert.deepStrictEqual(
				descriptors.map((descriptor) => descriptor.name),
				["@scope/alpha", "@scope/beta"],
			);
		}).pipe(Effect.provide(memfsLayer(parentSeed))),
	);

	it.effect("a stray subfolder without a model fails the whole scan", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(discoverBundles("/models"));
			assert.isTrue(error._tag === "BundleDiscoveryError" && error.reason === "notABundleFolder");
			assert.include(error._tag === "BundleDiscoveryError" ? (error.detail ?? "") : "", "stray");
		}).pipe(Effect.provide(memfsLayer({ ...parentSeed, "/models/stray/README.md": "not a bundle" }))),
	);

	it.effect("an empty parent is a failure, not an empty array", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(discoverBundles("/models"));
			assert.isTrue(error._tag === "BundleDiscoveryError" && error.reason === "emptyParent");
		}).pipe(Effect.provide(memfsLayer({ "/models/.keep": "" }))),
	);
});

describe("fixture bundle (real filesystem)", () => {
	it.effect("loadBundle reads the kitchensink fixture end to end", () =>
		Effect.gen(function* () {
			const bundle = yield* loadBundle("kitchensink", { cwd: fixturesDir });
			assert.strictEqual(bundle.descriptor.name, "@modules/kitchensink");
			assert.strictEqual(bundle.descriptor.version, "0.1.0");
			assert.strictEqual(bundle.apiModel.name, "@modules/kitchensink");
			assert.isTrue(Option.isSome(bundle.tsconfig));
			assert.strictEqual(
				Option.isSome(bundle.tsconfig) ? bundle.tsconfig.value.compilerOptions.strict : undefined,
				true,
			);

			const resolved = resolveBundleFrom(bundle);
			assert.deepStrictEqual(resolved.name, { value: "Kitchen Sink", source: "manifest.leaf" });
			assert.deepStrictEqual(resolved.version, { value: "0.1.0", source: "packageJson" });
			const image = resolved.openGraph?.value.images[0];
			assert.deepStrictEqual(image?.type, { value: "image/png", source: "inferred" });
			assert.deepStrictEqual(image?.alt, {
				value: "Every API Extractor feature in one module",
				source: "inferred",
			});
			assert.deepStrictEqual(resolved.peerDependencies?.value, { effect: "^4.0.0" });
		}).pipe(Effect.provide(nodeLayer)),
	);
});
