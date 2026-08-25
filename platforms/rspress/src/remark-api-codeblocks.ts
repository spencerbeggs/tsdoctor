/* v8 ignore start -- remark plugin, requires MDX compilation context */
/**
 * Remark plugin for on-demand API code block rendering.
 *
 * This plugin transforms JSX component nodes (ApiSignature, ApiMember, ApiExample)
 * emitted by page generators into rendered HAST during MDX compilation. It reads
 * `source` and `apiScope` props, runs Shiki with appropriate transformers, and
 * injects the resulting HAST as a base64-encoded prop for browser rendering.
 *
 * @packageDocumentation
 */

import type { Root } from "mdast";
import type { MdxJsxAttributeValueExpression, MdxJsxFlowElement } from "mdast-util-mdx-jsx";
import type { ShikiTransformer } from "shiki";
import type { Plugin } from "unified";
import { visit } from "unist-util-visit";
import { generateShikiHast } from "./markdown/shiki-utils.js";
import type { CodeBlockComponent, PluginEvent } from "./observability/events.js";
import { PluginEvent as PE } from "./observability/events.js";
import { createTwoslashTimingWrapper } from "./twoslash-timing-wrapper.js";
import { TwoslashManager } from "./twoslash-transformer.js";
import { VfsRegistry } from "./vfs-registry.js";

/** Module-level emitter injected by plugin.ts at startup. */
let emitEvent: (event: PluginEvent) => void = () => {};
let currentBuildId = "";
let currentSlowCodeBlockMs = Number.POSITIVE_INFINITY;
export function setRemarkApiCodeblocksEventEmitter(
	fn: (event: PluginEvent) => void,
	buildId = "",
	slowCodeBlockMs = Number.POSITIVE_INFINITY,
): void {
	emitEvent = fn;
	currentBuildId = buildId;
	currentSlowCodeBlockMs = slowCodeBlockMs;
}

/**
 * Create an MDX JSX attribute value expression with proper estree AST.
 * This ensures the value is properly serialized as a JavaScript string literal.
 *
 * @param value - The string value to wrap
 * @returns An MdxJsxAttributeValueExpression node
 */
function createExpressionValue(value: string): MdxJsxAttributeValueExpression {
	// Escape the value for JSON to handle special characters
	const escaped = JSON.stringify(value);

	return {
		type: "mdxJsxAttributeValueExpression",
		value: escaped,
		data: {
			estree: {
				type: "Program",
				sourceType: "module",
				body: [
					{
						type: "ExpressionStatement",
						expression: {
							type: "Literal",
							value: value,
							raw: escaped,
						},
					},
				],
			},
		},
	};
}

/**
 * Extract a string value from a JSX attribute on an MdxJsxFlowElement.
 * Handles both plain string attributes and expression attributes with estree literals.
 *
 * @param node - The JSX element node
 * @param attrName - The attribute name to extract
 * @returns The string value, or undefined if not found
 */
function getJsxAttrStringValue(node: MdxJsxFlowElement, attrName: string): string | undefined {
	for (const attr of node.attributes) {
		if (attr.type !== "mdxJsxAttribute" || attr.name !== attrName) continue;

		// Plain string value: memberName="constructor"
		if (typeof attr.value === "string") return attr.value;

		// Expression value: code={${JSON.stringify(value)}}
		if (attr.value?.type === "mdxJsxAttributeValueExpression" && attr.value.data?.estree) {
			// biome-ignore lint/suspicious/noExplicitAny: estree types are complex and vary across versions
			const body = (attr.value.data.estree as any).body;
			if (body?.length > 0 && body[0].type === "ExpressionStatement") {
				const expr = body[0].expression;
				if (expr.type === "Literal" && typeof expr.value === "string") {
					return expr.value;
				}
			}
		}
	}
	return undefined;
}

/**
 * Remove named attributes from a JSX element node.
 *
 * @param node - The JSX element node
 * @param attrNames - Array of attribute names to remove
 */
function removeJsxAttrs(node: MdxJsxFlowElement, attrNames: string[]): void {
	const removeSet = new Set(attrNames);
	node.attributes = node.attributes.filter((attr) => {
		if (attr.type !== "mdxJsxAttribute") return true;
		return !removeSet.has(attr.name);
	});
}

/**
 * Remark plugin that processes API JSX components for browser rendering.
 *
 * This plugin:
 * 1. Visits JSX component nodes (ApiSignature, ApiMember, ApiExample) in the MDX tree
 * 2. Reads `source` and `apiScope` props emitted by page generators
 * 3. Looks up VFS configuration and runs Shiki with appropriate transformers
 * 4. Injects the resulting HAST as a base64-encoded `hast` prop
 * 5. Removes build-time `source` and `apiScope` props
 *
 * In SSG-MD mode, the plugin simply removes build-time props and lets the
 * components render their own clean HTML for markdown conversion.
 */
export const remarkApiCodeblocks: Plugin<[undefined?], Root> = () => {
	return async function remarkTransformer(tree: Root, file: { path?: string; cwd?: string }): Promise<void> {
		// Skip if no VFS configs are registered (plugin not initialized)
		if (!VfsRegistry.hasConfigs()) {
			return;
		}

		const promises: Array<Promise<void>> = [];

		// Detect if we're in SSG-MD (node_md) compilation environment
		const isSsgMd =
			import.meta.env?.SSG_MD ||
			process.env.RSBUILD_ENVIRONMENT === "node_md" ||
			process.env.BUILD_TARGET === "node_md";

		// Get file path for logging
		const currentFilePath = file.path || "unknown";

		// Step 1b: wire file path into TwoslashManager so TwoslashDiagnostic.file carries real paths
		if (file.path) {
			TwoslashManager.getInstance().setCurrentFile(file.path);
		}

		// Visit JSX component nodes (ApiSignature, ApiMember, ApiExample)
		// These are emitted by page generators with `source` and `apiScope` props
		// that need Shiki processing and HAST injection for browser rendering
		const jsxComponentNames = new Set(["ApiSignature", "ApiMember", "ApiExample"]);

		visit(tree, "mdxJsxFlowElement", (node: MdxJsxFlowElement) => {
			if (!node.name || !jsxComponentNames.has(node.name)) {
				return;
			}

			// Extract source and apiScope attributes
			const source = getJsxAttrStringValue(node, "source");
			const apiScopeValue = getJsxAttrStringValue(node, "apiScope");

			// Skip if no source/apiScope (component doesn't need Shiki processing)
			if (!source || !apiScopeValue) {
				return;
			}

			const promise = (async () => {
				if (isSsgMd) {
					// SSG-MD mode: Remove build-time props, component handles its own SSG-MD rendering
					removeJsxAttrs(node, ["source", "apiScope"]);
					return;
				}

				// Look up VFS config
				const vfsConfig = VfsRegistry.get(apiScopeValue);
				if (!vfsConfig) {
					emitEvent(
						PE.ConfigCascadeWarning({
							ctx: { buildId: currentBuildId, file: currentFilePath },
							field: "vfs",
							chosen: apiScopeValue,
							ignored: [],
							level: "warn",
						}),
					);
					removeJsxAttrs(node, ["source", "apiScope"]);
					return;
				}

				// Build transformers based on component type
				const transformers: ShikiTransformer[] = [];

				// Per-block Twoslash attribution. The wrapper is created fresh for each
				// block so the accumulator below cannot be raced by the sibling blocks
				// this plugin renders concurrently; it delegates to the shared
				// transformer instance, so the TypeScript environment cache is still
				// reused across blocks.
				let twoslashMs = 0;

				if (node.name === "ApiExample" && vfsConfig.twoslashTransformer) {
					// Examples get Twoslash for type information
					transformers.push(
						createTwoslashTimingWrapper(vfsConfig.twoslashTransformer, (duration) => {
							twoslashMs += duration;
						}),
					);
				} else if (node.name === "ApiMember" && vfsConfig.hideCutTransformer) {
					// Member signatures get hide-cut transformer (hides class wrapper + imports)
					transformers.push(vfsConfig.hideCutTransformer);
				} else if (node.name === "ApiSignature") {
					if (vfsConfig.hideCutLinesTransformer) {
						// Full signatures get hide-cut-lines transformer (hides imports + cut directive)
						transformers.push(vfsConfig.hideCutLinesTransformer);
					}
				}

				// Generate HAST.
				//
				// Timing note: `unist-util-visit` is synchronous, so every block's IIFE
				// on a page is started before any of them resumes from an `await`. A
				// span measured ACROSS the await therefore reports the whole page's
				// batch window, not this block's cost — which is why the earlier
				// wall-clock attempt reported a near-identical duration for every block
				// on a page. `highlighter.codeToHast` is synchronous, so the render work
				// happens during the synchronous prefix of `generateShikiHast`, before
				// it yields: measuring around the CALL (not the await) captures this
				// block's real cost and keeps the numbers additive.
				const isExample = node.name === "ApiExample" && !!vfsConfig.twoslashTransformer;
				const shikiStart = performance.now();
				const hastPromise = generateShikiHast(
					source,
					vfsConfig.highlighter,
					transformers.length > 0 ? transformers : undefined,
					isExample,
					vfsConfig.theme,
				);
				const renderMs = performance.now() - shikiStart;
				let hast = await hastPromise;

				// Post-process with cross-linker (synchronous)
				const postStart = performance.now();
				if (hast && vfsConfig.crossLinker) {
					hast = vfsConfig.crossLinker.transformHast(hast, apiScopeValue);
				}
				const postMs = performance.now() - postStart;

				// Attribute this block. Twoslash runs entirely inside the transformer's
				// `preprocess` hook, so the Shiki share is the render call minus that.
				const totalBlockTime = renderMs + postMs;
				emitEvent(
					PE.CodeBlockProcessed({
						ctx: { buildId: currentBuildId, apiScope: apiScopeValue, file: currentFilePath },
						lang: "typescript",
						component: node.name as CodeBlockComponent,
						twoslash: isExample,
						twoslashMs,
						shikiMs: Math.max(0, renderMs - twoslashMs),
						totalMs: totalBlockTime,
						slow: totalBlockTime > currentSlowCodeBlockMs,
						level: "debug",
					}),
				);

				// Inject hast attribute (base64-encoded)
				const hastBase64 = hast ? Buffer.from(JSON.stringify(hast), "utf-8").toString("base64") : "";
				node.attributes.push({
					type: "mdxJsxAttribute",
					name: "hast",
					value: createExpressionValue(hastBase64),
				});

				// Remove build-time props (source and apiScope are consumed by the remark plugin)
				removeJsxAttrs(node, ["source", "apiScope"]);
			})();

			promises.push(promise);
		});

		await Promise.all(promises);
	};
};
