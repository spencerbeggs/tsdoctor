/**
 * VFS Registry - Module-scoped registry for Virtual File System data.
 *
 * Per-API-scope rendering configuration — the highlighter, cross-linker and
 * Shiki transformers a remark plugin needs to render a code block. Written in
 * `config()` (via `build-program.ts`) and read during MDX compilation, which
 * runs outside any Effect fiber, hence the module-level map.
 *
 * It does NOT hold a virtual file system despite the name. It carried a `vfs`
 * field until Chunk 2; the only production write was an empty `Map` and there
 * were no reads — the real VFS lives in the Twoslash environments that
 * `TwoslashManager` builds. The name is kept because the remark plugins and
 * design docs refer to it.
 *
 * @packageDocumentation
 */

import type { Highlighter, ShikiTransformer } from "shiki";
import type { ShikiThemeConfig } from "./markdown/shiki-utils.js";
import type { ShikiCrossLinker } from "./shiki-transformer.js";

/**
 * Configuration stored for each API in the registry.
 */
export interface VfsConfig {
	/** Shiki highlighter instance */
	highlighter: Highlighter;
	/** Transformer for Twoslash type information */
	twoslashTransformer?: ShikiTransformer;
	/** Cross-linker instance for post-processing HAST (replaces crossLinkTransformer) */
	crossLinker?: ShikiCrossLinker;
	/** Transformer for hiding context lines in member signatures */
	hideCutTransformer?: ShikiTransformer;
	/** Transformer for hiding cut directive and preceding import lines */
	hideCutLinesTransformer?: ShikiTransformer;
	/** Package name for the API */
	packageName: string;
	/** API scope identifier (e.g., "claude-binary-plugin") */
	apiScope: string;
	/** Theme configuration for Shiki highlighting */
	theme?: ShikiThemeConfig;
}

/**
 * Module-scoped registry for VFS configurations.
 *
 * This is a singleton registry that stores VFS data keyed by:
 * - API scope (e.g., "claude-binary-plugin")
 *
 * The registry is designed to be:
 * - Written to during `beforeBuild` (when VFS is generated)
 * - Read from during MDX compilation (when remark plugin transforms code blocks)
 * - Thread-safe for reads (VFS is immutable after registration)
 */
class VfsRegistryImpl {
	/**
	 * Map of API scope to VFS configuration
	 */
	private readonly configs = new Map<string, VfsConfig>();

	/**
	 * Register a VFS configuration for an API scope.
	 *
	 * @param apiScope - The API scope identifier (e.g., "claude-binary-plugin")
	 * @param config - The VFS configuration to register
	 */
	register(apiScope: string, config: VfsConfig): void {
		this.configs.set(apiScope, config);
	}

	/**
	 * Get the VFS configuration for an API scope.
	 *
	 * @param apiScope - The API scope to look up
	 * @returns The VFS configuration, or undefined if not found
	 */
	get(apiScope: string): VfsConfig | undefined {
		return this.configs.get(apiScope);
	}

	/**
	 * Check if any VFS configurations are registered.
	 *
	 * @returns True if at least one configuration is registered
	 */
	hasConfigs(): boolean {
		return this.configs.size > 0;
	}

	/**
	 * Get all registered API scopes.
	 *
	 * @returns Array of registered API scope identifiers
	 */
	getScopes(): string[] {
		return Array.from(this.configs.keys());
	}

	/**
	 * Clear all registered configurations.
	 *
	 * This should be called between builds to avoid stale data.
	 */
	clear(): void {
		this.configs.clear();
	}
}

/**
 * Global VFS Registry singleton instance.
 *
 * Use this to register and retrieve VFS configurations:
 *
 * @example
 * ```ts
 * // In beforeBuild hook:
 * VfsRegistry.register("claude-binary-plugin", {
 *   highlighter,
 *   twoslashTransformer,
 *   crossLinker: shikiCrossLinker,
 *   packageName: "claude-binary-plugin",
 *   apiScope: "claude-binary-plugin",
 * });
 *
 * // In remark plugin:
 * const config = VfsRegistry.get(apiScope);
 * if (config) {
 *   // Generate HAST with Shiki, then post-process with cross-linker
 *   let hast = await generateShikiHast(code, config.highlighter, transformers);
 *   if (hast && config.crossLinker) {
 *     hast = config.crossLinker.transformHast(hast, config.apiScope);
 *   }
 * }
 * ```
 */
export const VfsRegistry: VfsRegistryImpl = new VfsRegistryImpl();
