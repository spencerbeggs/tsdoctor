/**
 * Shared loader for the kitchensink API model fixture. The fixture is a real
 * `.api.json` (schema 1011) generated from a TypeScript surface exercising every
 * feature, so the tsdoc helpers run against genuinely-parsed model data — the
 * same path production uses via loadApiModel.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiItem, ApiPackage } from "@microsoft/api-extractor-model";
import { ApiModel } from "@microsoft/api-extractor-model";

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(here, "..", "fixtures", "kitchensink.api.json");

let cached: ApiPackage | undefined;

/** Load the kitchensink package once and reuse it across tests. */
export function loadKitchensink(): ApiPackage {
	if (!cached) cached = new ApiModel().loadPackage(FIXTURE);
	return cached;
}

/** Depth-first search for the first item with the given display name. */
export function findItem(name: string): ApiItem {
	const stack: ApiItem[] = [loadKitchensink()];
	while (stack.length > 0) {
		const item = stack.pop() as ApiItem;
		if (item.displayName === name) return item;
		stack.push(...item.members);
	}
	throw new Error(`item not found in kitchensink fixture: ${name}`);
}
