import { BundleManifestError, OpenGraphConfig, RegistryRef, SbomRef } from "@tsdoctor/manifest";
import { Effect, Schema } from "effect";

/**
 * The `manifest.platform` tier: a data-override object a consumer passes
 * through platform options (e.g. `ApiExtractorPlugin(options)`), sitting at
 * the TOP of the tier ranking.
 *
 * @remarks
 * Same field surface as the authored manifest tiers — name, tagline,
 * description, openGraph, sbom, registries — with no `spec` field (it is not
 * a file with an independent version) and no `project` block (it is a single
 * tier, not a flattened hierarchy). Lets a user with ONLY an api.json declare
 * identity/OG/registries declaratively; the resolver does the merging.
 *
 * @public
 */
export const PlatformOverrides = Schema.Struct({
	/** Human display name override. */
	name: Schema.optionalKey(Schema.String),
	/** Tagline override. */
	tagline: Schema.optionalKey(Schema.String),
	/** Description override. */
	description: Schema.optionalKey(Schema.String),
	/** Open Graph override. */
	openGraph: Schema.optionalKey(OpenGraphConfig),
	/** SBOM pointer override. */
	sbom: Schema.optionalKey(SbomRef),
	/** Registries override. */
	registries: Schema.optionalKey(Schema.Array(RegistryRef)),
});

/**
 * The decoded type of {@link (PlatformOverrides:variable)}.
 *
 * @public
 */
export type PlatformOverrides = typeof PlatformOverrides.Type;

/**
 * Decode an unknown value into a {@link (PlatformOverrides:type)}.
 *
 * @remarks
 * For adapters decoding raw platform options. Failures share
 * {@link BundleManifestError} — the platform tier is manifest data by another
 * route, and a caller handles both boundaries with one tag.
 *
 * @public
 */
export function decodePlatformOverrides(input: unknown): Effect.Effect<PlatformOverrides, BundleManifestError> {
	return Schema.decodeUnknownEffect(PlatformOverrides)(input).pipe(
		Effect.mapError((cause) => new BundleManifestError({ cause })),
	);
}
