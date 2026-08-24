import { build } from "@savvy-web/bundler";

await build({
	meta: {
		tsdoc: {
			// Effect's class factories (Schema.TaggedError / Schema.Class)
			// synthesize anonymous `_base` intermediate classes that cannot be
			// exported or release-tagged from source. This is the
			// toolchain-sanctioned narrow suppression for that pattern (same as
			// packages/registry and packages/bundle).
			suppressWarnings: [
				{ messageId: "ae-forgotten-export", pattern: "_base" },
				// The dts rollup synthesizes an `<Module>_d_exports` binding for each
				// `export * as <Module>` namespace re-export; a release tag cannot be
				// attached to that synthetic binding from source. Narrow suppression
				// scoped to that generated-name pattern only.
				{ messageId: "ae-missing-release-tag", pattern: "_d_exports" },
			],
		},
	},
});
