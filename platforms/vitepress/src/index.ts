/**
 * `vitepress-plugin-api-extractor` — the VitePress adapter over the
 * `@tsdoctor/*` core: generates markdown API pages from an API Extractor
 * bundle through the `@tsdoctor/pages` IR, renders the sidebar from its
 * navigation tree, and type-checks the generated code blocks with Twoslash
 * over the same virtual file system the RSPress plugin resolves.
 *
 * @packageDocumentation
 */

export type { ApiExtractorOptions, ApiExtractorResult } from "./ApiExtractor.js";
export { apiExtractor } from "./ApiExtractor.js";
export type { CategoryConfig } from "./Categories.js";
export { DEFAULT_CATEGORIES } from "./Categories.js";
export type { FrontmatterInput, HeadConfig } from "./emit/frontmatter.js";
export { emitFrontmatter, headConfig } from "./emit/frontmatter.js";
export {
	TWOSLASH_META,
	emitMarkdownBody,
	markdownBlockTree,
	markdownTree,
} from "./emit/markdown.js";
export type { SidebarItem, SidebarMulti } from "./emit/sidebar.js";
export { sidebarFor, sidebarItems } from "./emit/sidebar.js";
export type { GenerateInput, GenerateResult, GenerateServices } from "./Generate.js";
export { generate } from "./Generate.js";
export type { ExternalPackage, ExternalTypesReport } from "./Registry.js";
export { TSDOCTOR_NAMESPACE, externalPackagesOf, loadExternalTypes } from "./Registry.js";
export type { TwoslashTransformerOptions } from "./Twoslash.js";
export { environmentHash, makeTwoslashTransformer } from "./Twoslash.js";
export type { TwoslashCacheReport, TwoslashCacheStoreShape } from "./TwoslashCache.js";
export { TwoslashCacheStore } from "./TwoslashCache.js";
