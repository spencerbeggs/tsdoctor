/**
 * Shared loaders for the API model fixtures — byte-identical copies of the
 * ones `@tsdoctor/pages` tests build from, so the emitter is characterized
 * over the same pages.
 */

import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ApiItem, ApiPackage } from "@microsoft/api-extractor-model";
import { ApiModel } from "@microsoft/api-extractor-model";
import { CrossLinker } from "@tsdoctor/model";
import type { Page } from "@tsdoctor/pages";
import { buildPage, prepareWorkItems } from "@tsdoctor/pages";
import { Effect, Option } from "effect";

import { DEFAULT_CATEGORIES } from "../../src/Categories.js";

const here = dirname(fileURLToPath(import.meta.url));

const cache = new Map<string, ApiPackage>();

/** Load a fixture package once and reuse it across tests. */
export function loadFixture(name: string): ApiPackage {
	let pkg = cache.get(name);
	if (!pkg) {
		pkg = new ApiModel().loadPackage(join(here, "..", "fixtures", `${name}.api.json`));
		cache.set(name, pkg);
	}
	return pkg;
}

/** Every page the fixture builds under `/api`, keyed by display name (qualified for namespace members). */
export async function buildFixturePages(name: string): Promise<Map<string, Page>> {
	const apiPackage = loadFixture(name);
	const prepared = prepareWorkItems({ apiPackage, categories: DEFAULT_CATEGORIES, baseRoute: "/api" });
	const linker = CrossLinker.fromRoutes(prepared.crossLinkData.routes);
	const pages = new Map<string, Page>();
	for (const workItem of prepared.workItems) {
		const built = await Effect.runPromise(
			buildPage({
				item: workItem.item,
				categoryKey: workItem.categoryKey,
				singularName: workItem.categoryConfig.singularName,
				folderName: workItem.categoryConfig.folderName,
				baseRoute: "/api",
				packageName: apiPackage.displayName,
				namespaceMember: workItem.namespaceMember,
				availableFrom: workItem.availableFrom,
				syntheticBase: workItem.syntheticBase,
				memberAnchors: workItem.memberAnchors,
				linker,
			}),
		);
		if (Option.isSome(built)) {
			pages.set(workItem.namespaceMember?.qualifiedName ?? workItem.item.displayName, built.value);
		}
	}
	return pages;
}

/** The first top-level item with the given name and kind. */
export function findItem(pkg: ApiPackage, name: string, kind: string): ApiItem {
	const item = pkg.entryPoints[0]?.members.find((m) => m.displayName === name && m.kind === kind);
	if (!item) throw new Error(`fixture has no ${kind} named ${name}`);
	return item;
}
