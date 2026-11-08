import { build } from "@savvy-web/bundler";

await build({
	meta: {
		localPaths: ["../../sites/versioned/lib/models/v2"],
	},
	// Stays on @savvy-web/bundler: effected.toml cannot set the emitted name
	// (spencerbeggs/effected#1302, tracked in spencerbeggs/tsdoctor#401).
	transform({ pkg }) {
		pkg.name = "@modules/versioned";
		delete pkg.devDependencies;
		delete pkg.scripts;
		delete pkg.publishConfig;
		return pkg;
	},
});
