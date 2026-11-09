/**
 * `@tsdoctor/bundle` — the tsdoctor bundle spec: layered bundle discovery,
 * the versioned `bundle.json` sidecar manifest, provenance-carrying
 * resolution and canonical input hashing for API documentation bundles.
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
export {
	type ApiModelInfo,
	type Bundle,
	type BundleDescriptor,
	BundleLayerError,
	readApiModelInfo,
	readBundle,
} from "./Bundle.js";
export {
	BundleAssetError,
	type PublishBundleAssetsInput,
	type PublishedOpenGraphImage,
	publishBundleAssets,
} from "./BundleAssets.js";
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
