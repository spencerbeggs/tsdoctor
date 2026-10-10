#!/usr/bin/env bats
# session-start-announce.bats: covers hooks/session-start/announce.sh, the
# plugin's SessionStart orientation hook, on BOTH hosts.
#
# One source script serves Claude Code and Copilot through the pluginfinity hook
# library, so every test runs the BUILT copy under builds/<host>/ with run_hook,
# the way each host runs it. Run `pluginfinity build` first;
# `pluginfinity build --check` proves the builds match the source.

load "$BATS_TEST_DIRNAME/../node_modules/pluginfinity/bats/pluginfinity.bash"

HOOK="hooks/session-start/announce.sh"
BUILDS="$BATS_TEST_DIRNAME/../builds"

# _ctx_of <host>: the context text in $output, read from <host>'s shape only, so
# a response in the other host's shape reads as empty.
_ctx_of() {
	case "$1" in
	claude) jq -r '.hookSpecificOutput.additionalContext // empty' <<<"$output" 2>/dev/null ;;
	copilot) jq -r 'if has("hookSpecificOutput") then empty else .additionalContext // empty end' <<<"$output" 2>/dev/null ;;
	esac
}

@test "claude: one nested hookSpecificOutput object for SessionStart" {
	run_hook claude "$HOOK" sessionstart.startup.json
	assert_hook_exit 0
	[ "$(jq -s 'length' <<<"$output")" -eq 1 ]
	assert_hook_json '.hookSpecificOutput.hookEventName' SessionStart
	jq -e 'has("additionalContext") | not' <<<"$output" >/dev/null
	[[ "$(_ctx_of claude)" == *"api-docs"* ]]
}

@test "copilot: one flat additionalContext object, not Claude Code's shape" {
	run_hook copilot "$HOOK" sessionstart.startup.json
	assert_hook_exit 0
	[ "$(jq -s 'length' <<<"$output")" -eq 1 ]
	jq -e 'has("hookSpecificOutput") | not' <<<"$output" >/dev/null
	[[ "$(_ctx_of copilot)" == *"api-docs"* ]]
}

@test "both hosts: the same message, naming the agent by its namespaced id" {
	local claude_ctx copilot_ctx
	run_hook claude "$HOOK" sessionstart.startup.json
	claude_ctx=$(_ctx_of claude)
	run_hook copilot "$HOOK" sessionstart.startup.json
	copilot_ctx=$(_ctx_of copilot)
	[ -n "$claude_ctx" ]
	[ "$claude_ctx" = "$copilot_ctx" ]
	[[ "$claude_ctx" == *"api-docs:rspress-docs"* ]]
	for skill in twoslash plugin-config doc-writer rspress-core; do
		[[ "$claude_ctx" == *"$skill"* ]]
	done
	[[ "$claude_ctx" == *"/api-docs:review"* ]]
	[[ "$claude_ctx" == *"/api-docs:sync"* ]]
}

@test "both hosts: briefs on resume and compact too (no matcher)" {
	local host src fixture
	for host in claude copilot; do
		for src in resume compact; do
			fixture=$(hook_fixture SessionStart "{\"source\":\"$src\"}")
			run_hook "$host" "$HOOK" "$fixture"
			assert_hook_exit 0
			[[ "$(_ctx_of "$host")" == *"api-docs:rspress-docs"* ]]
		done
	done
}

@test "both hosts: no longer writes a hand-rolled session env" {
	local host
	for host in claude copilot; do
		run_hook "$host" "$HOOK" sessionstart.startup.json HOME="$BATS_TEST_TMPDIR/home"
		assert_hook_exit 0
		[ ! -e "$BATS_TEST_TMPDIR/home/.claude/session-env" ]
	done
}

@test "both hosts: no jq is a silent no-op" {
	local host bin tool
	bin="$BATS_TEST_TMPDIR/no-jq-bin"
	mkdir -p "$bin"
	for tool in bash cat mktemp rm date mkdir basename dirname grep env; do
		ln -sf "$(command -v "$tool")" "$bin/$tool"
	done
	for host in claude copilot; do
		run_hook "$host" "$HOOK" sessionstart.startup.json PATH="$bin"
		assert_hook_noop
	done
	# Positive control: the same PATH plus jq briefs.
	ln -sf "$(command -v jq)" "$bin/jq"
	for host in claude copilot; do
		run_hook "$host" "$HOOK" sessionstart.startup.json PATH="$bin"
		[[ "$(_ctx_of "$host")" == *"api-docs:rspress-docs"* ]]
	done
}

@test "the hooks files register SessionStart with no matcher and a 10s timeout" {
	jq -e '.hooks.SessionStart | length == 1' "$BUILDS/claude/hooks/hooks.json" >/dev/null
	jq -e '.hooks.SessionStart[0] | has("matcher") | not' "$BUILDS/claude/hooks/hooks.json" >/dev/null
	jq -e '.hooks.SessionStart[0].hooks[0].timeout == 10' "$BUILDS/claude/hooks/hooks.json" >/dev/null
	jq -e '.hooks.SessionStart | length == 1' "$BUILDS/copilot/com.github.copilot/hooks/hooks.json" >/dev/null
	jq -e '.hooks.SessionStart[0].timeoutSec == 10' "$BUILDS/copilot/com.github.copilot/hooks/hooks.json" >/dev/null
}
