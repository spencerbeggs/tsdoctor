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

import type { Effect, Option } from "effect";
import { Context, Data } from "effect";
import type { OpenGraphImageConfig, OpenGraphImageMetadata } from "../schemas/index.js";

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

export class OgService extends Context.Service<OgService, OgServiceShape>()("rspress-plugin-api-extractor/OgService") {}
