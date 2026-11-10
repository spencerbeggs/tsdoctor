import { defineConfig } from "@rspress/core";
import { ApiExtractorPlugin } from "rspress-plugin-api-extractor";

export default defineConfig({
	root: "docs",
	title: "i18n API Test",
	outDir: "dist",
	llms: true,
	themeConfig: {
		llmsUI: {
			viewOptions: ["markdownLink", "chatgpt", "claude"],
			placement: "title",
		},
	},
	lang: "en",
	locales: [
		{ lang: "en", label: "English" },
		{ lang: "zh", label: "中文" },
	],
	plugins: [
		ApiExtractorPlugin({
			observability: { logLevel: "info" },
			api: ApiExtractorPlugin.api.fromDir("./lib/models/kitchensink"),
		}),
	],
	markdown: { link: { checkDeadLinks: false } },
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
