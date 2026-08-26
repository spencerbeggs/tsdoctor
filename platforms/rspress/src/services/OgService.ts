/**
 * Resolving an API's configured Open Graph image into page metadata.
 *
 * @remarks
 * Replaces the `OpenGraphResolver` class, which did synchronous `node:fs` from
 * inside `Effect.promise`, carried its own sync-island event emitter, and
 * returned `undefined` for all three of its failure modes — indistinguishable
 * from "no image was configured".
 *
 * This is also where phase 4's SEO work lands, which is why the contract is
 * wider than today's single caller needs: it names its failures instead of
 * erasing them.
 *
 * @packageDocumentation
 */

import type { OpenGraphImageConfig, OpenGraphImageMetadata } from "@tsdoctor/seo";
import { imageMimeType, ogAltText, resolveUrl } from "@tsdoctor/seo";
import { Context, Data, Effect, FileSystem, Layer, Option, Path } from "effect";
import { imageSize } from "image-size";
import { emit } from "../observability/EventBus.js";
import { PluginEvent } from "../observability/events.js";

/**
 * What went wrong resolving a configured OG image.
 *
 * @remarks
 * A literal union rather than a free-form string: these are the only three
 * things that can go wrong, and a caller that wants to treat a broken URL
 * differently from a broken file should be able to.
 */
export type OgImageErrorCode = "invalid-url" | "invalid-secure-url" | "unreadable-image";

const OgImageErrorBase = Data.TaggedError("OgImageError");

/**
 * A configured OG image that could not be resolved.
 *
 * @remarks
 * `cause` carries the original failure (an `image-size` parse error, a
 * filesystem error) rather than a stringified copy of it.
 */
export class OgImageError extends OgImageErrorBase<{
	readonly code: OgImageErrorCode;
	/** The config field at fault, as a user would spell it: `ogImage.url`. */
	readonly field: string;
	/** The offending value, for the diagnostic. */
	readonly value: string;
	readonly cause?: unknown;
}> {
	get message(): string {
		if (this.code === "invalid-url") {
			return `Invalid Open Graph image URL in '${this.field}': ${this.value} — expected an absolute http(s) URL or a path starting with '/'`;
		}
		if (this.code === "invalid-secure-url") {
			return `Invalid Open Graph secure URL in '${this.field}': ${this.value} — secureUrl must be an absolute https URL`;
		}
		const cause = this.cause instanceof Error ? this.cause.message : String(this.cause);
		return `Could not read Open Graph image '${this.value}': ${cause}`;
	}
}

/** Everything the resolver needs about one API to resolve its image. */
export interface OgImageRequest {
	/** The API's `ogImage` option, or `undefined` when it declares none. */
	readonly config: OpenGraphImageConfig | undefined;
	/** Absolute site URL, used to make a root-relative path absolute. */
	readonly siteUrl: string;
	/** Docs root; local dimension detection looks under its `public/` dir. */
	readonly docsRoot?: string | undefined;
	readonly packageName: string;
	readonly apiName?: string | undefined;
}

/** @internal */
export interface OgServiceShape {
	/**
	 * Resolve an API's configured OG image into page metadata.
	 *
	 * @returns `Option.none` when the API declares no image at all — that is
	 * not a failure and never produces a diagnostic.
	 *
	 * @remarks
	 * **Callers degrade; they do not fail.** A docs build must not stop because
	 * an image is missing or misconfigured, so `build-stages.ts` catches
	 * {@link OgImageError}, emits it as a `ConfigValidationWarning` (which
	 * reaches `issues.json`) and renders the page without an `og:image`. That
	 * posture is stated here, on the contract, rather than being an accident of
	 * the implementation — an implementation that quietly succeeded instead
	 * would satisfy every caller and lose every diagnostic, which is exactly
	 * the state this replaced.
	 *
	 * The two partial failures — an unusable `secureUrl`, an unreadable image
	 * file — are NOT errors: they warn and yield metadata with that one field
	 * absent, matching the previous behaviour exactly.
	 */
	readonly resolveImage: (
		request: OgImageRequest,
	) => Effect.Effect<Option.Option<OpenGraphImageMetadata>, OgImageError>;
}

export class OgService extends Context.Service<OgService, OgServiceShape>()("rspress-plugin-api-extractor/OgService") {
	/**
	 * Resolve OG images through the core `FileSystem`, with one read per file per
	 * build.
	 *
	 * @remarks
	 * The `node:fs` `existsSync` + `imageSizeFromFile` pair this replaces ran once
	 * per PAGE, so a 400-page API re-read the same image 400 times. The memo below
	 * keys on the absolute path and removes that entirely.
	 *
	 * The memo is per build, not persisted. A cross-build cache in the shared XDG
	 * store was considered and deliberately deferred: it would need mtime/size
	 * invalidation to stay sound, and a stale image dimension is a silent wrong
	 * answer. There is nothing expensive enough here to justify that yet — when
	 * phase 4 starts GENERATING images, which are expensive and content-addressed,
	 * the XDG cache is the right home for them.
	 *
	 * `imageSize` over the read bytes replaces `imageSizeFromFile`, which took a
	 * path and therefore required real `node:fs`. Same parser, same output.
	 *
	 * `Effect.suspend(() => make())` rather than a bare `make`: a static
	 * initializer runs while the module body is still evaluating, so naming a
	 * `const` declared further down throws at import time with a clean typecheck.
	 */
	static readonly layer: Layer.Layer<OgService, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
		this,
		Effect.suspend(() => make()),
	);

	/**
	 * An in-memory double whose unstubbed member dies naming itself.
	 *
	 * @remarks
	 * **There is deliberately no default `resolveImage`.** A default returning
	 * `Option.none` would be indistinguishable from "this API declares no
	 * image", which is precisely the ambiguity {@link OgImageError} exists to
	 * remove — and a test asserting that a page rendered without an `og:image`
	 * would then pass whether or not the service was ever consulted.
	 *
	 * Where the wiring is what matters, prefer the real layer over a platform
	 * filesystem instead of this double; see `__test__/utils/layers.ts`.
	 */
	static readonly makeTest = (overrides: Partial<OgServiceShape> = {}): OgServiceShape => ({
		resolveImage: overrides.resolveImage ?? (() => unstubbed("resolveImage")),
	});

	/** {@link OgService.makeTest} behind a `Layer`. */
	static readonly layerTest = (overrides: Partial<OgServiceShape> = {}): Layer.Layer<OgService> =>
		Layer.succeed(OgService, OgService.makeTest(overrides));
}

const unstubbed = (member: string): never => {
	throw new Error(`OgService.makeTest: ${member}() was called but not stubbed — pass an override.`);
};

/** Dimensions and MIME type read off a local image file. */
interface ImageFacts {
	readonly width?: number;
	readonly height?: number;
	readonly type?: string;
}

const make = () =>
	Effect.gen(function* () {
		const fileSystem = yield* FileSystem.FileSystem;
		const path = yield* Path.Path;

		/** Absolute path → facts, or `null` for "looked, could not use it". */
		const factsByPath = new Map<string, ImageFacts | null>();

		/** Locate a root-relative image under the docs `public/` directory. */
		const findLocalImage = (imagePath: string, docsRoot: string | undefined): Effect.Effect<Option.Option<string>> => {
			if (docsRoot == null || !imagePath.startsWith("/")) return Effect.succeed(Option.none());
			const candidate = path.join(docsRoot, "public", imagePath);
			return fileSystem.exists(candidate).pipe(
				Effect.orElseSucceed(() => false),
				Effect.map((found) => (found ? Option.some(candidate) : Option.none())),
			);
		};

		/**
		 * Read dimensions and MIME type. A file that cannot be parsed warns and
		 * yields nothing — the page still gets its `og:image`, just without
		 * dimensions, which is what the class this replaced did.
		 */
		const readImageFacts = (filePath: string): Effect.Effect<ImageFacts | null> =>
			Effect.gen(function* () {
				const memoed = factsByPath.get(filePath);
				if (memoed !== undefined) return memoed;

				const result = yield* Effect.result(
					fileSystem.readFile(filePath).pipe(Effect.flatMap((bytes) => Effect.try(() => imageSize(bytes)))),
				);

				if (result._tag === "Failure") {
					const error = new OgImageError({
						code: "unreadable-image",
						field: "ogImage",
						value: filePath,
						cause: result.failure,
					});
					yield* emit(
						PluginEvent.ConfigValidationWarning({
							ctx: {},
							field: "ogImage",
							value: filePath,
							reason: error.message,
							level: "warn",
						}),
					);
					factsByPath.set(filePath, null);
					return null;
				}

				const size = result.success;
				const mimeType = imageMimeType(size.type);
				const facts: ImageFacts = {
					...(size.width != null ? { width: size.width } : {}),
					...(size.height != null ? { height: size.height } : {}),
					...(mimeType != null ? { type: mimeType } : {}),
				};
				factsByPath.set(filePath, facts);
				return facts;
			});

		const resolveFromString = (
			imageUrl: string,
			request: OgImageRequest,
		): Effect.Effect<Option.Option<OpenGraphImageMetadata>, OgImageError> =>
			Effect.gen(function* () {
				const resolvedUrl = resolveUrl(request.siteUrl, imageUrl);
				if (resolvedUrl == null) {
					return yield* Effect.fail(new OgImageError({ code: "invalid-url", field: "ogImage", value: imageUrl }));
				}

				const localPath = yield* findLocalImage(imageUrl, request.docsRoot);
				const facts = Option.isSome(localPath) ? yield* readImageFacts(localPath.value) : null;

				return Option.some({
					url: resolvedUrl,
					type: facts?.type,
					width: facts?.width,
					height: facts?.height,
					alt: ogAltText(request.packageName, request.apiName),
				});
			});

		const resolveFromMetadata = (
			metadata: OpenGraphImageMetadata,
			request: OgImageRequest,
		): Effect.Effect<Option.Option<OpenGraphImageMetadata>, OgImageError> =>
			Effect.gen(function* () {
				const { url, secureUrl, type, width, height, alt } = metadata;

				const resolvedUrl = resolveUrl(request.siteUrl, url);
				if (resolvedUrl == null) {
					return yield* Effect.fail(new OgImageError({ code: "invalid-url", field: "ogImage.url", value: url }));
				}

				// A bad secureUrl is a partial failure, not a failed image: the
				// page keeps its og:image and loses only og:image:secure_url.
				let resolvedSecureUrl: string | undefined;
				if (secureUrl != null) {
					if (secureUrl.startsWith("https://")) {
						resolvedSecureUrl = secureUrl;
					} else {
						const error = new OgImageError({
							code: "invalid-secure-url",
							field: "ogImage.secureUrl",
							value: secureUrl,
						});
						yield* emit(
							PluginEvent.ConfigValidationWarning({
								ctx: {},
								field: "ogImage.secureUrl",
								value: secureUrl,
								reason: error.message,
								level: "warn",
							}),
						);
					}
				}

				return Option.some({
					url: resolvedUrl,
					secureUrl: resolvedSecureUrl,
					type,
					width,
					height,
					alt: alt ?? ogAltText(request.packageName, request.apiName),
				});
			});

		const shape: OgServiceShape = {
			resolveImage: (request) => {
				if (request.config == null) return Effect.succeed(Option.none());
				return typeof request.config === "object"
					? resolveFromMetadata(request.config, request)
					: resolveFromString(request.config, request);
			},
		};
		return shape;
	});
