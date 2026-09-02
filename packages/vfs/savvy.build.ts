import { build } from "@savvy-web/bundler";

await build({
	meta: {
		tsdoc: {
			// Effect's class factories (Context.Service, Schema.Class, tagged
			// errors) synthesize anonymous `_base` intermediate classes that cannot
			// be exported or release-tagged from source. This is the
			// toolchain-sanctioned narrow suppression for that pattern.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
	},
});
