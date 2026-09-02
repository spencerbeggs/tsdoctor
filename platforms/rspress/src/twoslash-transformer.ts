/* v8 ignore start -- Shiki/Twoslash integration, requires full highlighter setup for testing */

import { Markdown, Mdast } from "@effected/markdown";
import type { ProgrammaticCompilerOptions } from "@effected/tsconfig-json";
import { rendererRich, transformerTwoslash } from "@shikijs/twoslash";
import type { TypeResolutionCompilerOptions } from "@tsdoctor/vfs";
import { DEFAULT_COMPILER_OPTIONS, toProgrammaticCompilerOptions } from "@tsdoctor/vfs";
import { Result } from "effect";
import type { ElementContent } from "hast";
import { toHast } from "mdast-util-to-hast";
import type { ShikiTransformer } from "shiki";
import { PluginEvent } from "./observability/events.js";
import { emitSync, syncBuildId } from "./observability/sync-emitter.js";
import type { RegisterEnvironmentOptions } from "./services/TwoslashEnvironments.js";

/**
 * Module-level type routes map for resolving link references.
 * This is set by TwoslashManager.setTypeRoutes() before initialization.
 */
let typeRoutes: Map<string, string> = new Map();

/**
 * Transform TSDoc link tag syntax to markdown links or plain text.
 *
 * Handles various TSDoc link formats:
 * - Simple type reference
 * - Type with pipe-separated display text
 * - Type with space-separated display text
 *
 * Also handles multiline links where the content may be split across lines.
 *
 * @param text - Text containing TSDoc link references
 * @returns Text with links transformed to markdown or plain text
 */
function transformTsDocLinks(text: string): string {
	// Match {@link ...} patterns, including multiline ([\s\S] matches newlines)
	// The content can be: TypeName, TypeName | display, or TypeName display
	return text.replace(/\{@link\s+([\s\S]*?)\}/g, (_match, content: string) => {
		// Normalize whitespace - collapse multiple spaces/newlines to single space
		const normalized = content.replace(/\s+/g, " ").trim();

		if (!normalized) {
			return "";
		}

		// Check for pipe-separated display text: "TypeName | display text"
		const pipeIndex = normalized.indexOf("|");
		let typeName: string;
		let displayText: string;

		if (pipeIndex !== -1) {
			typeName = normalized.substring(0, pipeIndex).trim();
			displayText = normalized.substring(pipeIndex + 1).trim();
		} else {
			// Check for space-separated: "TypeName display text"
			// The type name is the first word (typically PascalCase)
			const spaceIndex = normalized.indexOf(" ");
			if (spaceIndex !== -1 && /^[A-Z]/.test(normalized)) {
				// If starts with capital and has space, first word is likely the type
				typeName = normalized.substring(0, spaceIndex).trim();
				displayText = normalized.substring(spaceIndex + 1).trim();
			} else {
				// Just a type name with no display text
				typeName = normalized;
				displayText = normalized;
			}
		}

		// Look up the route for this type
		const route = typeRoutes.get(typeName);

		if (route) {
			// Found a route - create a markdown link
			return `[${displayText}](${route})`;
		}

		// No route found - just return the display text
		return displayText;
	});
}

/**
 * Process TSDoc documentation content for display in Twoslash hover popups.
 *
 * This function:
 * - Transforms TSDoc link references to markdown links or plain text
 * - Normalizes whitespace around links for proper inline display
 * - Removes example blocks (including their code content)
 * - Removes the remarks tag while keeping the body text
 * - Removes modifier tags (public, internal, private, etc.)
 * - Removes see, param, returns, throws tags (these are rendered separately)
 *
 * @param docs - Raw TSDoc documentation string
 * @returns Cleaned documentation string ready for markdown rendering
 */
function processHoverDocs(docs: string): string {
	// First, transform {@link ...} references to markdown links or plain text
	let cleaned = transformTsDocLinks(docs);

	// Normalize whitespace within paragraphs - collapse multiple spaces/newlines to single space
	// This handles cases where {@link} was on its own line in the source
	// Split by double newline to preserve paragraph breaks, then normalize each paragraph
	cleaned = cleaned
		.split(/\n\n+/)
		.map((para) => para.replace(/\s+/g, " ").trim())
		.filter((para) => para.length > 0)
		.join("\n\n");

	// Remove @example blocks (match @example followed by any content until next @ tag or end)
	cleaned = cleaned.replace(/@example[\s\S]*?(?=@[a-zA-Z]|$)/g, "");

	// Remove @remarks tag but keep the body
	cleaned = cleaned.replace(/@remarks\s*/g, "");

	// Remove modifier tags
	cleaned = cleaned.replace(/@(public|internal|private|protected|readonly|sealed|virtual|override)\s*/g, "");

	// Remove @see tags (they reference other docs)
	cleaned = cleaned.replace(/@see\s+[^\n]*/g, "");

	// Remove @param, @returns, @throws tags (these are rendered separately in the UI)
	cleaned = cleaned.replace(/@(param|returns?|throws?)\s+[^\n]*/g, "");

	// Clean up multiple consecutive newlines
	cleaned = cleaned.replace(/\n{3,}/g, "\n\n");

	return cleaned.trim();
}

/**
 * Add rp-link class to all anchor elements in a HAST tree.
 * This enables RSPress link styling in hover popups.
 *
 * @param node - HAST node to process
 */
function addLinkClasses(node: ElementContent): void {
	if (node.type === "element") {
		if (node.tagName === "a") {
			// Add rp-link class to anchor elements
			const existing = node.properties?.class;
			if (typeof existing === "string") {
				node.properties = { ...node.properties, class: `${existing} rp-link` };
			} else {
				node.properties = { ...node.properties, class: "rp-link" };
			}
		}
		// Recursively process children
		if (node.children) {
			for (const child of node.children) {
				addLinkClasses(child as ElementContent);
			}
		}
	}
}

/**
 * Render markdown content to HAST (Hypertext Abstract Syntax Tree) elements.
 *
 * This function converts markdown strings (from TSDoc comments) into HAST nodes
 * that can be rendered in Twoslash hover popups. It parses with
 * `@effected/markdown` (CommonMark dialect) and converts to HAST with
 * `mdast-util-to-hast`, which stays because markdown-to-HTML is permanently
 * out of scope for the kit.
 *
 * TSDoc link references are transformed to markdown links before parsing.
 * Whitespace is normalized for proper inline display.
 * Links are given the rp-link class for RSPress styling.
 *
 * @param markdown - Markdown string to render
 * @returns Array of HAST ElementContent nodes
 */
function renderMarkdown(markdown: string): ElementContent[] {
	if (!markdown?.trim()) {
		return [];
	}

	try {
		// Transform {@link ...} references before markdown parsing
		let transformed = transformTsDocLinks(markdown);

		// Normalize whitespace within paragraphs - collapse multiple spaces/newlines to single space
		// Split by double newline to preserve paragraph breaks, then normalize each paragraph
		transformed = transformed
			.split(/\n\n+/)
			.map((para) => para.replace(/\s+/g, " ").trim())
			.filter((para) => para.length > 0)
			.join("\n\n");

		// Parse to mdast with @effected/markdown, then project to the plain
		// mdast shape `toHast` consumes.
		//
		// `dialect: "commonmark"` is explicit and load-bearing: the kit defaults
		// to GFM while the utility this replaced was CommonMark-only. Inheriting
		// GFM would quietly start rendering tables, strikethrough and autolinks
		// inside hover popups — a product change, not a dependency swap.
		// `__test__/markdown-parse-equivalence.test.ts` pins both the general
		// equivalence and the dialect.
		//
		// `toHast` stays: @effected/markdown puts markdown-to-HTML permanently
		// out of scope, so there is no kit replacement for it (see issue #91).
		const parsed = Markdown.parseResult(transformed, { dialect: "commonmark" });
		if (Result.isFailure(parsed)) return [{ type: "text", value: markdown }];
		const hast = toHast(Mdast.toMdast(parsed.success) as Parameters<typeof toHast>[0]);

		// Return the children (content) of the root node
		if (hast && "children" in hast) {
			const children = hast.children as ElementContent[];
			// Add rp-link class to all anchor elements
			for (const child of children) {
				addLinkClasses(child);
			}
			return children;
		}

		return [];
	} catch {
		// Fallback to plain text if markdown parsing fails
		return [{ type: "text", value: markdown }];
	}
}

/**
 * Tags to hide entirely in hover popups.
 * These are either redundant with the API documentation structure or add noise.
 */
const HIDDEN_TAGS = new Set([
	"example",
	"public",
	"internal",
	"private",
	"protected",
	"readonly",
	"sealed",
	"virtual",
	"override",
]);

/**
 * Render inline markdown for JSDoc tags with identifying CSS classes.
 *
 * This function wraps tag content in spans with tag-specific classes,
 * allowing CSS to selectively show/hide or style specific tags.
 *
 * @param markdown - The tag content to render
 * @param context - Context string like "tag:remarks", "tag:example", etc.
 * @returns Array of HAST ElementContent nodes
 */
function renderMarkdownInline(markdown: string, context: string): ElementContent[] {
	// Extract tag name from context (e.g., "tag:remarks" -> "remarks")
	const tagName = context.startsWith("tag:") ? context.slice(4) : "";

	// For hidden tags, return an empty marker element that CSS can target
	if (HIDDEN_TAGS.has(tagName)) {
		return [
			{
				type: "element",
				tagName: "span",
				properties: { class: `twoslash-tag-hidden twoslash-tag-${tagName}` },
				children: [],
			},
		];
	}

	// For other tags (remarks, param, returns, etc.), render the markdown content
	// wrapped in an identifying span
	const children = renderMarkdown(markdown);
	return [
		{
			type: "element",
			tagName: "span",
			properties: { class: `twoslash-tag-content twoslash-tag-${tagName}` },
			children,
		},
	];
}
/**
 * Fingerprint a compiler configuration so environments can be deduped and code
 * blocks routed to the right one. Keys are sorted, so two configurations that
 * differ only in property order share an environment.
 */
/**
 * Convert resolved compiler options from the tsconfig JSON spelling to the
 * programmatic one a real compiler expects.
 *
 * @remarks
 * Two spellings meet here, and only here. `tsconfig.json` writes
 * `lib: ["ESNext", "DOM"]` and `target: "esnext"`; `ts.CompilerOptions` wants
 * lib FILE NAMES (`lib.esnext.d.ts`) and numeric enums. `DEFAULT_COMPILER_OPTIONS`
 * is authored in the tsconfig spelling, and a tsconfig discovered from disk
 * arrives already converted by `ts.parseJsonConfigFileContent`, so both forms
 * reach this function — which is why the conversion must be idempotent rather
 * than one-directional.
 *
 * Exported for the four-path regression test: no runtime path in this repo
 * reaches the broken spelling (an unscoped block inherits the first registered
 * environment, not the raw default), so a synthetic test compiling each
 * resolution path through the real compiler is the only verification there is.
 */

/**
 * Fingerprint a compiler configuration, for keying the environment map.
 *
 * @remarks
 * INVARIANT: every call site must pass options that have already been through
 * {@link toProgrammaticCompilerOptions}. There are two — `initialize`, which
 * stores an environment under this key, and `registerScope`, which looks one
 * up by it. Both must encode, and encode the same way.
 *
 * The failure mode is SILENT. Encode at one site and not the other and the
 * keys stop matching, so `getTransformer(scope)` finds nothing and falls back
 * to the default environment: per-scope type-checking quietly degrades to
 * build-wide, no error is raised, and nothing in the output looks wrong.
 *
 * This is not hypothetical. Task 1.2 moved the `initialize` fingerprint behind
 * the encoder as a step specified — and reviewed — as a no-op, left
 * `registerScope` on the raw options, and the full 994-test suite stayed green
 * over the defect. The mutation that should have caught it (fingerprinting the
 * pre-encoded value) also survived that suite. What caught it was a test
 * written specifically for the hazard, which then failed for this second,
 * unanticipated reason. `__test__/twoslash-transformer.test.ts` now pins both
 * halves; keep that test whenever this code moves.
 */
function twoslashConfigKey(options: ProgrammaticCompilerOptions | TypeResolutionCompilerOptions): string {
	const entries = Object.entries(options as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
	return JSON.stringify(entries);
}

/**
 * The mutable registry behind {@link TwoslashEnvironments}.
 *
 * @remarks
 * A plain class the Layer constructs, not a singleton. `getInstance()` and the
 * static `reset()` that stood in for layer substitution are gone: a test that
 * wants a different environment set provides a different layer.
 */
export class TwoslashEnvironmentRegistry {
	/**
	 * Transformers keyed by compiler-config fingerprint.
	 *
	 * One environment per DISTINCT configuration, not per API: two packages
	 * documented under the same compiler options share an environment, and with
	 * it the TypeScript language services Twoslash builds per block. A build
	 * where every API agrees on its config therefore costs exactly what the
	 * single shared environment used to.
	 */
	private environments = new Map<string, ShikiTransformer>();

	/** API scope to config fingerprint, for `getTransformer(scope)`. */
	private scopeConfigs = new Map<string, string>();

	/**
	 * Fingerprint of the first environment initialized, used for code blocks
	 * that carry no scope — a `with-api` fence in a page outside any documented
	 * package's route.
	 */
	private defaultConfigKey: string | null = null;

	/**
	 * VFS keys snapshot captured at initialize() time.
	 * Returned by vfsKeysSnapshot() for TwoslashCheckFailed events.
	 */
	private _vfsKeys: string[] = [];

	/**
	 * Resolved compiler options captured at initialize() time.
	 * Returned by compilerOptionsSnapshot() for TwoslashCheckFailed events.
	 */
	private _resolvedCompilerOptions: ProgrammaticCompilerOptions =
		toProgrammaticCompilerOptions(DEFAULT_COMPILER_OPTIONS);

	/**
	 * Path of the file whose code block is currently being processed.
	 * Used to attribute Twoslash error events to a source file. Defaults to
	 * "unknown"; remark plugins set this via setCurrentFile() before rendering
	 * each block (wired in Task 11).
	 */
	private currentFilePath = "unknown";

	/**
	 * Build an environment for a configuration, or return if one exists.
	 *
	 * @remarks
	 * The signature this replaces took six positional parameters, two named
	 * `_reserved`/`_reserved2` and one (`tsEnvCache`) that every call site
	 * passed as `undefined`. Dropping `tsEnvCache` changes nothing at runtime
	 * for exactly that reason — Twoslash was never handed a shared environment
	 * cache.
	 */
	public registerEnvironment({ vfs, compilerOptions, typesCache }: RegisterEnvironmentOptions): void {
		// Convert VFS Map to record for Twoslash extraFiles
		const extraFiles: Record<string, string> = {};
		for (const [path, content] of vfs.entries()) {
			extraFiles[path] = content;
		}

		// Snapshot VFS keys and compiler options for TwoslashCheckFailed events.
		this._vfsKeys = Array.from(vfs.keys());

		// Use provided compiler options or fall back to defaults, then convert
		// to the programmatic spelling once, here.
		const resolvedOptions = toProgrammaticCompilerOptions(compilerOptions ?? DEFAULT_COMPILER_OPTIONS);
		this._resolvedCompilerOptions = resolvedOptions;

		// Fingerprint the ENCODED value. Keying on the pre-conversion form would
		// let `{lib:["ESNext"]}` and `{lib:["lib.esnext.d.ts"]}` — the same
		// configuration in two spellings — build two identical TypeScript
		// environments, one per API that happened to write it differently.
		const configKey = twoslashConfigKey(resolvedOptions);
		if (this.defaultConfigKey === null) this.defaultConfigKey = configKey;
		if (this.environments.has(configKey)) {
			// An API earlier in the build already built this exact environment.
			return;
		}
		const transformer = transformerTwoslash({
			renderer: rendererRich({
				// Custom hover info processor that preserves namespace/interface hovers
				// The default processor removes lines like "interface Foo" or "namespace Bar"
				// which causes hovers to be skipped for non-generic interfaces and namespaces
				processHoverInfo: (info: string): string => {
					// Remove the (alias) prefix and import lines, but keep interface/namespace declarations
					return info
						.replace(/^\(([\w-]+)\)\s+/gm, "") // Remove "(alias) " prefix
						.replace(/\nimport .*$/gm, "") // Remove "import X" lines
						.trim();
				},
				// Process TSDoc documentation to remove @example blocks and format for display
				processHoverDocs,
				// Render markdown content in hover popups
				renderMarkdown,
				renderMarkdownInline,
			}),
			// Persisted Twoslash result cache. Shiki calls read/write around the
			// whole `twoslasher()` call, so a hit skips the type-check entirely —
			// which is ~97% of render-phase code-block time (see
			// render-phase-instrumentation.md).
			...(typesCache != null ? { typesCache } : {}),
			twoslashOptions: {
				// Pass the virtual file system to Twoslash via extraFiles
				extraFiles, // Provide all our type declaration files
				compilerOptions: resolvedOptions,
				// Allow TypeScript errors to be rendered as annotations without throwing
				// Users can still use @noErrors to suppress errors, or @errors: XXXX to expect specific errors
				handbookOptions: {
					noErrorValidation: true,
				},
			},
			// Only run on code blocks explicitly marked with 'twoslash'
			explicitTrigger: true,
			// Don't throw errors for TypeScript errors in examples
			// Documentation examples may be intentionally incomplete
			throws: false,
			onTwoslashError: (error: unknown, code: string): void => {
				this.handleTwoslashError(error, code, this.currentFilePath);
			},
		});
		this.environments.set(configKey, transformer);

		// Logged via Effect logger in ConfigService.layer; no console output here
	}

	/**
	 * Associate an API scope with the compiler configuration it is documented
	 * under, so its code blocks are type-checked with that configuration.
	 */
	public registerScope(apiScope: string, compilerOptions: TypeResolutionCompilerOptions): void {
		// Encode before fingerprinting, exactly as `initialize` does. These two
		// keys must be computed the same way or a scope's lookup misses and
		// `getTransformer` silently falls back to the default environment —
		// per-scope type-checking would degrade to build-wide with nothing
		// failing.
		this.scopeConfigs.set(apiScope, twoslashConfigKey(toProgrammaticCompilerOptions(compilerOptions)));
	}

	/**
	 * Get the Twoslash transformer for an API scope.
	 *
	 * An unknown or absent scope falls back to the first environment built: a
	 * `with-api` fence can appear on a page outside any documented package's
	 * route, and type-checking it under some configuration beats not checking it.
	 * Returns null before any environment is initialized.
	 */
	public transformerFor(apiScope?: string): ShikiTransformer | null {
		const key = (apiScope != null ? this.scopeConfigs.get(apiScope) : undefined) ?? this.defaultConfigKey;
		return key != null ? (this.environments.get(key) ?? null) : null;
	}

	/**
	 * Set the source file path used to attribute subsequent Twoslash error events.
	 * Remark plugins call this before rendering each code block (wired in Task 11).
	 *
	 * @param path - Source file path (e.g. "kitchensink/api/class/plugin.md")
	 */
	public setCurrentFile(path: string): void {
		this.currentFilePath = path;
	}

	/**
	 * Clear the Twoslash transformer (useful for testing or reinitializing)
	 */
	public clear(): void {
		this.environments.clear();
		this.scopeConfigs.clear();
		this.defaultConfigKey = null;
	}

	/** Returns VFS keys snapshotted at initialize() time. Empty array before initialize(). */
	private vfsKeysSnapshot(): string[] {
		return this._vfsKeys;
	}

	/** Returns compiler options snapshotted at initialize() time. Falls back to DEFAULT_COMPILER_OPTIONS. */
	private compilerOptionsSnapshot(): ProgrammaticCompilerOptions {
		return this._resolvedCompilerOptions;
	}

	private handleTwoslashError(error: unknown, _code: string, file: string): void {
		// Metrics derived from TwoslashDiagnostic event in MetricsSink
		const message = error instanceof Error ? error.message : String(error);
		const match = /TS(\d+)/.exec(message);
		const tsCode = match ? Number(match[1]) : 0;

		emitSync(
			PluginEvent.TwoslashDiagnostic({
				ctx: { buildId: syncBuildId(), file },
				level: "warn",
				file,
				line: 0,
				col: 0,
				code: tsCode,
				message,
				snippet: "",
			}),
		);
		emitSync(
			PluginEvent.TwoslashCheckFailed({
				ctx: { buildId: syncBuildId(), file },
				level: "trace",
				file,
				code: tsCode,
				fsMapKeys: this.vfsKeysSnapshot(),
				compilerOptions: JSON.stringify(this.compilerOptionsSnapshot()),
			}),
		);
	}

	/**
	 * Test seam: drive `handleTwoslashError` directly without going through the Shiki transformer.
	 * @internal
	 */
	public reportErrorForTest(error: unknown, code: string, file: string): void {
		this.handleTwoslashError(error, code, file);
	}
}

/**
 * Cross-link routes used to turn type names in hover docs into links.
 *
 * @remarks
 * These were `static` members of the old singleton, but they are cross-link
 * DATA, not type-checking state — they only ever read and wrote the
 * module-level `typeRoutes` map above, and they share their concern with
 * `markdown/prose-linker.ts` rather than with the environment registry. They
 * are deliberately NOT part of {@link TwoslashEnvironments}: folding them in
 * would widen the service's surface with state that has nothing to do with
 * compiler configurations.
 */

/** Replace the type routes map wholesale. */
export function setTypeRoutes(routes: Map<string, string>): void {
	typeRoutes = routes;
}

/** Merge routes in, so a multi-API build accumulates every scope's names. */
export function addTypeRoutes(routes: Map<string, string>): void {
	for (const [name, route] of routes) {
		typeRoutes.set(name, route);
	}
}

/**
 * Clear the accumulated type routes.
 *
 * @remarks
 * Called from `config()` at the start of every build. `addTypeRoutes` only
 * ever adds, so without this a dev session keeps routes for items that have
 * since been renamed or removed, and a multi-API build leaks every scope's
 * names into one map.
 *
 * Clears ONLY the routes. The environments are per-build too, but they are
 * owned by the layer now, so nothing here can discard the per-scope
 * transformers `ConfigService.layer` just built.
 */
export function clearTypeRoutes(): void {
	typeRoutes.clear();
}
