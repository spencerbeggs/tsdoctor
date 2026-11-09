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
			// The bundle.json manifest now supplies the Open Graph
			// image — see lib/models/kitchensink/bundle.json.
			api: ApiExtractorPlugin.api.fromDir("./lib/models/kitchensink"),
		}),
	],
	route: {
		cleanUrls: true,
	},
	// Resolve the workspace plugin runtime and its @tsdoctor/* siblings to their
	// built output, as Node does for this config under --conditions=effected-built.
	builderConfig: {
		tools: {
			rspack: (config) => {
				config.resolve ??= {};
				config.resolve.conditionNames = ["effected-built", ...(config.resolve.conditionNames ?? ["..."])];
				return config;
			},
		},
	},
});
