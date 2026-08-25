/**
 * The theme set the build's highlighter loads.
 *
 * @remarks
 * This moved from `ConfigService.layer.resolve()` (reading RESOLVED api configs)
 * to a layer that builds before `resolve()` runs (reading RAW option configs).
 * The tests below pin the equivalence that makes that sound, and each was
 * watched failing under the edit it forbids.
 */

import { describe, expect, it } from "vitest";
import type { ShikiThemeConfig, ShikiThemeInput, ShikiThemeOption } from "../../src/markdown/shiki-utils.js";
import { DEFAULT_SHIKI_THEMES, collectShikiThemes, normalizeThemeConfig } from "../../src/markdown/shiki-utils.js";

describe("normalizeThemeConfig", () => {
	it("applies a single theme name to both modes", () => {
		expect(normalizeThemeConfig("nord")).toEqual({ light: "nord", dark: "nord" });
	});

	it("passes an explicit pair through", () => {
		expect(normalizeThemeConfig({ light: "a", dark: "b" })).toEqual({ light: "a", dark: "b" });
	});

	it("treats a raw theme object as both modes", () => {
		const raw = { name: "custom", settings: [] };
		expect(normalizeThemeConfig(raw)).toEqual({ light: raw, dark: raw });
	});

	it("falls back to the defaults when no theme is declared", () => {
		expect(normalizeThemeConfig(undefined)).toEqual(DEFAULT_SHIKI_THEMES);
	});
});

describe("collectShikiThemes", () => {
	// FORBIDS: dropping the default themes from the collected set. A code block
	// in a scope that declares no theme renders against them, and
	// `generateShikiHast` falls back to them — a highlighter that never loaded
	// them throws at render time, which surfaces as an unhighlighted block.
	it("always includes both defaults, even with no APIs", () => {
		expect(collectShikiThemes([])).toEqual([DEFAULT_SHIKI_THEMES.light, DEFAULT_SHIKI_THEMES.dark]);
	});

	// FORBIDS: collecting only the first API's theme (the shape `plugin.ts`
	// already uses for the remark plugin's single theme). A second API's custom
	// theme would then be unloaded and its code blocks would fail to render.
	it("collects every API's theme, not just the first", () => {
		const themes = collectShikiThemes([{ theme: "nord" }, { theme: { light: "min-light", dark: "min-dark" } }]);
		expect(themes).toContain("nord");
		expect(themes).toContain("min-light");
		expect(themes).toContain("min-dark");
	});

	// FORBIDS: dropping the Set and pushing names directly — a versioned API
	// contributes one resolved config per version, all with the same theme, and
	// Shiki rejects loading one theme name twice.
	it("deduplicates repeated theme names", () => {
		const themes = collectShikiThemes([{ theme: "nord" }, { theme: "nord" }, { theme: "nord" }]);
		expect(themes.filter((t) => t === "nord")).toHaveLength(1);
	});

	// FORBIDS: `typeof input === "string" ? named.add : ignore` — an object
	// theme that never reaches the highlighter renders as plain text.
	it("carries object themes through alongside the named ones", () => {
		const raw = { name: "custom", settings: [] };
		const themes = collectShikiThemes([{ theme: raw }]);
		expect(themes).toContain(raw);
		expect(themes).toContain(DEFAULT_SHIKI_THEMES.light);
	});

	// The differential that makes the move sound. The deleted code looped over
	// RESOLVED api configs inside `ConfigService.layer.resolve()`; this loops over
	// the RAW option configs from a layer that builds before `resolve()` runs.
	// `legacyCollect` is that deleted loop, verbatim, so the two can be diffed.
	it("agrees with the resolved-config loop it replaced", () => {
		const legacyCollect = (configs: ReadonlyArray<{ theme?: ShikiThemeConfig }>): Array<ShikiThemeInput> => {
			const themeSet = new Set<string>();
			const customThemes: Array<ShikiThemeInput> = [];
			for (const config of configs) {
				const theme = config.theme ?? { light: DEFAULT_SHIKI_THEMES.light, dark: DEFAULT_SHIKI_THEMES.dark };
				if (typeof theme.light === "string") themeSet.add(theme.light);
				else customThemes.push(theme.light);
				if (typeof theme.dark === "string") themeSet.add(theme.dark);
				else customThemes.push(theme.dark);
			}
			if (typeof DEFAULT_SHIKI_THEMES.light === "string") themeSet.add(DEFAULT_SHIKI_THEMES.light);
			if (typeof DEFAULT_SHIKI_THEMES.dark === "string") themeSet.add(DEFAULT_SHIKI_THEMES.dark);
			return [...themeSet, ...customThemes];
		};

		const custom = { name: "custom", settings: [] };
		const raws: ReadonlyArray<{ theme?: ShikiThemeOption }> = [
			{ theme: "nord" },
			{ theme: { light: "min-light", dark: "min-dark" } },
			{ theme: custom },
			{},
		];
		// A resolved config's `theme` is exactly `normalizeThemeConfig(api.theme)`
		// — see `ConfigService.layer`'s two assembly sites — so this is the input
		// the old loop actually saw.
		const resolved = raws.map((api) => ({ theme: normalizeThemeConfig(api.theme) }));

		expect(new Set(collectShikiThemes(raws))).toEqual(new Set(legacyCollect(resolved)));
	});
});
