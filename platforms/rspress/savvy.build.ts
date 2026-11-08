import { build } from "@savvy-web/rspress-builder";

// Stays on @savvy-web/rspress-builder (upgrade ledger 0001 deferred):
// - `effected package build` has no per-file runtime output for `runtime: true`
//   (spencerbeggs/effected#1303, tracked in spencerbeggs/tsdoctor#402).
// - The sites load this package's built JS in plain Node, which needs the
//   `@tsdoctor/*` dist/dev link trees the kit removes
//   (spencerbeggs/effected#1304, tracked in spencerbeggs/tsdoctor#403).

await build({
	runtime: true,
	bundledPackages: ["@rspress/core", "@type/mdast", "@type/unist"],
	meta: {
		tsdoc: {
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// The config helpers are exposed only via the `ApiExtractorPlugin.api`
				// namespace (not as named top-level exports), so their declarations are
				// referenced by the public type but intentionally not re-exported.
				{ messageId: "ae-forgotten-export", pattern: "ApiExtractorPluginImpl|fromDir|fromParentDir" },
			],
		},
	},
});
