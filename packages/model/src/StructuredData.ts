/**
 * Phase-4 seam: schema.org JSON-LD derivation from the API model plus the
 * package manifest. The signature is reserved here so adapters have a stable
 * import site to build against; the derivation itself lands in phase 4
 * (`SoftwareSourceCode` / `TechArticle` / `APIReference` mapping, license
 * expressions via `@effected/spdx` — already validated by
 * `@effected/package-json`, never re-validated here).
 *
 * @packageDocumentation
 */

import type { PackageManifest } from "@effected/package-json";
import type { ApiPackage } from "@microsoft/api-extractor-model";

/**
 * A schema.org JSON-LD graph.
 *
 * @alpha
 */
export interface StructuredDataGraph {
	readonly "@context": "https://schema.org";
	readonly "@graph": ReadonlyArray<Record<string, unknown>>;
}

/**
 * Derive schema.org structured data for a documented package.
 *
 * @remarks
 * Not implemented yet — this is the phase-4 seam. Calling it throws.
 *
 * @alpha
 */
export function derive(_apiPackage: ApiPackage, _manifest: PackageManifest): StructuredDataGraph {
	throw new Error("@tsdoctor/model: StructuredData.derive is a phase-4 seam and is not implemented yet");
}
