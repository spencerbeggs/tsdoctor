# @tsdoctor/ai-plugins

## 0.20.0

### Features

#### One plugin for Claude Code and GitHub Copilot

- The api-docs plugin is now built from a single source for both hosts, so the Claude Code and Copilot plugins carry the same skills, agent and session briefing at the same version. The plugin now versions on its own release line instead of in lockstep with `rspress-plugin-api-extractor`.

- `/api-docs:review [path]` and `/api-docs:sync [path]` are now user-invoked skills rather than commands, available on both hosts

- The Copilot build carries the `rspress-docs` agent and all four documentation-craft skills; the doc-build issues monitor remains Claude Code only

- The plugin manifest now points at the `spencerbeggs/tsdoctor` repository [#333][#333]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#333]: https://github.com/spencerbeggs/tsdoctor/pull/333
