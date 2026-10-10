import { defineConfig } from "pluginfinity";

export default defineConfig({
	name: "api-docs",
	description:
		"Build and maintain RSPress API-documentation sites with rspress-plugin-api-extractor: four documentation-craft skills, the rspress-docs agent, review and sync skills, a session orientation hook, and a doc-build issues monitor.",
	author: { name: "C. Spencer Beggs", email: "spencer@beggs.codes", url: "https://spencerbeg.gs" },
	homepage: "https://github.com/spencerbeggs/tsdoctor",
	repository: "https://github.com/spencerbeggs/tsdoctor.git",
	license: "MIT",
	keywords: ["rspress", "api-extractor", "documentation", "twoslash", "typescript"],
	hooks: {
		SessionStart: [{ script: "hooks/session-start/announce.sh", timeout: 10 }],
	},
	monitors: {
		"doc-build-issues": {
			// biome-ignore lint/suspicious/noTemplateCurlyInString: pluginfinity placeholder
			command: 'node "${PLUGIN_ROOT}/monitors/watch-issues.mjs"',
			description: "Surfaces Twoslash/doc-build issues from .api-docs/build/issues.json as builds change them",
		},
	},
	claude: true,
	copilot: true,
});
