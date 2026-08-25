/* v8 ignore start -- Shiki utility functions, require full Shiki highlighter for testing */
import type { Root } from "hast";
import type { Highlighter, ShikiTransformer } from "shiki";
import { PluginEvent as PE } from "../observability/events.js";
import { emitSync, syncBuildId } from "../observability/sync-emitter.js";

/**
 * A single Shiki theme: a bundled theme's name, or a raw theme object.
 */
export type ShikiThemeInput = string | { readonly [key: string]: unknown };

/**
 * A `theme` as an API config declares it: one name for both modes, an explicit
 * light/dark pair, or a raw theme object.
 */
export type ShikiThemeOption =
	| string
	| { readonly light: string; readonly dark: string }
	| { readonly [key: string]: unknown };

/**
 * Theme configuration for Shiki highlighting
 */
export interface ShikiThemeConfig {
	light: ShikiThemeInput;
	dark: ShikiThemeInput;
}

/**
 * Default Shiki theme configuration
 */
export const DEFAULT_SHIKI_THEMES: ShikiThemeConfig = {
	light: "github-light-default",
	dark: "github-dark-default",
};

/**
 * Generate a HAST (Hypertext Abstract Syntax Tree) from TypeScript code using Shiki.
 *
 * This function replaces the duplicated `generateShikiHtml` methods across page generators.
 * It produces a JSON-serializable HAST tree instead of HTML strings, which:
 * - Eliminates MDX parsing issues caused by long HTML strings with special characters
 * - Allows clean JSON serialization in generated MDX files
 * - Enables runtime rendering via `hast-util-to-jsx-runtime` without `dangerouslySetInnerHTML`
 *
 * @param code - The TypeScript code to highlight
 * @param highlighter - Shiki highlighter instance (optional, returns null if not provided)
 * @param transformers - Optional array of Shiki transformers (e.g., Twoslash, cross-linker)
 * @param enableTwoslash - If true, adds meta to trigger Twoslash directive processing
 * @param theme - Optional theme configuration (defaults to github-light/github-dark)
 * @returns A HAST root node, or null if no highlighter is provided or an error occurs
 */
export async function generateShikiHast(
	code: string,
	highlighter?: Highlighter,
	transformers?: ShikiTransformer[],
	enableTwoslash?: boolean,
	theme?: ShikiThemeConfig,
): Promise<Root | null> {
	if (!highlighter) {
		return null;
	}

	const resolvedTheme = theme ?? DEFAULT_SHIKI_THEMES;

	try {
		const options: Parameters<typeof highlighter.codeToHast>[1] = {
			lang: "typescript",
			themes: {
				light: resolvedTheme.light,
				dark: resolvedTheme.dark,
			},
			defaultColor: false,
			// Namespace CSS variables to avoid conflicts with user's default code blocks
			// This generates --api-shiki-light-* and --api-shiki-dark-* instead of --shiki-*
			cssVariablePrefix: "--api-shiki-",
			transformers: transformers || [],
		};
		// Pass meta to trigger Twoslash processing when enabled
		// This simulates the ```ts twoslash code fence meta
		if (enableTwoslash) {
			options.meta = { __raw: "twoslash" };
		}
		return await highlighter.codeToHast(code, options);
	} catch (error) {
		emitSync(PE.ShikiError({ ctx: { buildId: syncBuildId() }, file: "unknown", reason: String(error), level: "warn" }));
		return null;
	}
}

/* v8 ignore stop -- everything below is pure and covered by __test__/markdown/shiki-themes.test.ts */

/**
 * Normalize a theme option into the `{ light, dark }` pair the highlighter and
 * the remark plugins both expect.
 *
 * @remarks
 * Accepts a single theme name applied to both modes, an explicit pair, or a
 * raw theme object. Lives beside {@link DEFAULT_SHIKI_THEMES} because it falls
 * back to it; it was previously duplicated byte-for-byte in `plugin.ts` and
 * `ConfigServiceLive.ts`.
 */
export function normalizeThemeConfig(theme: ShikiThemeOption | undefined): ShikiThemeConfig {
	if (!theme) {
		return { ...DEFAULT_SHIKI_THEMES };
	}
	if (typeof theme === "string") {
		return { light: theme, dark: theme };
	}
	if ("light" in theme && "dark" in theme && typeof theme.light === "string" && typeof theme.dark === "string") {
		return { light: theme.light, dark: theme.dark };
	}
	return { light: theme, dark: theme };
}

/**
 * Every theme the build's single highlighter must load: one normalized pair
 * per documented API, plus the two defaults.
 *
 * @remarks
 * Takes the RAW option configs rather than resolved ones, because the
 * highlighter is now acquired when its layer builds — before `resolve()` has
 * run. That is sound: a resolved config's `theme` is exactly
 * `normalizeThemeConfig(api.theme)` and no version-level override exists, so
 * the two inputs cannot disagree.
 *
 * Named theme strings are deduplicated; object themes are not (they have no
 * identity to compare), which matches the previous behaviour and is harmless —
 * Shiki keys a loaded theme by its `name`.
 */
export function collectShikiThemes(
	apis: ReadonlyArray<{ readonly theme?: ShikiThemeOption | undefined }>,
): Array<ShikiThemeInput> {
	const named = new Set<string>();
	const objects: Array<ShikiThemeInput> = [];

	for (const api of apis) {
		const theme = normalizeThemeConfig(api.theme);
		for (const input of [theme.light, theme.dark]) {
			if (typeof input === "string") named.add(input);
			else objects.push(input);
		}
	}

	// The defaults are always loaded: a code block whose scope declares no theme
	// renders against them, and `generateShikiHast` falls back to them too.
	if (typeof DEFAULT_SHIKI_THEMES.light === "string") named.add(DEFAULT_SHIKI_THEMES.light);
	if (typeof DEFAULT_SHIKI_THEMES.dark === "string") named.add(DEFAULT_SHIKI_THEMES.dark);

	return [...named, ...objects];
}

/** Languages the highlighter loads. Every code block the plugin renders is one of these. */
export const SHIKI_LANGS: ReadonlyArray<string> = ["typescript", "javascript", "json", "bash", "sh"];
