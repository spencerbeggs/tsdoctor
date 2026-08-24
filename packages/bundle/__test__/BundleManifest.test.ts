import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodeBundleManifest, isKnownRegistryType } from "../src/index.js";

describe("BundleManifest", () => {
	it.effect("decodes a minimal manifest: spec is the only required field", () =>
		Effect.gen(function* () {
			const manifest = yield* decodeBundleManifest({ spec: 1 });
			assert.strictEqual(manifest.spec, 1);
			assert.strictEqual(manifest.name, undefined);
			assert.strictEqual(manifest.openGraph, undefined);
		}),
	);

	it.effect("decodes the full v1 shape", () =>
		Effect.gen(function* () {
			const manifest = yield* decodeBundleManifest({
				spec: 1,
				name: "Effected",
				tagline: "Boring Effect Plumbing Done Right",
				description: "A kit of Effect libraries.",
				project: { name: "Effected", tagline: "The kit" },
				openGraph: {
					images: [{ path: "assets/og.png", type: "image/png", width: 1200, height: 630, alt: "Effected" }],
					themeColor: "#7c3aed",
				},
				sbom: { path: "sbom.spdx.json", format: "spdx-json" },
				registries: [{ type: "npm", name: "npm", url: "https://www.npmjs.com/package/@effected/store" }],
			});
			assert.strictEqual(manifest.name, "Effected");
			assert.strictEqual(manifest.project?.tagline, "The kit");
			assert.strictEqual(manifest.openGraph?.images?.[0]?.width, 1200);
			assert.strictEqual(manifest.sbom?.format, "spdx-json");
			assert.strictEqual(manifest.registries?.[0]?.type, "npm");
		}),
	);

	it.effect("rejects a missing or wrong spec version, typed", () =>
		Effect.gen(function* () {
			const missing = yield* Effect.flip(decodeBundleManifest({}));
			assert.strictEqual(missing._tag, "BundleManifestError");
			const wrong = yield* Effect.flip(decodeBundleManifest({ spec: 2 }));
			assert.strictEqual(wrong._tag, "BundleManifestError");
			const stringy = yield* Effect.flip(decodeBundleManifest({ spec: "1" }));
			assert.strictEqual(stringy._tag, "BundleManifestError");
		}),
	);

	it.effect("enforces the openGraph image path/url XOR", () =>
		Effect.gen(function* () {
			const both = yield* Effect.flip(
				decodeBundleManifest({
					spec: 1,
					openGraph: { images: [{ path: "a.png", url: "https://x.example/a.png" }] },
				}),
			);
			assert.strictEqual(both._tag, "BundleManifestError");
			const neither = yield* Effect.flip(decodeBundleManifest({ spec: 1, openGraph: { images: [{}] } }));
			assert.strictEqual(neither._tag, "BundleManifestError");
			// Each side alone is valid.
			const withPath = yield* decodeBundleManifest({ spec: 1, openGraph: { images: [{ path: "a.png" }] } });
			assert.strictEqual(withPath.openGraph?.images?.[0]?.path, "a.png");
			const withUrl = yield* decodeBundleManifest({
				spec: 1,
				openGraph: { images: [{ url: "https://x.example/a.png" }] },
			});
			assert.strictEqual(withUrl.openGraph?.images?.[0]?.url, "https://x.example/a.png");
		}),
	);

	it.effect("accepts unknown registry types (graceful degradation, not rejection)", () =>
		Effect.gen(function* () {
			const manifest = yield* decodeBundleManifest({
				spec: 1,
				registries: [{ type: "cargo", name: "crates.io", url: "https://crates.io/x" }],
			});
			const registry = manifest.registries?.[0];
			assert.strictEqual(registry?.type, "cargo");
			assert.isFalse(isKnownRegistryType(registry?.type ?? ""));
			assert.isTrue(isKnownRegistryType("npm"));
			assert.isTrue(isKnownRegistryType("jsr"));
		}),
	);

	it.effect("ignores unknown top-level fields (additive spec evolution)", () =>
		Effect.gen(function* () {
			const manifest = yield* decodeBundleManifest({ spec: 1, futureField: { anything: true } });
			assert.strictEqual(manifest.spec, 1);
			assert.isFalse("futureField" in manifest);
		}),
	);

	it.effect("carries the manifest path on file-bound failures", () =>
		Effect.gen(function* () {
			const error = yield* Effect.flip(decodeBundleManifest({ spec: 3 }, "/bundles/x/tsdoctor.json"));
			assert.strictEqual(error.path, "/bundles/x/tsdoctor.json");
			assert.include(error.message, "/bundles/x/tsdoctor.json");
		}),
	);
});
