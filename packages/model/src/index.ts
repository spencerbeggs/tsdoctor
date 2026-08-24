/**
 * `@tsdoctor/model` — framework-neutral analysis and rendering of Microsoft
 * API Extractor models: Effect-typed model loading, pure TSDoc extraction,
 * categorization, multi-entry resolution, route/collision computation,
 * synthetic-base detection, signature formatting, prose cross-linking and
 * markdown rendering.
 *
 * @packageDocumentation
 */

export * as ApiItems from "./ApiItems.js";
export { CrossLinker } from "./CrossLinker.js";
export * as EntryPoints from "./EntryPoints.js";
export * as Model from "./Model.js";
export * as Render from "./Render.js";
export * as Routes from "./Routes.js";
export * as Signature from "./Signature.js";
export * as StructuredData from "./StructuredData.js";
export * as SyntheticBases from "./SyntheticBases.js";
export * as Tsdoc from "./Tsdoc.js";
export type {
	ApiItemRef,
	DocMeta,
	FrontmatterRenderer,
	ItemKindSlug,
	RenderPackageOptions,
	RenderedDoc,
	RouteFormatter,
} from "./types.js";
