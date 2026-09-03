import { defineConfig } from "vitepress";
import { apiExtractor } from "vitepress-plugin-api-extractor";

// Generation runs at config load: VitePress has no pre-scan hook, so the
// helper writes the pages under docs/ before VitePress reads them, and hands
// back the sidebar, the Twoslash transformer and the buildEnd that persists
// the result cache.
const api = await apiExtractor({
	dir: "./lib/models/kitchensink",
	docsDir: "docs",
	baseRoute: "/api",
	// Exercises the canonical / Open Graph / JSON-LD path end to end, like
	// sites/basic does for the RSPress plugin.
	siteOrigin: "https://vitepress-basic.example.com",
});

export default defineConfig({
	title: "API Extractor VitePress Test",
	description: "A minimal test site for verifying vitepress-plugin-api-extractor.",
	cleanUrls: true,
	themeConfig: {
		nav: [
			{ text: "Home", link: "/" },
			{ text: "API", link: "/api/" },
		],
		sidebar: api.sidebar,
	},
	markdown: {
		codeTransformers: [...api.codeTransformers],
	},
	buildEnd: async () => {
		await api.hooks.buildEnd();
	},
});
