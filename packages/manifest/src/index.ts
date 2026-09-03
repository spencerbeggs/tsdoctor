/**
 * `@tsdoctor/manifest` — the `tsdoctor.json` sidecar manifest: the spec-1
 * schema, the writer and reader boundaries, and the authoring-file shape.
 *
 * @packageDocumentation
 */

export {
	BundleManifest,
	BundleManifestError,
	KNOWN_REGISTRY_TYPES,
	type KnownRegistryType,
	MANIFEST_SPEC,
	OpenGraphConfig,
	OpenGraphImage,
	ProjectIdentity,
	RegistryRef,
	SbomRef,
	TSDOCTOR_MANIFEST_FILENAME,
	decodeBundleManifest,
	encodeBundleManifest,
	isKnownRegistryType,
} from "./BundleManifest.js";
export { ManifestSource, decodeManifestSource } from "./ManifestSource.js";
