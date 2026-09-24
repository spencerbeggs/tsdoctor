---
type: Decision
status: stable
title: Doc generation runs inside RSPress's config() hook
description: The RSPress adapter runs the whole doc generation program from config() rather than beforeBuild, because RSPress scans routes before beforeBuild runs.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 4ad7d7a1f9965e72f040042496921588f5ef26bd11b8e2f308c60b9b2f572eb5
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# Doc generation runs inside RSPress's `config()` hook

## Context

RSPress plugin hooks run in a fixed order: `config()`, then route
scanning, then `beforeBuild()`, then the actual build. A page that does
not exist on disk before route scanning never gets routed on a cold
start — generating pages from `beforeBuild()`, the hook whose name reads
as the natural place to generate build output, silently produces a site
missing every API page on the first run.

## Decision

`platforms/rspress/src/plugin.ts`'s `config()` hook[^1] runs the entire
doc generation program before returning: `VfsRegistry.clear()`,
`clearTypeRoutes()` and `clearTwoslashAccess()` reset per-build state,
`ConfigService.resolve()` produces the resolved API configs,
`installTwoslashAccess(yield* TwoslashEnvironments)`[^2] wires the
render-pass accessor, then `generateApiDocs()` runs per API config
concurrently, with the heartbeat forked only in production. `beforeBuild()`
is kept in the hook object but deliberately empty[^1] — the comment at its
call site states why, so a future reader does not "fix" it by moving
generation there again. `installTwoslashAccess` is wired here, beside the
other per-build seams in `config()`, rather than inside `ConfigService.layer`:
config resolution should compute a value, not mutate module-level state as
a side effect, and the render-pass accessor exists specifically because
the remark plugins run during RSPress's render pass outside any Effect
fiber.

`.api-docs/snapshot/`[^1] is created unconditionally at plugin factory
time, before `config()` runs and regardless of whether the plugin turns
out to be inert — SQLite does not create intermediate directories itself,
and a stray sync-island emitter can still force the main `ManagedRuntime`
to build even on the inert path.

The main `ManagedRuntime` is built once at plugin initialization and
shared across every hook. In development it survives HMR rebuilds
without being disposed, because disposing it would tear down the SQLite
connection the snapshot database holds open and break the next rebuild.
In production it is disposed in `afterBuild`, once the scope finalizers
(the WAL checkpoint, the highlighter release) can run without anything
else needing the runtime afterward.

## Alternatives rejected

- **Generate pages in `beforeBuild()`.** Rejected: RSPress has already
  scanned routes by the time `beforeBuild()` runs, so any page created
  there does not exist yet for routing purposes; this was the original
  bug the current placement fixes.
- **Delete the empty `beforeBuild()` hook entirely.** Rejected: keeping
  it, empty, with a comment recording why generation does not live there
  is what stops a future reader from "fixing" the omission by moving
  generation back into it.
- **Dispose the `ManagedRuntime` after every dev rebuild, matching
  production behaviour.** Rejected: disposal runs the scope finalizers,
  which close the snapshot database connection; disposing it on every
  HMR rebuild would break the very connection the next rebuild needs.

## Consequences

- Everything gated on an API model being present — model loading, the
  Twoslash accessor, per-API generation — only runs when the plugin is
  not inert; RSPress-facing wiring that must exist regardless (remark
  plugin registration, `source.include`) still runs even when inert.
- A production build that fails inside `config()` still gets a
  best-effort `issues.json` write from the `catch` block, because
  `afterBuild` never runs on a fatal `config()` failure.
- The snapshot directory existing does not imply the database has been
  opened — SQLite only opens the file when the `ManagedRuntime` is
  actually built, which the inert path skips.

[^1]: [platforms/rspress/src/plugin.ts](../../platforms/rspress/src/plugin.ts)
[^2]: [platforms/rspress/src/twoslash-access.ts](../../platforms/rspress/src/twoslash-access.ts)
