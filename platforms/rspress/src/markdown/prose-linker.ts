/**
 * Per-build prose cross-linker holder. Adapter wiring, not logic: the build
 * program installs the immutable `@tsdoctor/model` CrossLinker built from the
 * routes `prepareWorkItems` computed, and page generators link prose through
 * it. Page generators run synchronously outside any service context, hence
 * the module-level holder (the same shape as the sync-island event emitters).
 */

import { CrossLinker } from "@tsdoctor/model";

let current: CrossLinker = CrossLinker.empty;

/** Install the cross-linker for the current API build from its route map. */
export function setProseLinker(routes: ReadonlyMap<string, string>): void {
	current = CrossLinker.fromRoutes(routes);
}

/** Reset to the identity linker (tests, teardown). */
export function clearProseLinker(): void {
	current = CrossLinker.empty;
}

/** Cross-link prose text with the currently installed linker. */
export function linkProse(text: string): string {
	return current.link(text);
}
