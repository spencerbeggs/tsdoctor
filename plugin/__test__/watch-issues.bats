#!/usr/bin/env bats
# watch-issues.bats: covers the doc-build-issues monitor (monitors/watch-issues.mjs),
# which Claude Code runs and Copilot does not build. Every test runs the BUILT
# monitor through run_monitor, the way Claude Code starts it: from the project
# directory, with no CLAUDE_PROJECT_DIR, bounded by PLUGINFINITY_MONITOR_MAX_TICKS.

load "$BATS_TEST_DIRNAME/../node_modules/pluginfinity/bats/pluginfinity.bash"

BUILDS="$BATS_TEST_DIRNAME/../builds"

setup() {
	PROJECT="$BATS_TEST_TMPDIR/project"
	mkdir -p "$PROJECT/sites/x/.api-docs/build"
	ISSUES="$PROJECT/sites/x/.api-docs/build/issues.json"
}

_one_issue() {
	cat >"$ISSUES" <<'JSON'
{ "generatedAt": "t", "package": "@site/x", "target": "prod",
  "warnings": [ { "source": "twoslash", "level": "warn", "text": "Cannot find name 'Z'.", "code": "TS2304", "file": "a.mdx", "line": 1, "column": 1 } ],
  "errors": [], "suppressed": [] }
JSON
}

@test "reports a non-zero doc issue count found under the project" {
	_one_issue
	run_monitor claude doc-build-issues --ticks 1 API_DOCS_MONITOR_STABLE_POLLS=0
	assert_hook_exit 0
	[ "$output" = "docs: @site/x has 1 doc-build issue in prod — read .api-docs/build/issues.json and fix the examples (dispatch the api-docs:rspress-docs agent for the affected package); if a build or fixing agent is already in flight, let it finish before acting on this line" ]
}

@test "is silent when there are zero issues" {
	cat >"$ISSUES" <<'JSON'
{ "generatedAt": "t", "package": "@site/x", "target": "prod", "warnings": [], "errors": [], "suppressed": [] }
JSON
	run_monitor claude doc-build-issues --ticks 1 API_DOCS_MONITOR_STABLE_POLLS=0
	assert_hook_exit 0
	[ -z "$output" ]
}

@test "holds a count back until it is stable, then notifies once" {
	_one_issue
	# One stable poll needed: tick 1 sees the count, tick 2 confirms and fires,
	# tick 3 is deduped. Two 2s intervals sit between the three ticks.
	run_monitor claude doc-build-issues --ticks 3 --timeout 15 API_DOCS_MONITOR_STABLE_POLLS=1
	assert_hook_exit 0
	[ "$(printf '%s\n' "$output" | grep -c '@site/x has 1 doc-build issue')" -eq 1 ]
}

@test "a count not yet stable stays quiet" {
	_one_issue
	run_monitor claude doc-build-issues --ticks 1 API_DOCS_MONITOR_STABLE_POLLS=1
	assert_hook_exit 0
	[ -z "$output" ]
}

@test "stops after PLUGINFINITY_MONITOR_MAX_TICKS polls" {
	run_monitor claude doc-build-issues --ticks 2 --timeout 10
	assert_hook_exit 0
}

@test "copilot builds no monitors" {
	[ ! -e "$BUILDS/copilot/monitors" ]
	run_monitor copilot doc-build-issues
	[ "$status" -eq 1 ]
}
