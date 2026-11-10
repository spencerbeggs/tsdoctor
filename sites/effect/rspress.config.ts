import { defineConfig } from "@rspress/core";
import { ApiExtractorPlugin } from "rspress-plugin-api-extractor";

export default defineConfig({
	root: "docs",
	title: "Effect Multi-Entry Test",
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
			api: ApiExtractorPlugin.api.fromDir("./lib/models/effect-kit"),
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
