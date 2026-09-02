/**
 * `@tsdoctor/model` — framework-neutral analysis and rendering of Microsoft
 * API Extractor models: Effect-typed model loading, pure TSDoc extraction,
 * categorization, multi-entry resolution, route/collision computation,
 * synthetic-base detection, signature formatting, prose cross-linking and
 * markdown rendering.
 *
 * @packageDocumentation
 */

export { ApiExtractedPackage } from "./ApiExtractedPackage.js";
export * as ApiItems from "./ApiItems.js";
export { CrossLinker } from "./CrossLinker.js";
export * as EntryPoints from "./EntryPoints.js";
export {
	type ParsedFrontmatter,
	emitFrontmatterBlock,
	parseFrontmatter,
	stringifyFrontmatter,
} from "./Frontmatter.js";
export * as Model from "./Model.js";
export * as Render from "./Render.js";
export * as Routes from "./Routes.js";
export * as Signature from "./Signature.js";
export * as SyntheticBases from "./SyntheticBases.js";
export * as Tsdoc from "./Tsdoc.js";
export { type ImportStatement, type TypeReference, TypeReferenceExtractor } from "./TypeReferenceExtractor.js";
export type {
	ApiItemRef,
	DocMeta,
	FrontmatterRenderer,
	ItemKindSlug,
	RenderPackageOptions,
	RenderedDoc,
	RouteFormatter,
} from "./types.js";
