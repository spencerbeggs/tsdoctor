/**
 * `@tsdoctor/bundle` — the tsdoctor bundle spec: layered bundle discovery,
 * the versioned `tsdoctor.json` sidecar manifest, provenance-carrying
 * resolution and canonical input hashing for API documentation bundles.
 *
 * @packageDocumentation
 */

export {
	type ApiModelInfo,
	type Bundle,
	type BundleDescriptor,
	BundleLayerError,
	TSDOCTOR_MANIFEST_FILENAME,
	readApiModelInfo,
	readBundle,
} from "./Bundle.js";
export {
	BundleDiscoveryError,
	type BundleOverrides,
	type DiscoverBundleOptions,
	type DiscoverBundlesOptions,
	discoverBundle,
	discoverBundles,
	loadBundle,
	loadBundles,
} from "./BundleDiscovery.js";
export {
	BundleFetchError,
	type FetchGitHubReleaseBundleOptions,
	type FetchNpmBundleOptions,
	fetchGitHubReleaseBundle,
	fetchNpmBundle,
} from "./BundleFetch.js";
export { fingerprintResolvedBundle, hashJsonValue, hashLayerText, hashText, normalizeText } from "./BundleHash.js";
export {
	BundleManifest,
	BundleManifestError,
	KNOWN_REGISTRY_TYPES,
	type KnownRegistryType,
	OpenGraphConfig,
	OpenGraphImage,
	ProjectIdentity,
	RegistryRef,
	SbomRef,
	decodeBundleManifest,
	isKnownRegistryType,
} from "./BundleManifest.js";
export {
	type ProvenanceSource,
	type Provenanced,
	type ResolveBundleInput,
	type ResolvedBundle,
	type ResolvedOpenGraph,
	type ResolvedOpenGraphImage,
	resolveBundle,
	resolveBundleFrom,
} from "./BundleResolver.js";
export { PlatformOverrides, decodePlatformOverrides } from "./PlatformOverrides.js";
