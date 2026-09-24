---
type: Decision
status: stable
title: Consolidate into one monorepo
description: Move the type registry, the model library and the RSPress plugin into one monorepo under packages/ and platforms/.
tags: [architecture, release]
generated:
  by: okfit/claude-code
  at: 2026-09-24T20:28:47Z
  body_sha256: 5bc538948ea7c5bb049651e72ae0461392453ff683c408d4548cf5f58742367c
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# Consolidate into one monorepo

## Context

Before this repository existed, `type-registry-effect` (the Effect v4 type
registry) and `api-extractor-llms` (TSDoc/api.json extraction) lived as
separate repositories the RSPress plugin depended on externally, and the
plugin itself lived in a `package/` folder alongside its own site fixtures.
A change to either support library needed two release hops — publish the
library, then bump it in the plugin — before it reached the plugin at all.

## Decision

Move both support libraries and the plugin into one monorepo with
workspace globs `modules/*`, `packages/*`, `platforms/*`, `sites/*`:

- `type-registry-effect` moved in verbatim as `packages/registry`, renamed
  `@tsdoctor/registry`[^1], with its peer-dependency closure preserved
  exactly, since those peer rules exist for Effect-version resolution
  safety and the move changed the repository, not the resolution model.
  That clause alone is superseded: which `@effected` edges are peers is
  now decided by
  [core-peers-follow-public-surface](core-peers-follow-public-surface.md).
- `api-extractor-llms` seeded `packages/model` as `@tsdoctor/model`[^2],
  dropping its template peers in favor of plain dependencies on
  `@microsoft/api-extractor-model` and `@microsoft/tsdoc`.
- The plugin workspace moved from `package/` to `platforms/rspress/`[^3]
  by `git mv`, preserving history and pre-allocating the sibling location
  used later for `platforms/vitepress/`.

Both packages started fresh at 0.x rather than continuing the registry's
prior 2.x line — a repository-owner decision made explicit at the time of
the move — because the new package name (`@tsdoctor/registry`) is a new
package, and a fresh line keeps the org's semver coherent. Both packages
release from this monorepo through the `@savvy-web/changesets` flow,
publishing to npm only, tagged `<package>@<version>`; the `.changeset/config.json`
`repo` field names `spencerbeggs/tsdoctor`[^4].

Two identity strings were deliberately kept unchanged during the move
itself, because renaming them is observable: the registry's
`Context.Service` tag ids and the plugin's XDG cache namespace. Both were
renamed afterward — to `"@tsdoctor/registry/..."` and `"tsdoctor"`
respectively — accepting a one-time cold cache/refetch as the cost of the
rename, once the move's own no-behavior-change gate had already passed.

At the point of consolidation, `type-registry-effect` and
`api-extractor-llms` were `npm deprecate`d with pointers at their
successors, and both GitHub repositories were archived as historical
provenance. The repository owner was the only known consumer of both, so
no migration guide beyond the deprecation message was written.

## Alternatives rejected

- **Keep the libraries as separate repositories and only move the
  plugin.** Rejected: this preserves the two-release-hop latency the
  consolidation exists to eliminate.
- **Continue the registry's existing 2.x version line under the new
  name.** Rejected in favor of a fresh 0.x line: `@tsdoctor/registry` is a
  new package identity, and continuing a version line under a new name
  would misstate what changed.
- **Rename the service tag ids and XDG namespace during the move.**
  Rejected: bundling an observable rename into a move whose gate was "no
  behavior change" would have made a real regression indistinguishable
  from an intended relabeling. The rename shipped as a separate, later
  change.

## Consequences

- Workspace globs `packages/*` and `platforms/*` are the load-bearing
  layout; a package's location signals whether it is framework-neutral
  core or a framework adapter.
- `pnpm --filter` on either former standalone library now matches
  `@tsdoctor/registry` / `@tsdoctor/model`, not the old npm names — the
  old names resolve to nothing in this workspace.
- The one-time XDG namespace rename means any pre-consolidation on-disk
  cache under the old namespace is orphaned and never read again; this
  was accepted rather than migrated.
- Releases are tagged `<package>@<version>` in this repository's tag
  history, not the two former repositories'; anyone auditing provenance
  before the consolidation date must consult the archived repos.

[^1]: [packages/registry/package.json](../../packages/registry/package.json)
[^2]: [packages/model/package.json](../../packages/model/package.json)
[^3]: [platforms/rspress](../../platforms/rspress)
[^4]: [.changeset/config.json](../../.changeset/config.json)
