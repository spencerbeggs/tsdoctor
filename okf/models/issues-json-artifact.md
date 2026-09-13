---
type: DataModel
title: issues.json artifact
description: The per-build diagnostic snapshot written to .api-docs/build/issues.json on production builds.
resource: ../../platforms/rspress/src/observability/sinks/issues-sink.ts
tags: [observability, ci]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 0d1aed55cc14d0126d9d673b79745bfe87d8cf84f3836bd119268dd2868957fc
sources:
  - id: issues-sink-src
    resource: ../../platforms/rspress/src/observability/sinks/issues-sink.ts
  - id: watch-issues-monitor
    resource: ../../plugin/monitors/watch-issues.mjs
---

# `issues.json` artifact

On a production build, `writeIssuesJson` serializes the accumulated
diagnostic events for one API into
`<cwd>/.api-docs/build/issues.json`.[^issues-sink-src] It sits beside
`render-phase.json` and the opt-in `trace-<buildId>.jsonl` under
`.api-docs/build/`, the directory regenerated every run (as opposed to
`.api-docs/snapshot/`, which a consumer site may choose to commit).

## What an entry contains

The written document is:

```ts
interface IssuesSnapshot {
 readonly warnings: Issue[];
 readonly errors: Issue[];
 readonly suppressed: Issue[];
}
interface Issue {
 readonly source: string;
 readonly level: "warn" | "error";
 readonly text: string;
 readonly code: string;
 readonly file: string;
 readonly line: number;
 readonly column: number;
 readonly api?: string;
}
```

wrapped with `generatedAt`, `package` and a fixed `target: "prod"` — the
same shape field for field as `@savvy-web/bundler`'s own `issues.json`,
plus one addition this artifact needs and the bundler's does not: the
per-`Issue` optional `api` field, carrying which API scope produced it on a
multi-API site.[^issues-sink-src]

## What derives an entry: the event-to-bucket mapping

`eventToIssue(event)` is the collector: `makeIssuesSink()` calls it on
every `PluginEvent` that reaches the bus and always-on (collection is
cheap; only the file write is `isProd`-gated).[^issues-sink-src]

| Event | Bucket | `source` | `code` |
| --- | --- | --- | --- |
| `TwoslashDiagnostic` | `warnings` | `twoslash` | `TS<code>` |
| `TwoslashCheckFailed` | `warnings` | `twoslash` | `TS<code>` |
| `PrettierError` | `warnings` | `prettier` | `prettier` |
| `ShikiError` | `warnings` | `shiki` | `shiki` |
| `ConfigValidationWarning` | `warnings` | `config` | `config-validation` |
| `RouteCollisionDetected` | `errors` | `routing` | `route-collision` |
| `ModelLoadFailed` | `errors` | `model` | `model-load-failed` |
| `BuildFailed` | `errors` | `build` | `build-failed` |

Every other event `_tag` maps to `null` and is not collected.[^issues-sink-src]

`suppressed` is always present in the written document and always empty:
no event in the current taxonomy distinguishes a diagnostic silenced by
`suppressExampleErrors` / `@noErrors` from one that surfaced, so the bucket
is reserved for schema parity with the bundler artifact rather than ever
populated.[^issues-sink-src]

## When it is written

Two write paths, both `isProd`-gated: the normal path in `afterBuild` on
the first build, and a best-effort write from `config()`'s own `catch`
block for a build that fails before `afterBuild` ever runs — a
`RouteCollisionDetected` or `ModelLoadFailed` emitted just before a fatal
throw would otherwise never reach disk. The write is wrapped so a failure
to write the artifact itself can never mask the original build
error.[^issues-sink-src]

## Who reads it

`plugin/monitors/watch-issues.mjs` polls
`**/.api-docs/build/issues.json` (excluding `node_modules`) and notifies
once a file's total issue count (every entry across `warnings` and
`errors`) settles unchanged across a configurable number of stable polls —
avoiding a notification mid-build while the count is still
climbing.[^watch-issues-monitor] The `rspress-docs` agent is the intended
fix loop: read the artifact, then act on the affected package.

## What breaks if an entry is wrong

- **A mis-bucketed error hides a fatal build.** Only `RouteCollisionDetected`,
  `ModelLoadFailed` and `BuildFailed` land in `errors`; everything else in
  the table lands in `warnings` regardless of how severe the underlying
  diagnostic feels. An event that should have been typed as one of those
  three but instead falls through `eventToIssue`'s `default: null` case is
  invisible to this artifact entirely — a build that failed loudly in the
  console leaves no trace here for the monitor or the fix-loop agent to
  find.
- **A wrong `code` or `source` misdirects the fix loop** — the fields are
  the only structured signal `watch-issues.mjs` and a downstream agent have
  to decide which subsystem (`twoslash`, `prettier`, `shiki`, `config`,
  `routing`, `model`, `build`) owns the failure.
- **The monitor notifies on a settled COUNT, not on file identity.** Because
  `diagnose` compares total counts across polls, two different errors that
  happen to keep the count constant across a rebuild would not re-trigger a
  notification — the artifact's shape gives no per-issue identity to diff
  against.

[^issues-sink-src]: `platforms/rspress/src/observability/sinks/issues-sink.ts`
[^watch-issues-monitor]: `plugin/monitors/watch-issues.mjs`

See also [rspress-plugin-api-extractor module](../modules/rspress-plugin-api-extractor.md),
[api-docs-claude-plugin module](../modules/api-docs-claude-plugin.md) and the
[synchronous-event-bus decision](../decisions/synchronous-event-bus.md).
