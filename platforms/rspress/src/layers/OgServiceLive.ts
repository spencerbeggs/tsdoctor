import { Effect, FileSystem, Layer, Option, Path } from "effect";
import { imageSize } from "image-size";
import { emit } from "../observability/EventBus.js";
import { PluginEvent } from "../observability/events.js";
import { imageMimeType, ogAltText, resolveOgUrl } from "../og-resolver.js";
import type { OpenGraphImageMetadata } from "../schemas/index.js";
import type { OgImageRequest, OgServiceShape } from "../services/OgService.js";
import { OgImageError, OgService } from "../services/OgService.js";

/** Dimensions and MIME type read off a local image file. */
interface ImageFacts {
	readonly width?: number;
	readonly height?: number;
	readonly type?: string;
}

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
 */
export const OgServiceLive: Layer.Layer<OgService, never, FileSystem.FileSystem | Path.Path> = Layer.effect(
	OgService,
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
				const resolvedUrl = resolveOgUrl(request.siteUrl, imageUrl);
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

				const resolvedUrl = resolveOgUrl(request.siteUrl, url);
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
	}),
);
