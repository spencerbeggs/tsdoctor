/**
 * Shared loader for the kitchensink API model fixture — a byte-identical copy
 * of the one `@tsdoctor/model` tests run against, so the characterization of
 * the IR's markdown emitter against `Render.tree` reads the same model.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiPackage } from "@microsoft/api-extractor-model";
import { ApiModel } from "@microsoft/api-extractor-model";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "fixtures", "kitchensink.api.json");

let cached: ApiPackage | undefined;

/** Load the kitchensink package once and reuse it across tests. */
export function loadKitchensink(): ApiPackage {
	if (!cached) cached = new ApiModel().loadPackage(FIXTURE);
	return cached;
}
