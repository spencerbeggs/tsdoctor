/**
 * Attribution facts derived from a decoded `package.json`: the people, the
 * license, the repository and the keywords a documentation page can credit.
 *
 * @remarks
 * Everything here is total and synchronous. A field that cannot be derived is
 * absent rather than guessed, because every one of these values ends up in
 * markup a crawler reads as authoritative — a fabricated repository URL or a
 * templated license page is worse than no field at all.
 *
 * @packageDocumentation
 */

import type { PackageManifest, Person, Repository, SpdxLicense } from "@effected/package-json";
import { licenseExpressionOf } from "@effected/package-json";
import type { License } from "@effected/spdx";
import { SpdxExpression } from "@effected/spdx";
import { Option } from "effect";

/**
 * The attribution a page can credit, derived from one package manifest.
 *
 * @remarks
 * `licenseIds` and `primaryLicenseId` are deliberately both present.
 * `primaryLicenseId` is absent for an `AND` expression, where every term binds
 * at once and naming one would silently drop a license that legally applies;
 * `licenseIds` always lists every license named. A consumer wanting one value
 * reads `primaryLicenseId` and degrades when it is absent; one that can carry
 * several (schema.org's `license` accepts an array) reads `licenseIds`.
 *
 * @public
 */
export interface AttributionFacts {
	/** The `author` field's name. */
	readonly authorName?: string;
	/** The `author` field's homepage, when it carried one. */
	readonly authorUrl?: string;
	/** Every `maintainers` entry's name, in manifest order. */
	readonly maintainerNames: ReadonlyArray<string>;
	/**
	 * The browsable URL of **this package** within its repository.
	 *
	 * @remarks
	 * `Repository.directoryUrl` when the host's subdirectory convention is
	 * known, falling back to `Repository.browseUrl` otherwise — see
	 * {@link attributionFacts} for why the fallback is deliberate.
	 */
	readonly repositoryUrl?: string;
	/** The `homepage` field, verbatim. */
	readonly homepage?: string;
	/**
	 * Every SPDX identifier the `license` expression names, in written order.
	 * Empty when the manifest carries no license, or one that is not SPDX.
	 */
	readonly licenseIds: ReadonlyArray<string>;
	/**
	 * The single identifier the expression can be said to be under, absent for
	 * an `AND`.
	 */
	readonly primaryLicenseId?: string;
	/**
	 * The canonical SPDX page for {@link AttributionFacts.primaryLicenseId},
	 * absent for a `LicenseRef` or any id outside the catalog.
	 */
	readonly licenseUrl?: string;
	/**
	 * The canonical SPDX page for EVERY license the expression names, in
	 * written order, skipping any that has none.
	 *
	 * @remarks
	 * The plural counterpart to {@link AttributionFacts.licenseUrl}, and the
	 * one a consumer wants when the field it is filling accepts several —
	 * schema.org's `license` does. `licenseUrl` names only the primary, and an
	 * `AND` expression has no primary, so a dual-licensed package reading only
	 * the singular gets nothing at all.
	 *
	 * Shorter than `licenseIds` whenever a named license is outside the SPDX
	 * catalog (a `LicenseRef`), which is why the two are not index-aligned.
	 */
	readonly licenseUrls: ReadonlyArray<string>;
	/** The `keywords` field, verbatim. */
	readonly keywords: ReadonlyArray<string>;
}

/** The license half of the facts, or nothing when there is no SPDX to read. */
function licenseFacts(
	license: SpdxLicense | undefined,
): Pick<AttributionFacts, "licenseIds" | "licenseUrls" | "primaryLicenseId" | "licenseUrl"> {
	if (license == null) return { licenseIds: [], licenseUrls: [] };

	// `licenseExpressionOf` IS the screen for npm's non-SPDX spellings
	// (`UNLICENSED`, `SEE LICENSE IN <file>`): the grammar declines them, so
	// discarding the parse failure answers "is this an expression at all".
	// The hand-rolled list this replaced went stale the day npm admitted a
	// third spelling; a grammar does not.
	const parsed = Option.getOrUndefined(licenseExpressionOf(license));
	if (parsed === undefined) return { licenseIds: [], licenseUrls: [] };

	const entries = SpdxExpression.licensesOf(parsed);
	const licenseIds = entries.map((entry: License) => entry.id);
	// Every entry carries its own `referenceUrl`, so the plural answer needs no
	// string building and no primary — a `LicenseRef` simply drops out.
	const licenseUrls = entries
		.map((entry: License) => Option.getOrUndefined(entry.referenceUrl))
		.filter((url): url is string => url !== undefined);

	const primary = Option.getOrUndefined(SpdxExpression.primaryLicense(parsed));
	if (primary === undefined) return { licenseIds, licenseUrls };

	const referenceUrl = Option.getOrUndefined(primary.referenceUrl);
	return {
		licenseIds,
		licenseUrls,
		primaryLicenseId: primary.id,
		...(referenceUrl !== undefined ? { licenseUrl: referenceUrl } : {}),
	};
}

/**
 * Where this package lives, preferring the precise answer.
 *
 * @remarks
 * `browseUrl` ignores `directory`, so on a monorepo every member reports the
 * repository root — and that URL is exactly what a crawler uses to tell two
 * packages apart. `directoryUrl` is the monorepo-aware form and returns `None`
 * rather than fabricating a path convention for a host it does not recognize
 * (a self-hosted forge, say).
 *
 * The fallback to `browseUrl` on that `None` is deliberate: schema.org's
 * `codeRepository` denotes the REPOSITORY, not the subdirectory, so the root
 * is a *true* location for the package — merely one that does not distinguish
 * it from its siblings. That is precision loss, not a correctness bug, and it
 * beats omitting the field.
 */
const repositoryUrlOf = (repository: Repository): string | undefined =>
	Option.getOrUndefined(Option.orElse(repository.directoryUrl, () => repository.browseUrl));

/**
 * Derive the attribution facts a documentation page can credit from a decoded
 * package manifest.
 *
 * @remarks
 * Total: a manifest carrying none of these fields yields empty arrays and no
 * optional properties, never a failure. Per-field degradation is the contract —
 * an unparseable license drops only the license facts, an unrecognized
 * repository reference drops only the repository URL.
 *
 * @param manifest - the decoded manifest to read
 * @returns the facts, with every underivable field absent
 *
 * @example
 * ```ts
 * import { PackageManifest } from "@effected/package-json";
 * import { attributionFacts } from "@tsdoctor/seo";
 * import { Effect } from "effect";
 *
 * const program = Effect.gen(function* () {
 *   const manifest = yield* PackageManifest.decode({
 *     name: "@scope/pkg",
 *     version: "1.0.0",
 *     license: "MIT",
 *     repository: { url: "github:owner/repo", directory: "packages/pkg" },
 *   });
 *   const facts = attributionFacts(manifest);
 *   console.log(facts.primaryLicenseId, facts.repositoryUrl);
 *   // => "MIT" "https://github.com/owner/repo/tree/HEAD/packages/pkg"
 * });
 * ```
 *
 * @public
 */
export function attributionFacts(manifest: PackageManifest): AttributionFacts {
	const author: Person | undefined = manifest.author;
	const repositoryUrl = manifest.repository === undefined ? undefined : repositoryUrlOf(manifest.repository);

	return {
		...(author !== undefined ? { authorName: author.name } : {}),
		...(author?.url !== undefined ? { authorUrl: author.url } : {}),
		maintainerNames: (manifest.maintainers ?? []).map((person: Person) => person.name),
		...(repositoryUrl !== undefined ? { repositoryUrl } : {}),
		...(manifest.homepage !== undefined ? { homepage: manifest.homepage } : {}),
		...licenseFacts(manifest.license),
		keywords: [...(manifest.keywords ?? [])],
	};
}
