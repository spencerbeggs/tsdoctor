/**
 * `@tsdoctor/manifest` — the `tsdoctor.json` sidecar manifest: the spec-1
 * schema, the writer and reader boundaries, and the authoring-file shape.
 *
 * @remarks
 * The kit now owns spec 1 (`BundleManifest` in `@effected/bundler`), but only
 * from the build-toolchain package. This copy stays until it ships from a pure
 * kit package: spencerbeggs/effected#1301, tracked in spencerbeggs/tsdoctor#400.
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
