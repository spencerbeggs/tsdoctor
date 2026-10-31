import { PackageExports } from "@effected/package-json";
import { Option, Result, Schema } from "effect";
import { isSafeRelativePath, isTypeDefinition, normalizePath } from "./internal/resolution.js";
import type { PackageManifest } from "./PackageFetcher.js";
import { PackageSpec } from "./PackageSpec.js";

/**
 * A resolved module: the declaration file a specifier resolves to within a
 * package.
 *
 * @public
 */
export class ResolvedModule extends Schema.Class<ResolvedModule>("ResolvedModule")({
	/** The file path relative to the package root (no `./` prefix). */
	filePath: Schema.String,
	/** Whether the path names a TypeScript declaration file. */
	isTypeDefinition: Schema.Boolean,
	/** The package the path belongs to. */
	package: PackageSpec,
}) {}

/**
 * Build a `ResolvedModule` only when the manifest-supplied path stays inside
 * the package: resolved paths reach `PackageFetcher.downloadFile`'s URL and
 * the cache's join, so an absolute or `..`-bearing path from a hostile
 * manifest must not survive resolution.
 */
const safeResolved = (filePath: string, pkg: PackageSpec): Option.Option<ResolvedModule> => {
	const normalized = normalizePath(filePath.replace(/^\.\//, ""));
	if (!isSafeRelativePath(normalized)) return Option.none();
	return Option.some(
		ResolvedModule.make({
			filePath: normalized,
			isTypeDefinition: isTypeDefinition(normalized),
			package: pkg,
		}),
	);
};

/**
 * The declaration path TypeScript reads for a subpath: the first declaration
 * candidate of `@effected/package-json`'s `PackageExports.resolveTypesResult`,
 * or the manifest's own target when no candidate is a declaration file.
 *
 * @remarks
 * `Option.none()` when the manifest does not answer the subpath. Two kit
 * answers are guesses rather than manifest evidence, and are refused the
 * same way: a legacy subpath probing itself (`source: "file"`), and the
 * root falling to the implicit `index.js` when the manifest has no `main`.
 */
const typesPath = (manifest: PackageManifest, subpath: string): Option.Option<string> => {
	const resolved = PackageExports.resolveTypesResult(manifest, subpath);
	if (Result.isFailure(resolved)) return Option.none();
	const target = resolved.success;
	if (target.source === "file") return Option.none();
	if (target.source === "main" && manifest.main === undefined) return Option.none();
	return Option.some(Option.getOrElse(target.declaration, () => target.target));
};

/**
 * Pure `package.json` → declaration-file resolution.
 *
 * @remarks
 * Stateless pure functions — no service, no layer (v3's `Layer.succeed` over
 * stateless functions was ceremony), and no fictional error channel: v3
 * declared a `ResolutionError` its total implementation could never raise.
 * Here {@link TypeResolver.resolveImport} is honest in the other direction
 * too — it returns `Option.none()` where v3 fabricated a guessed fallback
 * path, leaving fallback policy to the caller.
 *
 * Resolution is `@effected/package-json`'s `PackageExports`, TypeScript's
 * reading of a manifest: conditions are walked in the manifest's own key
 * order (`types`, `import` and `default` match), targets go through
 * TypeScript's extension substitution (`./x.js` yields `./x.d.ts`), and
 * `typesVersions` is read only when `exports` is absent. All map inputs are
 * untrusted CDN data; the kit confines every target to the package, guards
 * depth and wildcard counts and reads own keys only, and every resolved path
 * is validated again here before a `ResolvedModule` is constructed.
 *
 * @public
 */
export class TypeResolver {
	private constructor() {}

	/**
	 * Resolve an import specifier (`"zod"`, `"zod/lib/types"`) against a
	 * manifest.
	 *
	 * @remarks
	 * The specifier's subpath resolves through `exports` when present, else
	 * `typesVersions["*"]`, then — for the root — `types`/`typings` and
	 * `main`, each target extension-substituted to the declaration file
	 * TypeScript would read. `Option.none()` when the manifest offers no
	 * evidence for the subpath, or when the evidence names a path outside the
	 * package (hostile manifest — fails closed).
	 */
	static resolveImport(specifier: string, manifest: PackageManifest, pkg: PackageSpec): Option.Option<ResolvedModule> {
		// A name-prefix match must sit on a path boundary: `pkg2` is NOT
		// `pkg` + subpath `2`.
		let subpath: string;
		if (specifier === pkg.name) {
			subpath = ".";
		} else if (specifier.startsWith(`${pkg.name}/`)) {
			subpath = `./${specifier.slice(pkg.name.length + 1)}`;
		} else {
			const bare = specifier.replace(/^\/+/, "");
			subpath = bare === "" || bare === "." ? "." : bare.startsWith("./") ? bare : `./${bare}`;
		}

		return Option.flatMap(typesPath(manifest, subpath), (path) => safeResolved(path, pkg));
	}

	/**
	 * Resolve the manifest's main type entry.
	 *
	 * @remarks
	 * The root subpath as {@link TypeResolver.resolveImport} resolves it, made
	 * total by the documented `index.d.ts` convention floor. A main path that
	 * escapes the package (hostile manifest) also falls to the floor rather
	 * than surviving.
	 */
	static resolveMainEntry(manifest: PackageManifest, pkg: PackageSpec): ResolvedModule {
		const main = Option.flatMap(typesPath(manifest, "."), (path) => safeResolved(path, pkg));
		return Option.getOrElse(main, () =>
			ResolvedModule.make({ filePath: "index.d.ts", isTypeDefinition: true, package: pkg }),
		);
	}

	/**
	 * Enumerate every entry point that exposes type definitions: the main
	 * entry plus each `exports` subpath with a types-bearing condition,
	 * deduplicated by file path.
	 *
	 * @remarks
	 * Subpaths come from `PackageExports.typesEntriesResult`. Pattern entries
	 * (`"./*"`) are skipped: enumeration has no captured segment to
	 * substitute, so a pattern entry would emit a literal `dist/*.d.ts`.
	 * Pattern subpaths resolve through {@link TypeResolver.resolveImport},
	 * which has the concrete specifier. An `exports` map holding an invalid
	 * target fails enumeration as a whole, leaving only the main entry.
	 */
	static resolveTypeEntries(manifest: PackageManifest, pkg: PackageSpec): ReadonlyArray<ResolvedModule> {
		const entries: Array<ResolvedModule> = [TypeResolver.resolveMainEntry(manifest, pkg)];

		const enumerated = PackageExports.typesEntriesResult(manifest);
		if (Result.isSuccess(enumerated)) {
			for (const target of enumerated.success) {
				if (target.pattern) continue;
				const entry = safeResolved(
					Option.getOrElse(target.declaration, () => target.target),
					pkg,
				);
				if (Option.isSome(entry)) entries.push(entry.value);
			}
		}

		const seen = new Set<string>();
		return entries.filter((entry) => {
			// Export conditions fall back to `import`/`default`, which can name
			// JS files or `package.json`; an API that enumerates type
			// definitions must not return those.
			if (!entry.isTypeDefinition) return false;
			if (seen.has(entry.filePath)) return false;
			seen.add(entry.filePath);
			return true;
		});
	}

	/**
	 * The conventional declaration-file path for a JavaScript file path
	 * (`lib/index.js` → `lib/index.d.ts`, `.mjs` → `.d.mts`, `.cjs` →
	 * `.d.cts`).
	 *
	 * @remarks
	 * The input is a tree path from the CDN — untrusted — so a path that is
	 * absolute or escapes the package yields `Option.none()` instead of a
	 * `ResolvedModule` that could reach a download URL.
	 */
	static findTypeDefinition(jsFilePath: string, pkg: PackageSpec): Option.Option<ResolvedModule> {
		let typePath: string;
		if (jsFilePath.endsWith(".mjs")) typePath = jsFilePath.replace(/\.mjs$/, ".d.mts");
		else if (jsFilePath.endsWith(".cjs")) typePath = jsFilePath.replace(/\.cjs$/, ".d.cts");
		else if (jsFilePath.endsWith(".js")) typePath = jsFilePath.replace(/\.js$/, ".d.ts");
		else typePath = `${jsFilePath.replace(/\.(m?js|cjs)$/, "")}.d.ts`;
		return safeResolved(typePath, pkg);
	}
}
