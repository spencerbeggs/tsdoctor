import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { MANIFEST_SPEC, decodeBundleManifest, decodeManifestSource, encodeBundleManifest } from "../src/index.js";

const full = {
	spec: 1,
	name: "Kitchen Sink",
	tagline: "Every API Extractor shape",
	description: "A fixture.",
	project: { name: "tsdoctor", tagline: "API docs from api.json" },
	openGraph: {
		images: [{ path: "og/kitchensink.png", type: "image/png", width: 1200, height: 630, alt: "Kitchen Sink" }],
		themeColor: "#0f172a",
	},
	sbom: { path: "kitchensink.sbom.json", format: "spdx-json" },
	registries: [{ type: "npm", name: "npm", url: "https://www.npmjs.com/package/@modules/kitchensink" }],
} as const;

describe("BundleManifest", () => {
	it.effect("encodes what it decodes, byte for byte", () =>
		Effect.gen(function* () {
			const decoded = yield* decodeBundleManifest(full);
			const encoded = yield* encodeBundleManifest(decoded);
			expect(encoded).toEqual(full);
		}),
	);

	it("pins the spec version", () => {
		expect(MANIFEST_SPEC).toBe(1);
	});

	it.effect("rejects an image with both path and url", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(
				decodeBundleManifest({ spec: 1, openGraph: { images: [{ path: "a.png", url: "https://x/a.png" }] } }),
			);
			expect(result._tag).toBe("Failure");
		}),
	);
});

describe("ManifestSource", () => {
	it.effect("decodes a leaf file and drops spec and project", () =>
		Effect.gen(function* () {
			const source = yield* decodeManifestSource({ spec: 1, project: { name: "x" }, name: "Leaf", tagline: "t" });
			expect(source).toEqual({ name: "Leaf", tagline: "t" });
		}),
	);

	it.effect("carries a path into the error", () =>
		Effect.gen(function* () {
			const result = yield* Effect.result(decodeManifestSource({ name: 42 }, "/pkg/tsdoctor.json"));
			expect(result._tag === "Failure" && result.failure.path).toBe("/pkg/tsdoctor.json");
		}),
	);
});
