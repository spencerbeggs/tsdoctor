# plugin/CLAUDE.md

The **api-docs agent plugin** for this monorepo: one
[pluginfinity](https://github.com/spencerbeggs/pluginfinity) source built into
a Claude Code plugin and a GitHub Copilot plugin.

**Do not confuse this with the npm package.** The publishable RSPress plugin
(`rspress-plugin-api-extractor`) lives in `platforms/rspress/`, not here. This
folder is the pnpm workspace `@tsdoctor/ai-plugins` (private, never published
to npm); Turbo builds it through its `build:dev` / `build:prod` scripts, which
run `pluginfinity build`.

## Status

Phase 1, 1b, and 2 complete: ships four model-invoked skills under `skills/`, the `rspress-docs` agent (`agents/rspress-docs.md`), two user-invoked skills (`review`, `sync`, the former slash commands), a one-line SessionStart orientation hook that names the agent, and a Claude Code-only background monitor. Each craft skill is a `SKILL.md` gate plus essentials with a `references/` folder loaded on demand. The `rspress-docs` agent force-loads all four craft skills via frontmatter `skills:` and runs an orient → match → write → validate → report workflow; it never edits package source/TSDoc or the generated `api/` tree (those become findings). The user-invoked skills are thin front-doors (`disable-model-invocation: true`): `/api-docs:review [path]` loads the `doc-writer` skill and applies its review rubric (escalating to the agent for large sites); `/api-docs:sync [path]` dispatches the agent to run its sync workflow after an API/model change.

| Skill | Owns |
| ----- | ---- |
| `twoslash` | The `with-api` code-fence contract, Twoslash notation, generated-example transforms (references: `notation`, `generated-examples`, `recipes`) |
| `plugin-config` | The `rspress-plugin-api-extractor` package's own configuration, theming, and `.api.json` model plumbing (references: `config-reference`, `recipes`, `model-plumbing`, `theming`, `llms`, `troubleshooting`) |
| `doc-writer` | Editorial craft — page skeletons, review rubric, sync workflow, cross-linking; the `with-api` editorial discipline (references: `page-skeletons`, `review-rubric`, `sync-workflow`, `cross-linking`) |
| `rspress-core` | Package-agnostic RSPress 2.x craft — routing/nav, components, frontmatter, `--rp-*` theming, i18n/multiVersion (references: `routing-nav`, `components`, `frontmatter`, `theming`, `i18n-multiversion`, `deploy`) |
| `review` | User-invoked `/api-docs:review [path]` |
| `sync` | User-invoked `/api-docs:sync [path]` |

Remaining: an optional standalone scaffolding skill (scaffolding is agent-invoked by design for now) and a dogfood validation pass over consumer sites.

Roadmap: `ROADMAP.md`. Design spec: `docs/superpowers/specs/2026-07-14-api-docs-plugin-design.md`.

## Distribution & Versioning

Distributed from the **spencerbeggs/bot marketplace**. The plugin is versioned
on **its own changeset line** as `@tsdoctor/ai-plugins`; it is no longer in
lockstep with `rspress-plugin-api-extractor`. A change under `plugin/` gets a
changeset for `@tsdoctor/ai-plugins`. Every built manifest copies `version` from
`plugin/package.json`; `.changeset/config.json`'s `versionFiles` also writes it
into `builds/claude/.claude-plugin/plugin.json` and `builds/copilot/plugin.json`.
After `changeset version`, run `pluginfinity build` and commit `builds/`.

## Layout

| Path | Purpose |
| ---- | ------- |
| `pluginfinity.config.ts` | Name, metadata, targets, the SessionStart hook, the `doc-build-issues` monitor |
| `package.json` | `@tsdoctor/ai-plugins`; its `version` is every manifest's version |
| `agents/rspress-docs.md` | Docs-authoring subagent; force-loads the four craft skills |
| `skills/<skill>/SKILL.md` | Skill gate + essentials (see Status) |
| `skills/<skill>/references/` | Deep-dive reference docs loaded on demand |
| `hooks/session-start/announce.sh` | Orientation hook on the pluginfinity hook library |
| `monitors/watch-issues.mjs` | Polls `**/.api-docs/build/issues.json`; notifies once a non-zero issue count settles (Claude Code only) |
| `builds/claude/`, `builds/copilot/` | **Generated and committed. Never edit**; rebuild from the source |
| `__test__/*.bats`, `__test__/fixtures/` | bats coverage, run against both builds |
| `ROADMAP.md` | Phased build-out plan for the plugin |

## Conventions

- **Never edit `builds/`.** Edit the source, run `pluginfinity build`, and
  commit the builds with it. `pnpm plugin:check` (`build --check`) fails when
  they are stale, including after a commit hook flips a script's exec bit.
- **No manifest, `hooks.json` or `monitors.json` by hand.** The build writes
  all three from `pluginfinity.config.ts`; `monitors/monitors.json` is a
  reserved path.
- **Hooks source the pluginfinity library** (`. "$(dirname "$0")/../lib/pluginfinity/hook.sh"`)
  and answer with `hook_context` and friends. One script serves both hosts;
  never vendor the library or branch on the host. Without `jq` a hook is a
  silent no-op.
- **Name tools, agents and skills with tokens** in skill and agent bodies
  (`{{tool Agent}}`, `{{agent rspress-docs}}`, `{{skill doc-writer}}`) so each
  host gets its own spelling; put host-only wording in
  `<!-- pluginfinity:only <host> -->` blocks.
- **Monitors honour `PLUGINFINITY_MONITOR_MAX_TICKS`**, which only tests set.
- Logs go to `${XDG_STATE_HOME:-~/.local/state}/pluginfinity/api-docs/`; read
  them with `pluginfinity logs`, and set `PLUGINFINITY_DEBUG=1` for `debug.log`.

## Commands

```bash
pnpm --filter @tsdoctor/ai-plugins run build:dev  # pluginfinity build
pnpm plugin:check     # build --check: builds/ match the source
pnpm --filter @tsdoctor/ai-plugins run validate   # each host's own check
pnpm test:bats        # bats --recursive plugin/__test__ (both hosts)
pnpm claude           # Claude Code with plugin/builds/claude
pnpm copilot          # Copilot CLI with plugin/builds/copilot
```
