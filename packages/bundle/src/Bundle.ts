import type { PackageManifest } from "@effected/package-json";
import { PackageJsonFile } from "@effected/package-json";
import type { ResolvedTsconfig } from "@effected/tsconfig-json";
import { TsconfigLoader } from "@effected/tsconfig-json";
import type { Path } from "effect";
import { Effect, FileSystem, Option, Schema } from "effect";
import type { BundleManifest } from "./BundleManifest.js";
import { BundleManifestError, decodeBundleManifest } from "./BundleManifest.js";

/**
 * The sidecar manifest's file name inside a bundle folder.
 *
 * @public
 */
export const TSDOCTOR_MANIFEST_FILENAME = "tsdoctor.json";

/**
 * The subset of a `<name>.api.json` model this package reads: the package
 * name from the model's own metadata.
 *
 * @remarks
 * Full model loading (entry points, members, TSDoc) is `@tsdoctor/model`'s
 * job — this package deliberately stays free of
 * `@microsoft/api-extractor-model` and reads only what discovery and
 * resolution need.
 *
 * @public
 */
export interface ApiModelInfo {
	/** The documented package's npm name, from the model's `name` field. */
	readonly name: string;
}

/** The minimal api.json shape the layer-0 reader validates. */
const ApiModelHeader = Schema.Struct({
	name: Schema.String,
});

/**
 * Raised when a PRESENT bundle layer file cannot be read, parsed or decoded.
 *
 * @remarks
 * Absence of layers 1–3 is the normal case (layers enrich, never gate) and
 * reads as `Option.none()`, never as this error. A file that exists but is
 * malformed is a real problem worth surfacing, not degrading past. Manifest
 * (layer 3) failures use {@link BundleManifestError} instead, so manifest
 * consumers handle one tag across the file and non-file boundaries.
 *
 * @public
 */
export class BundleLayerError extends Schema.TaggedError<BundleLayerError>()("BundleLayerError", {
	/** Which bundle layer failed. */
	layer: Schema.Literals(["apiModel", "packageJson", "tsconfig"]),
	/** The file that failed. */
	path: Schema.String,
	/** The underlying failure, preserved structurally. */
	cause: Schema.Defect(),
}) {
	override get message(): string {
		return `Failed to read bundle layer "${this.layer}" at ${this.path}`;
	}
}

/**
 * Where a bundle's layer files live: the output of discovery, the input of
 * {@link readBundle}.
 *
 * @remarks
 * `modelPath` is the one required layer; the optional path fields are present
 * iff the corresponding file existed at discovery time. `name` and `version`
 * are pre-parsed during discovery (name from package.json, falling back to
 * the api.json model; version from package.json when present).
 *
 * @public
 */
export interface BundleDescriptor {
	/** Absolute path to the bundle folder. */
	readonly dir: string;
	/** Last path segment of `dir`, e.g. `"kitchensink"`. */
	readonly dirname: string;
	/** The documented package's npm name. */
	readonly name: string;
	/** The package version from package.json, when present. */
	readonly version?: string;
	/** Absolute path to the layer-0 `*.api.json` model. */
	readonly modelPath: string;
	/** Absolute path to the layer-1 package.json, when present. */
	readonly packageJsonPath?: string;
	/** Absolute path to the layer-2 tsconfig.json, when present. */
	readonly tsconfigPath?: string;
	/** Absolute path to the layer-3 tsdoctor.json manifest, when present. */
	readonly manifestPath?: string;
}

/**
 * A bundle with all four layers read into typed structures. Layers 1–3 are
 * `Option`s because their absence is the normal case.
 *
 * @public
 */
export interface Bundle {
	/** The descriptor the bundle was read from. */
	readonly descriptor: BundleDescriptor;
	/** Layer 0: the api.json model header (always present). */
	readonly apiModel: ApiModelInfo;
	/** Layer 1: the package.json manifest, presence-lenient. */
	readonly packageJson: Option.Option<PackageManifest>;
	/** Layer 2: the tsconfig, extends-resolved. */
	readonly tsconfig: Option.Option<ResolvedTsconfig>;
	/** Layer 3: the tsdoctor.json sidecar manifest. */
	readonly manifest: Option.Option<BundleManifest>;
}

/**
 * Read the layer-0 model header — the package name — from a `*.api.json`
 * file.
 *
 * @remarks
 * Parses the whole file as JSON but validates only the `name` field; see
 * {@link ApiModelInfo} for why nothing more is read here.
 *
 * @public
 */
export function readApiModelInfo(
	modelPath: string,
): Effect.Effect<ApiModelInfo, BundleLayerError, FileSystem.FileSystem> {
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const text = yield* fs.readFileString(modelPath);
		const parsed = yield* Effect.try(() => JSON.parse(text) as unknown);
		return yield* Schema.decodeUnknownEffect(ApiModelHeader)(parsed);
	}).pipe(Effect.mapError((cause) => new BundleLayerError({ layer: "apiModel", path: modelPath, cause })));
}

/** Read layer 1 when the descriptor recorded a package.json. */
function readPackageJsonLayer(
	packageJsonPath: string | undefined,
): Effect.Effect<Option.Option<PackageManifest>, BundleLayerError, FileSystem.FileSystem | Path.Path> {
	if (packageJsonPath === undefined) {
		return Effect.succeed(Option.none());
	}
	return Effect.gen(function* () {
		const packageJsonFile = yield* PackageJsonFile.make;
		const manifest = yield* packageJsonFile.readManifest(packageJsonPath);
		return Option.some(manifest);
	}).pipe(Effect.mapError((cause) => new BundleLayerError({ layer: "packageJson", path: packageJsonPath, cause })));
}

/** Read layer 2 when the descriptor recorded a tsconfig.json. */
function readTsconfigLayer(
	tsconfigPath: string | undefined,
): Effect.Effect<Option.Option<ResolvedTsconfig>, BundleLayerError, FileSystem.FileSystem | Path.Path> {
	if (tsconfigPath === undefined) {
		return Effect.succeed(Option.none());
	}
	return TsconfigLoader.resolve(tsconfigPath).pipe(
		Effect.map(Option.some),
		Effect.mapError((cause) => new BundleLayerError({ layer: "tsconfig", path: tsconfigPath, cause })),
	);
}

/** Read layer 3 when the descriptor recorded a tsdoctor.json. */
function readManifestLayer(
	manifestPath: string | undefined,
): Effect.Effect<Option.Option<BundleManifest>, BundleManifestError, FileSystem.FileSystem> {
	if (manifestPath === undefined) {
		return Effect.succeed(Option.none());
	}
	return Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem;
		const text = yield* fs
			.readFileString(manifestPath)
			.pipe(Effect.mapError((cause) => new BundleManifestError({ path: manifestPath, cause })));
		const parsed = yield* Effect.try(() => JSON.parse(text) as unknown).pipe(
			Effect.mapError((cause) => new BundleManifestError({ path: manifestPath, cause })),
		);
		const manifest = yield* decodeBundleManifest(parsed, manifestPath);
		return Option.some(manifest);
	});
}

/**
 * Read all four layers of a discovered bundle into a {@link Bundle}.
 *
 * @remarks
 * Layer 0 is required; layers 1–3 read to `Option.none()` when the
 * descriptor recorded no file for them. A layer file that is present but
 * malformed fails typed ({@link BundleLayerError}, or
 * {@link BundleManifestError} for the manifest) — lenient about absence,
 * strict about shape. `FileSystem` and `Path` stay in the `R` channel;
 * provide the platform layer once at the application boundary.
 *
 * @public
 */
export function readBundle(
	descriptor: BundleDescriptor,
): Effect.Effect<Bundle, BundleLayerError | BundleManifestError, FileSystem.FileSystem | Path.Path> {
	return Effect.gen(function* () {
		const apiModel = yield* readApiModelInfo(descriptor.modelPath);
		const packageJson = yield* readPackageJsonLayer(descriptor.packageJsonPath);
		const tsconfig = yield* readTsconfigLayer(descriptor.tsconfigPath);
		const manifest = yield* readManifestLayer(descriptor.manifestPath);
		return { descriptor, apiModel, packageJson, tsconfig, manifest };
	});
}
