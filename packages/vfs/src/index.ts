export { TsConfigParseError, parseTsConfig } from "./TsconfigParser.js";
export { TsEnvironment, TsEnvironmentError, type TsEnvironmentOptions } from "./TsEnvironment.js";
export {
	TWOSLASH_CACHE_FORMAT,
	type TwoslashCacheStats,
	type TwoslashCacheValue,
	type TwoslashResultCache,
	decodeTwoslashCache,
	encodeTwoslashCache,
	makeTwoslashCache,
	twoslashBlobKey,
	twoslashEntryKey,
	twoslashEnvHash,
} from "./TwoslashCache.js";
export {
	TypeResolutionCompilerOptions,
	decodeCompilerOptions,
	toProgrammaticCompilerOptions,
} from "./TypeResolutionOptions.js";
export {
	type CompilerOptionsInput,
	DEFAULT_COMPILER_OPTIONS,
	type TypeScriptConfig,
	mergeCompilerOptions,
	resolveTypeScriptConfig,
	resolveTypeScriptConfigSingle,
	resolveTypeScriptConfigSingleAsync,
} from "./TypeScriptConfig.js";
export { type Vfs, isTypeDefinition, mergeVfs, prefixVfs } from "./Vfs.js";
export { VirtualPackage } from "./VirtualPackage.js";
