import { build } from "@savvy-web/bundler";
import { ogImage } from "@savvy-web/bundler/og";

await build({
	meta: {
		localPaths: [
			"../../sites/basic/lib/models/kitchensink",
			"../../sites/i18n/lib/models/kitchensink",
			"../../sites/multi/lib/models/kitchensink",
			"../../sites/vitepress-basic/lib/models/kitchensink",
		],
		tsdoc: {
			// Compiler-generated mixin bases (AuditedRecord_base) are intentionally
			// unexported; the docs plugin inlines them on the owning class page.
			suppressWarnings: [{ messageId: "ae-forgotten-export", pattern: "_base" }],
		},
		tsdoctor: {
			name: "Kitchen Sink",
			tagline: "Every API Extractor shape the docs pipeline must render",
			openGraph: { generate: ogImage.satori(), themeColor: "#0f172a" },
		},
	},
});
