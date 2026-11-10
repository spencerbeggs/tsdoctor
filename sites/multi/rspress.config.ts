import { defineConfig } from "@rspress/core";
import { ApiExtractorPlugin } from "rspress-plugin-api-extractor";

export default defineConfig({
	root: "docs",
	title: "Multi-API Portal Test",
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
			apis: ApiExtractorPlugin.apis.fromDir("./lib/models"),
			observability: { logLevel: "info" },
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
