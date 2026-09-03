import type { PackageManifest } from "@effected/package-json";
import type { CompilerOptions, ResolvedTsconfig } from "@effected/tsconfig-json";
import type { BundleManifest, ProjectIdentity, RegistryRef, SbomRef } from "@tsdoctor/manifest";
import { HashMap, Option } from "effect";
import type { ApiModelInfo, Bundle } from "./Bundle.js";
import type { PlatformOverrides } from "./PlatformOverrides.js";

/**
 * Where a resolved field's value came from, highest-ranked tier first.
 *
 * @remarks
 * The first six values are the spec's tier ladder. `"tsconfig"` is this
 * package's one addition: the spec passes tsconfig compiler options through
 * as a resolved field but its ladder has no source that names the tsconfig
 * layer, so the union carries one.
 *
 * @public
 */
export type ProvenanceSource =
	| "manifest.platform"
	| "manifest.leaf"
	| "manifest.project"
	| "packageJson"
	| "apiModel"
	| "tsconfig"
	| "inferred";

/**
 * A resolved value carrying its provenance.
 *
 * @remarks
 * Provenance is load-bearing: a field is user-overridden iff its source
 * outranks the derivation that would otherwise supply it, an `inferred`
 * field tracks upstream changes while an authored field is pinned, and the
 * change-detection fingerprints hash value AND source together so an
 * override flip is a visible diff.
 *
 * @public
 */
export interface Provenanced<A> {
	/** The resolved value. */
	readonly value: A;
	/** The tier that supplied it. */
	readonly source: ProvenanceSource;
}

/**
 * One Open Graph image after resolution: authored fields passed through,
 * `type` and `alt` filled by the documented inference rules when absent.
 *
 * @public
 */
export interface ResolvedOpenGraphImage {
	/** Bundle-relative asset path, when the image is bundle-supplied. */
	readonly path?: string;
	/** Absolute external URL, when the image is external. */
	readonly url?: string;
	/** MIME type — authored, or inferred from the file extension. */
	readonly type?: Provenanced<string>;
	/** Pixel width, as authored. */
	readonly width?: number;
	/** Pixel height, as authored. */
	readonly height?: number;
	/** Alt text — authored, or inferred (tagline → description → `"<name> API documentation"`); never empty. */
	readonly alt: Provenanced<string>;
}

/**
 * The Open Graph block after resolution.
 *
 * @public
 */
export interface ResolvedOpenGraph {
	/** Resolved images, first-declared-wins per OG array semantics. */
	readonly images: ReadonlyArray<ResolvedOpenGraphImage>;
	/** Embed accent color, when authored. */
	readonly themeColor?: string;
}

/**
 * A bundle's manifest data resolved across the six tiers, every field
 * carrying value + provenance.
 *
 * @remarks
 * Fields that no tier supplies are absent — with two floors: `name` always
 * resolves (the api.json model always has one) and every resolved image's
 * `alt` always resolves (the inference chain bottoms out on `name`).
 *
 * @public
 */
export interface ResolvedBundle {
	/** Display name: platform → leaf manifest → package.json → api.json model. */
	readonly name: Provenanced<string>;
	/** Package version, from package.json. */
	readonly version?: Provenanced<string>;
	/** Tagline: platform → leaf manifest → project tier. */
	readonly tagline?: Provenanced<string>;
	/** Description: platform → leaf manifest → package.json. */
	readonly description?: Provenanced<string>;
	/** The project identity block, when the manifest carries one. */
	readonly project?: Provenanced<ProjectIdentity>;
	/** Open Graph block: platform → leaf manifest, with per-image inference applied. */
	readonly openGraph?: Provenanced<ResolvedOpenGraph>;
	/** SBOM pointer: platform → leaf manifest. */
	readonly sbom?: Provenanced<SbomRef>;
	/** Registries: platform → leaf manifest. */
	readonly registries?: Provenanced<ReadonlyArray<RegistryRef>>;
	/** Runtime dependencies from package.json, key-sorted. Feeds the type registry's rendering scope. */
	readonly dependencies?: Provenanced<Readonly<Record<string, string>>>;
	/** Peer dependencies from package.json, key-sorted. Feeds the type registry's rendering scope. */
	readonly peerDependencies?: Provenanced<Readonly<Record<string, string>>>;
	/** Extends-resolved compiler options from tsconfig.json. Feeds the Twoslash environment. */
	readonly compilerOptions?: Provenanced<CompilerOptions.Type>;
}

/**
 * The parsed layers {@link resolveBundle} resolves — plain optional fields,
 * so pure call sites (and tests) need no `Option` wrapping.
 *
 * @public
 */
export interface ResolveBundleInput {
	/** Layer 0: the model header (required — the one layer a bundle must have). */
	readonly apiModel: ApiModelInfo;
	/** Layer 1: the package.json manifest, when present. */
	readonly packageJson?: PackageManifest;
	/** Layer 2: the extends-resolved tsconfig, when present. */
	readonly tsconfig?: ResolvedTsconfig;
	/** Layer 3: the tsdoctor.json sidecar manifest, when present. */
	readonly manifest?: BundleManifest;
	/** The `manifest.platform` tier, from platform options. */
	readonly platform?: PlatformOverrides;
}

/** MIME types inferred from image file extensions. */
const IMAGE_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
	avif: "image/avif",
	gif: "image/gif",
	jpeg: "image/jpeg",
	jpg: "image/jpeg",
	png: "image/png",
	svg: "image/svg+xml",
	webp: "image/webp",
};

/** The lowercased file extension of an image path or URL, query/fragment stripped. */
function imageExtension(pathOrUrl: string): string | undefined {
	const withoutQuery = pathOrUrl.split(/[?#]/, 1)[0] as string;
	const lastSegment = withoutQuery.slice(withoutQuery.lastIndexOf("/") + 1);
	const dot = lastSegment.lastIndexOf(".");
	if (dot <= 0) {
		return undefined;
	}
	return lastSegment.slice(dot + 1).toLowerCase();
}

/** A key-sorted plain record from a HashMap, for deterministic downstream hashing. */
function sortedRecord(map: HashMap.HashMap<string, string>): Readonly<Record<string, string>> {
	const entries = [...HashMap.entries(map)].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return Object.fromEntries(entries);
}

/** The highest-ranked defined candidate, with its source. */
function pick<A>(candidates: ReadonlyArray<readonly [A | undefined, ProvenanceSource]>): Provenanced<A> | undefined {
	for (const [value, source] of candidates) {
		if (value !== undefined) {
			return { value, source };
		}
	}
	return undefined;
}

/**
 * Resolve a bundle's layers into a {@link ResolvedBundle}, pure.
 *
 * @remarks
 * Highest tier wins per FIELD: `manifest.platform` → `manifest.leaf` →
 * `manifest.project` → `packageJson` → `apiModel` → `inferred`. The project
 * tier participates only in the fields it carries site/project identity for
 * (tagline); the display `name` chain deliberately skips it — a project name
 * outranking every leaf's own name would render each package in a monorepo
 * under the same title, and the spec's `og:title` derivation reads
 * `leaf name/tagline ← package name`. Inference (image `alt` and MIME
 * `type`) runs on the RESOLVED tagline/description, so a tagline change at
 * any tier propagates into inferred alt text.
 *
 * @public
 */
export function resolveBundle(input: ResolveBundleInput): ResolvedBundle {
	const platform = input.platform;
	const leaf = input.manifest;
	const project = leaf?.project;
	const packageJson = input.packageJson;

	const name = pick<string>([
		[platform?.name, "manifest.platform"],
		[leaf?.name, "manifest.leaf"],
		[packageJson?.name, "packageJson"],
		[input.apiModel.name, "apiModel"],
	]) as Provenanced<string>;

	const tagline = pick<string>([
		[platform?.tagline, "manifest.platform"],
		[leaf?.tagline, "manifest.leaf"],
		[project?.tagline, "manifest.project"],
	]);

	const description = pick<string>([
		[platform?.description, "manifest.platform"],
		[leaf?.description, "manifest.leaf"],
		[packageJson?.description, "packageJson"],
	]);

	const version =
		packageJson?.version !== undefined
			? ({ value: String(packageJson.version), source: "packageJson" } satisfies Provenanced<string>)
			: undefined;

	const projectIdentity =
		project !== undefined
			? ({ value: project, source: "manifest.project" } satisfies Provenanced<ProjectIdentity>)
			: undefined;

	const sbom = pick<SbomRef>([
		[platform?.sbom, "manifest.platform"],
		[leaf?.sbom, "manifest.leaf"],
	]);

	const registries = pick<ReadonlyArray<RegistryRef>>([
		[platform?.registries, "manifest.platform"],
		[leaf?.registries, "manifest.leaf"],
	]);

	const openGraphRaw = pick([
		[platform?.openGraph, "manifest.platform"],
		[leaf?.openGraph, "manifest.leaf"],
	] as ReadonlyArray<readonly [BundleManifest["openGraph"], ProvenanceSource]>);

	const inferredAlt = (): Provenanced<string> => {
		if (tagline !== undefined) {
			return { value: tagline.value, source: "inferred" };
		}
		if (description !== undefined) {
			return { value: description.value, source: "inferred" };
		}
		return { value: `${name.value} API documentation`, source: "inferred" };
	};

	const openGraph =
		openGraphRaw !== undefined
			? ({
					value: {
						images: (openGraphRaw.value.images ?? []).map((image): ResolvedOpenGraphImage => {
							const location = image.path ?? image.url ?? "";
							const extension = imageExtension(location);
							const inferredType = extension !== undefined ? IMAGE_MIME_BY_EXTENSION[extension] : undefined;
							const type: Provenanced<string> | undefined =
								image.type !== undefined
									? { value: image.type, source: openGraphRaw.source }
									: inferredType !== undefined
										? { value: inferredType, source: "inferred" }
										: undefined;
							const alt: Provenanced<string> =
								image.alt !== undefined ? { value: image.alt, source: openGraphRaw.source } : inferredAlt();
							return {
								...(image.path !== undefined ? { path: image.path } : {}),
								...(image.url !== undefined ? { url: image.url } : {}),
								...(type !== undefined ? { type } : {}),
								...(image.width !== undefined ? { width: image.width } : {}),
								...(image.height !== undefined ? { height: image.height } : {}),
								alt,
							};
						}),
						...(openGraphRaw.value.themeColor !== undefined ? { themeColor: openGraphRaw.value.themeColor } : {}),
					},
					source: openGraphRaw.source,
				} satisfies Provenanced<ResolvedOpenGraph>)
			: undefined;

	const dependencies =
		packageJson !== undefined
			? ({ value: sortedRecord(packageJson.dependencies), source: "packageJson" } satisfies Provenanced<
					Readonly<Record<string, string>>
				>)
			: undefined;

	const peerDependencies =
		packageJson !== undefined
			? ({ value: sortedRecord(packageJson.peerDependencies), source: "packageJson" } satisfies Provenanced<
					Readonly<Record<string, string>>
				>)
			: undefined;

	const compilerOptions =
		input.tsconfig !== undefined
			? ({ value: input.tsconfig.compilerOptions, source: "tsconfig" } satisfies Provenanced<CompilerOptions.Type>)
			: undefined;

	return {
		name,
		...(version !== undefined ? { version } : {}),
		...(tagline !== undefined ? { tagline } : {}),
		...(description !== undefined ? { description } : {}),
		...(projectIdentity !== undefined ? { project: projectIdentity } : {}),
		...(openGraph !== undefined ? { openGraph } : {}),
		...(sbom !== undefined ? { sbom } : {}),
		...(registries !== undefined ? { registries } : {}),
		...(dependencies !== undefined ? { dependencies } : {}),
		...(peerDependencies !== undefined ? { peerDependencies } : {}),
		...(compilerOptions !== undefined ? { compilerOptions } : {}),
	};
}

/**
 * Resolve a read {@link Bundle}, unwrapping its `Option` layers.
 *
 * @public
 */
export function resolveBundleFrom(bundle: Bundle, platform?: PlatformOverrides): ResolvedBundle {
	return resolveBundle({
		apiModel: bundle.apiModel,
		...(Option.isSome(bundle.packageJson) ? { packageJson: bundle.packageJson.value } : {}),
		...(Option.isSome(bundle.tsconfig) ? { tsconfig: bundle.tsconfig.value } : {}),
		...(Option.isSome(bundle.manifest) ? { manifest: bundle.manifest.value } : {}),
		...(platform !== undefined ? { platform } : {}),
	});
}
