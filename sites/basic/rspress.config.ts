import { defineConfig } from "@rspress/core";
import { ApiExtractorPlugin } from "rspress-plugin-api-extractor";

export default defineConfig({
	root: "docs",
	title: "API Extractor Plugin Test",
	// Exercises the Open Graph path end to end. Before this, NO fixture site
	// declared an origin, so every og: tag the plugin can emit was dead code in
	// all five site builds — a whole feature no build could regression-test.
	siteOrigin: "https://basic.example.com",
	outDir: "dist",
	llms: true,
	themeConfig: {
		llmsUI: {
			viewOptions: ["markdownLink", "chatgpt", "claude"],
			placement: "outline",
		},
	},
	plugins: [
		ApiExtractorPlugin({
			observability: { logLevel: "info" },
			ogImage: "/images/og.png",
			api: ApiExtractorPlugin.api.fromDir("./lib/models/kitchensink"),
		}),
	],
	route: {
		cleanUrls: true,
	},
});
