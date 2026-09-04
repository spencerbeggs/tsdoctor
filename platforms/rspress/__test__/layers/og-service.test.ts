/**
 * `OgService` — the IO half of Open Graph resolution.
 *
 * @remarks
 * This is the characterization suite that used to live in
 * `og-resolver.test.ts` behind `vi.mock("node:fs")`. It runs against
 * `@effected/memfs` now, so it exercises the real `FileSystem` contract
 * instead of a stub that answers whatever the test told it to.
 *
 * Two behaviours here look like failures and are deliberately NOT: an
 * unusable `secureUrl` and an unreadable image file are PARTIAL successes.
 * They warn and drop one field, matching the class this replaced. Only an
 * unusable URL is a typed failure, because that is the case that used to be
 * indistinguishable from "no image was configured".
 */

import { MemoryFileSystem } from "@effected/memfs";
import { Effect, FileSystem, Layer, Option, Path, References } from "effect";
import { describe, expect, it } from "vitest";
import { makeEventBusLayer } from "../../src/observability/EventBus.js";
import type { PluginEvent } from "../../src/observability/events.js";
import type { OgImageRequest } from "../../src/services/OgService.js";
import { OgService } from "../../src/services/OgService.js";

/** A 1x1 PNG, so `imageSize` has something real to parse. */
const PNG_1X1 = Uint8Array.from(
	Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	),
);

const SITE = "https://example.com";
const DOCS_ROOT = "/docs";

interface Harness {
	readonly resolve: (request: Partial<OgImageRequest> & Pick<OgImageRequest, "config">) => Promise<unknown>;
	readonly events: PluginEvent[];
}

function harness(seed: Record<string, string | Uint8Array> = {}): Harness {
	const events: PluginEvent[] = [];
	const bus = makeEventBusLayer([{ minLevel: "trace", handle: (e) => events.push(e) }]);
	const layer = Layer.provide(OgService.layer, Layer.mergeAll(MemoryFileSystem.layerWith(seed), Path.layer));
	const full = Layer.mergeAll(
		layer,
		bus as unknown as Layer.Layer<never>,
		Layer.succeed(References.MinimumLogLevel, "None"),
	);

	return {
		events,
		resolve: (request) =>
			Effect.runPromise(
				Effect.gen(function* () {
					const svc = yield* OgService;
					return yield* Effect.result(
						svc.resolveImage({
							siteUrl: SITE,
							docsRoot: DOCS_ROOT,
							packageName: "my-lib",
							fallbackAlt: "my-lib API documentation",
							...request,
						} as OgImageRequest),
					);
				}).pipe(Effect.provide(full)),
			),
	};
}

const success = (r: unknown): Record<string, unknown> | undefined => {
	const result = r as { _tag: string; success?: Option.Option<Record<string, unknown>> };
	if (result._tag !== "Success" || result.success == null) return undefined;
	return Option.isSome(result.success) ? result.success.value : undefined;
};
const failure = (r: unknown) => (r as { _tag: string; failure?: { code: string; field: string } }).failure;

describe("OgService.resolveImage", () => {
	it("yields none, with no diagnostic, when no image is configured", async () => {
		const h = harness();
		const result = await h.resolve({ config: undefined });
		expect((result as { _tag: string })._tag).toBe("Success");
		expect(success(result)).toBeUndefined();
		expect(h.events).toHaveLength(0);
	});

	describe("string config", () => {
		it("resolves an absolute URL and generates alt text", async () => {
			const h = harness();
			const result = await h.resolve({ config: "https://cdn.example.com/og.png" });
			expect(success(result)).toMatchObject({
				url: "https://cdn.example.com/og.png",
				alt: "my-lib API documentation",
			});
		});

		it("resolves a root-relative path against the site URL", async () => {
			const h = harness();
			expect(success(await h.resolve({ config: "/images/og.png" }))).toMatchObject({
				url: "https://example.com/images/og.png",
			});
		});

		// FORBIDS: returning Option.none for an unusable URL. That is the state
		// this replaced — indistinguishable from "no image configured", so no
		// diagnostic ever reached issues.json.
		it("FAILS with invalid-url for a bare relative path", async () => {
			const h = harness();
			const result = await h.resolve({ config: "invalid-path" });
			expect((result as { _tag: string })._tag).toBe("Failure");
			expect(failure(result)).toMatchObject({ code: "invalid-url", field: "ogImage", value: "invalid-path" });
		});

		it("auto-detects dimensions and MIME type from a local file", async () => {
			const h = harness({ [`${DOCS_ROOT}/public/images/og.png`]: PNG_1X1 });
			expect(success(await h.resolve({ config: "/images/og.png" }))).toMatchObject({
				url: "https://example.com/images/og.png",
				type: "image/png",
				width: 1,
				height: 1,
			});
		});

		it("does not look for a local file without a docsRoot", async () => {
			const h = harness({ [`${DOCS_ROOT}/public/images/og.png`]: PNG_1X1 });
			const result = success(await h.resolve({ config: "/images/og.png", docsRoot: undefined }));
			expect(result).toMatchObject({ url: "https://example.com/images/og.png" });
			expect(result?.width).toBeUndefined();
		});

		it("still yields the image when the local file is missing", async () => {
			const h = harness();
			const result = success(await h.resolve({ config: "/images/missing.png" }));
			expect(result).toMatchObject({ url: "https://example.com/images/missing.png" });
			expect(result?.width).toBeUndefined();
			expect(h.events).toHaveLength(0);
		});

		// PARTIAL success, not a failure: the page keeps its og:image and loses
		// only the dimensions. FORBIDS turning this into a typed failure, which
		// would drop the og:image entirely for a merely unparseable file.
		it("warns but still yields the image when the file cannot be parsed", async () => {
			const h = harness({ [`${DOCS_ROOT}/public/images/corrupt.png`]: "not an image" });
			const result = await h.resolve({ config: "/images/corrupt.png" });
			expect((result as { _tag: string })._tag).toBe("Success");
			expect(success(result)).toMatchObject({ url: "https://example.com/images/corrupt.png" });
			expect(success(result)?.width).toBeUndefined();
			expect(h.events).toContainEqual(expect.objectContaining({ _tag: "ConfigValidationWarning", field: "ogImage" }));
		});

		it("finds a nested image path under public/", async () => {
			const h = harness({ [`${DOCS_ROOT}/public/images/packages/my-lib/og.png`]: PNG_1X1 });
			expect(success(await h.resolve({ config: "/images/packages/my-lib/og.png" }))).toMatchObject({
				url: "https://example.com/images/packages/my-lib/og.png",
				width: 1,
			});
		});
	});

	describe("metadata object config", () => {
		it("resolves the url and keeps the declared fields", async () => {
			const h = harness();
			expect(
				success(
					await h.resolve({
						config: { url: "/images/og.png", type: "image/png", width: 1200, height: 630 },
					}),
				),
			).toMatchObject({
				url: "https://example.com/images/og.png",
				type: "image/png",
				width: 1200,
				height: 630,
			});
		});

		it("prefers a caller-supplied alt over the generated one", async () => {
			const h = harness();
			expect(success(await h.resolve({ config: { url: "/og.png", alt: "Custom alt" } }))).toMatchObject({
				alt: "Custom alt",
			});
		});

		it("names ogImage.url as the field when the url is unusable", async () => {
			const h = harness();
			const result = await h.resolve({ config: { url: "invalid-path" } });
			expect(failure(result)).toMatchObject({ code: "invalid-url", field: "ogImage.url" });
		});

		it("keeps an https secureUrl", async () => {
			const h = harness();
			expect(
				success(await h.resolve({ config: { url: "/og.png", secureUrl: "https://secure.example.com/og.png" } })),
			).toMatchObject({ secureUrl: "https://secure.example.com/og.png" });
		});

		// PARTIAL success. FORBIDS promoting this to a typed failure — a bad
		// secureUrl must not cost the page its og:image.
		it("warns and drops a non-https secureUrl, keeping the image", async () => {
			const h = harness();
			const result = await h.resolve({ config: { url: "/og.png", secureUrl: "http://insecure.example.com/og.png" } });
			expect((result as { _tag: string })._tag).toBe("Success");
			expect(success(result)?.secureUrl).toBeUndefined();
			expect(success(result)?.url).toBe("https://example.com/og.png");
			expect(h.events).toContainEqual(
				expect.objectContaining({ _tag: "ConfigValidationWarning", field: "ogImage.secureUrl" }),
			);
		});
	});

	describe("per-build memoization", () => {
		// FORBIDS: dropping the memo. The old resolver ran existsSync +
		// imageSizeFromFile once per PAGE, so an API with one og image and 400
		// pages read the same file 400 times. Counting reads is the only way to
		// see it — the output is identical either way.
		it("reads a given image file once, however many pages ask for it", async () => {
			let reads = 0;
			const volume = MemoryFileSystem.layerWith({ [`${DOCS_ROOT}/public/og.png`]: PNG_1X1 });
			const counting = Layer.effect(
				FileSystem.FileSystem,
				Effect.gen(function* () {
					const fs = yield* FileSystem.FileSystem;
					return {
						...fs,
						readFile: (p: string) => {
							reads++;
							return fs.readFile(p);
						},
					} as typeof fs;
				}),
			).pipe(Layer.provide(volume));

			const layer = Layer.provide(OgService.layer, Layer.mergeAll(counting, Path.layer));
			const program = Effect.gen(function* () {
				const svc = yield* OgService;
				const request: OgImageRequest = {
					config: "/og.png",
					siteUrl: SITE,
					docsRoot: DOCS_ROOT,
					packageName: "my-lib",
					fallbackAlt: "my-lib API documentation",
				};
				yield* svc.resolveImage(request);
				yield* svc.resolveImage(request);
				yield* svc.resolveImage(request);
			});
			await Effect.runPromise(
				program.pipe(Effect.provide(Layer.mergeAll(layer, Layer.succeed(References.MinimumLogLevel, "None")))),
			);
			expect(reads).toBe(1);
		});
	});
});
