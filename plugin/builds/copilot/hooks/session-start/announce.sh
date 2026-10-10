#!/usr/bin/env bash
# hooks/session-start/announce.sh: SessionStart orientation hook for the api-docs
# plugin (no matcher: fires on every start, resume and compact, on both hosts).
#
# Adds one line of context pointing the main agent at the rspress-docs agent and
# the plugin's skills. One script serves Claude Code and Copilot: the
# pluginfinity hook library reads the envelope and writes each host's response
# shape (nested hookSpecificOutput on Claude Code, a flat additionalContext on
# Copilot). Without jq the library makes the hook a silent no-op. Nothing here
# may write to stdout except the final hook_context.
set -euo pipefail
# shellcheck source=/dev/null
. "$(dirname "$0")/../lib/pluginfinity/hook.sh"

# The agent id is <plugin>:<agent> on both hosts: what Claude Code's Agent tool
# and Copilot's task tool (and `copilot --agent`) take.
message='The api-docs plugin is active: for RSPress documentation work on sites using rspress-plugin-api-extractor, dispatch the api-docs:rspress-docs agent (or let its skills — twoslash, plugin-config, doc-writer, rspress-core — fire on their own). /api-docs:review [path] runs an editorial review; /api-docs:sync [path] updates prose after an API change.'

hook_context "$message"
