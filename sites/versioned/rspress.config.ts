import { defineConfig } from "@rspress/core";
import { ApiExtractorPlugin } from "rspress-plugin-api-extractor";

export default defineConfig({
	root: "docs",
	title: "Versioned API Test",
	outDir: "dist",
	llms: true,
	themeConfig: {
		llmsUI: {
			viewOptions: ["markdownLink", "chatgpt", "claude"],
			placement: "outline",
		},
	},
	multiVersion: {
		default: "v2",
		versions: ["v1", "v2"],
	},
	plugins: [
		ApiExtractorPlugin({
			observability: { logLevel: "info" },
			api: {
				packageName: "versioned-module",
				versions: {
					v1: ApiExtractorPlugin.api.fromDir("./lib/models/v1"),
					v2: ApiExtractorPlugin.api.fromDir("./lib/models/v2"),
				},
			},
		}),
	],
	route: { cleanUrls: true },
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
