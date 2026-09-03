/* v8 ignore start -- re-export barrel, no testable logic */

export type { OpenGraphImageConfig, OpenGraphImageMetadata, OpenGraphMetadata } from "@tsdoctor/seo";
export type { BaseRoute, DirInfo, FromDirOptions } from "./config-helpers.js";
export type { LoadedModel } from "./internal-types.js";
export { ApiExtractorPlugin } from "./plugin.js";
export type {
	CategoryConfig,
	MultiApiConfig,
	PluginOptions as ApiExtractorPluginOptions,
	SingleApiConfig,
	SourceConfig,
	VersionConfig,
} from "./schemas/config.js";
export { DEFAULT_CATEGORIES } from "./schemas/config.js";
export type { ResolvedServeConfig, ServeMode, ServeOptions } from "./serve.js";
export { isServerReady, resolveServeConfig, serve } from "./serve.js";
