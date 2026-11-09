/**
 * `@tsdoctor/manifest` — deprecated. The spec-1 bundle manifest now ships
 * from the kit as `@effected/manifest`, and the sidecar is named
 * `bundle.json`.
 *
 * @remarks
 * Every name re-exports `@effected/manifest` unchanged, so an existing import
 * keeps working for one more release. Import from `@effected/manifest`, or
 * from `@tsdoctor/bundle`, which re-exports the same names.
 *
 * @deprecated Use `@effected/manifest`.
 *
 * @packageDocumentation
 */

export {
	BUNDLE_MANIFEST_FILENAME,
	BundleManifest,
	BundleManifestError,
	KNOWN_REGISTRY_TYPES,
	type KnownRegistryType,
	MANIFEST_SPEC,
	ManifestSource,
	OpenGraphConfig,
	OpenGraphImage,
	ProjectIdentity,
	RegistryRef,
	SbomRef,
	decodeBundleManifest,
	decodeManifestSource,
	encodeBundleManifest,
	isKnownRegistryType,
} from "@effected/manifest";
