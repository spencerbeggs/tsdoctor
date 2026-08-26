/**
 * schema.org JSON-LD derivation: the mapping from an API model plus its
 * package manifest onto `@effected/schema-org`'s typed nodes.
 *
 * @remarks
 * The vocabulary itself is domain-neutral and lives in the kit. What lives
 * here is only the mapping — which documentation concept becomes which
 * schema.org node, and how the three nodes on a page reference each other.
 *
 * The whole module is total up to one typed failure. Node construction cannot
 * fail: `@effected/schema-org` types every `@id` as a plain string and defers
 * identity validation to `JsonLdDocument.buildResult`, so a malformed id, a duplicate
 * id and a colliding catch-all key all surface in one place, on the error
 * channel, rather than throwing out of a constructor. {@link derive} passes
 * that failure straight through.
 *
 * @packageDocumentation
 */

import type { ConflictingTermError, DuplicateNodeIdError, InvalidNodeIdError, JsonLdNode } from "@effected/schema-org";
import { APIReference, JsonLdDocument, NodeRef, Person, SoftwareSourceCode, TechArticle } from "@effected/schema-org";
import { Result } from "effect";
import type { AttributionFacts } from "./Attribution.js";
import { canonicalUrl } from "./Canonical.js";

/**
 * Every way {@link derive} can fail, all of them identity problems raised by
 * `JsonLdDocument.buildResult`.
 *
 * @public
 */
export type StructuredDataError = ConflictingTermError | DuplicateNodeIdError | InvalidNodeIdError;

/**
 * The facts about a documented package that every page in it shares.
 *
 * @remarks
 * A value of this shape is derived **once per API** and carried across the
 * page pipeline. Deriving it per page would build several hundred identical
 * nodes in a build, and re-run the attribution derivation behind each one.
 *
 * @public
 */
export interface PackageNodeInput {
	/** Site URL prefix, from `deriveSiteUrl`. `""` leaves every id root-relative. */
	readonly siteUrl: string;
	/** The route the package's documentation is mounted at, beginning with `/`. */
	readonly baseRoute: string;
	/** The documented package's npm name. */
	readonly packageName: string;
	/** The package version, when the manifest carried one. */
	readonly version?: string;
	/** The package description, when the manifest carried one. */
	readonly description?: string;
	/** Attribution derived from the manifest via {@link attributionFacts}. */
	readonly attribution: AttributionFacts;
}

/**
 * The facts about one documentation page.
 *
 * @public
 */
export interface PageNodeInput {
	/** Page route path, beginning with `/`. */
	readonly pageRoute: string;
	/** The documented symbol's display name (e.g. `"Pipeline"`). */
	readonly symbolName: string;
	/** Page description, reused as both nodes' `description`. */
	readonly description: string;
	/** Article section label (e.g. `"Classes"`). */
	readonly section: string;
	/** ISO 8601 date string for `datePublished`. */
	readonly publishedTime: string;
	/** ISO 8601 date string for `dateModified`. */
	readonly modifiedTime: string;
}

/**
 * The per-API package facts, resolved once into the nodes every page reuses.
 *
 * @remarks
 * Opaque by intent: build it with {@link packageContext} and carry it, don't
 * assemble one by hand. The whole reason it exists is that the nodes inside it
 * are identical on every page of an API, and rebuilding them per page would
 * mint several hundred copies per build.
 *
 * @public
 */
export interface PackageContext {
	/** The `@id` every page's nodes reference the package by. */
	readonly id: string;
	/** The package node and every person node it credits. */
	readonly nodes: ReadonlyArray<JsonLdNode>;
	/** Carried through so page ids resolve against the same prefix. */
	readonly siteUrl: string;
	/** Carried through for the symbol node's `assemblyVersion`. */
	readonly version?: string;
}

/**
 * The package node's `@id`.
 *
 * @remarks
 * A fragment on the package's own route rather than a bare URL, so the node
 * is distinguishable from the page that happens to sit at that route. Every
 * page in the API references this same id, which is what makes the package
 * node deduplicate across a crawl.
 */
const packageId = (input: PackageNodeInput): string => `${canonicalUrl(input.siteUrl, input.baseRoute)}#source`;

/** An author or maintainer's `@id`, scoped to the package that credits them. */
const personId = (input: PackageNodeInput, name: string): string =>
	`${canonicalUrl(input.siteUrl, input.baseRoute)}#person-${encodeURIComponent(name)}`;

/**
 * The people nodes a package credits, and refs to them.
 *
 * @remarks
 * The author is a `Person` when the manifest named a human and an
 * `Organization` when the name reads as a scope — but npm carries no such
 * distinction, so guessing would be fabrication. Everyone is a `Person`, which
 * is what the manifest field is documented to hold. An organization ends up
 * modelled as a person with an organization's name, which is imprecise rather
 * than wrong; inventing a type from a string's shape would be neither.
 */
function peopleNodes(input: PackageNodeInput): {
	readonly nodes: ReadonlyArray<JsonLdNode>;
	readonly authors: ReadonlyArray<NodeRef>;
} {
	const nodes: JsonLdNode[] = [];
	const authors: NodeRef[] = [];
	const seen = new Set<string>();

	const add = (name: string, url?: string): void => {
		const id = personId(input, name);
		if (seen.has(id)) return;
		seen.add(id);
		nodes.push(
			Person.make({
				"@id": id,
				name,
				...(url !== undefined ? { url } : {}),
			}),
		);
		authors.push(NodeRef.to(id));
	};

	if (input.attribution.authorName !== undefined) {
		add(input.attribution.authorName, input.attribution.authorUrl);
	}
	for (const maintainer of input.attribution.maintainerNames) add(maintainer);

	return { nodes, authors };
}

/**
 * The `SoftwareSourceCode` node for a documented package, plus the people it
 * credits.
 *
 * @remarks
 * Note `version`, not `softwareVersion` — the latter reads like the right name
 * and is defined on `SoftwareApplication`, not here. It would serialize fine
 * and be silently ignored; the conformance validator is what catches it.
 *
 * `license` carries the canonical SPDX page for EVERY license the expression
 * names — schema.org's `license` accepts an array, and an `AND` expression has
 * no single answer to give. The URLs come from each catalog entry's own
 * `referenceUrl`, never from concatenating an id onto
 * `https://spdx.org/licenses/`: that is the string-building the catalog exists
 * to prevent, and it is wrong for a `LicenseRef`, which has no such page. A
 * license outside the catalog drops out of the array rather than appearing as
 * a fabricated URL.
 *
 * @param input - the per-API facts
 * @returns the reusable context every page in the API derives against
 *
 * @public
 */
export function packageContext(input: PackageNodeInput): PackageContext {
	const { nodes: people, authors } = peopleNodes(input);
	const facts = input.attribution;

	const pkg = SoftwareSourceCode.make({
		"@id": packageId(input),
		name: input.packageName,
		url: canonicalUrl(input.siteUrl, input.baseRoute),
		...(input.description !== undefined ? { description: input.description } : {}),
		...(input.version !== undefined ? { version: input.version } : {}),
		...(facts.repositoryUrl !== undefined ? { codeRepository: facts.repositoryUrl } : {}),
		programmingLanguage: ["TypeScript"],
		...(facts.licenseUrls.length > 0 ? { license: [...facts.licenseUrls] } : {}),
		...(authors.length > 0 ? { author: [...authors] } : {}),
		...(facts.keywords.length > 0 ? { keywords: [...facts.keywords] } : {}),
		...(facts.homepage !== undefined ? { sameAs: [facts.homepage] } : {}),
	});

	return {
		id: packageId(input),
		nodes: [pkg, ...people],
		siteUrl: input.siteUrl,
		...(input.version !== undefined ? { version: input.version } : {}),
	};
}

/**
 * Derive the schema.org graph for one documentation page.
 *
 * @remarks
 * Three linked nodes plus the package's people: a `SoftwareSourceCode` for the
 * package, a `TechArticle` for the page, and an `APIReference` for the symbol
 * the page documents. The article `isPartOf` the package and its `mainEntity`
 * is the symbol, so a crawler reading any one node can reach the other two.
 *
 * Serialize the result with `JsonLdDocument.toScriptBody()`, never with
 * `JSON.stringify(graph.toJsonLd())` — `toScriptBody` is the only serializer
 * that escapes the sequences that would close the surrounding `<script>`
 * element, and it is idempotent, so an adapter layering its own escaping over
 * it is a no-op rather than a double-escape.
 *
 * @param pkg - the per-API context from {@link packageContext}
 * @param page - the per-page facts
 * @returns the assembled graph, or the identity failure that stopped it
 *
 * @public
 */
export function derive(pkg: PackageContext, page: PageNodeInput): Result.Result<JsonLdDocument, StructuredDataError> {
	const pageUrl = canonicalUrl(pkg.siteUrl, page.pageRoute);
	const articleId = `${pageUrl}#article`;
	const symbolId = `${pageUrl}#symbol`;

	const symbol = APIReference.make({
		"@id": symbolId,
		name: page.symbolName,
		url: pageUrl,
		description: page.description,
		isPartOf: [NodeRef.to(pkg.id)],
		...(pkg.version !== undefined ? { assemblyVersion: pkg.version } : {}),
		programmingModel: "TypeScript",
	});

	const article = TechArticle.make({
		"@id": articleId,
		name: page.symbolName,
		headline: page.symbolName,
		url: pageUrl,
		description: page.description,
		articleSection: [page.section],
		datePublished: page.publishedTime,
		dateModified: page.modifiedTime,
		isPartOf: [NodeRef.to(pkg.id)],
		mainEntity: NodeRef.to(symbolId),
		inLanguage: "en",
	});

	return JsonLdDocument.buildResult([...pkg.nodes, article, symbol]);
}

/**
 * {@link derive}, serialized to the text an adapter embeds in a `<script>`.
 *
 * @remarks
 * The convenience the adapter actually wants: a page's structured data as a
 * string. Callers that need the graph itself — a conformance check in a test,
 * say — use {@link derive}.
 *
 * @param pkg - the per-API context from {@link packageContext}
 * @param page - the per-page facts
 * @returns the script body, or the identity failure
 *
 * @public
 */
export function deriveScriptBody(pkg: PackageContext, page: PageNodeInput): Result.Result<string, StructuredDataError> {
	return Result.map(derive(pkg, page), (graph) => graph.toScriptBody());
}
