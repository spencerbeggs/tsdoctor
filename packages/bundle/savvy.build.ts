import { build } from "@savvy-web/bundler";

await build({
	bundledPackages: ["@tsdoctor/manifest"],
	meta: {
		tsdoc: {
			// Effect's class factories (Schema.TaggedError) synthesize anonymous
			// `_base` intermediate classes that cannot be exported or
			// release-tagged from source. This is the toolchain-sanctioned narrow
			// suppression for that pattern (same as packages/registry).
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
