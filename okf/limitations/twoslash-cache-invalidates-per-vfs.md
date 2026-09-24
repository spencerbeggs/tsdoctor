---
type: Limitation
title: The Twoslash result cache invalidates per whole VFS, not per package
description: twoslashEnvHash keys a cache generation on the combined virtual file system plus the TypeScript version, so any documented package changing invalidates every package's cached results in one build.
bounds: ../modules/tsdoctor-vfs.md
tags: [performance, compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 14dd6014c0e8225ab3d0af6853f01c872aabe0526907199e4f613a71b7839d16
status: stable
---

# Twoslash cache invalidates per VFS, not per package

## Trigger

A multi-API build where one documented package's declarations change between
builds. `twoslashEnvHash` fingerprints a cache generation from the whole
combined virtual file system plus the TypeScript compiler version — not per
package.[^1] The cache key format is versioned separately by
`TWOSLASH_CACHE_FORMAT`, a manual constant bumped only when
`@shikijs/twoslash` or `twoslash` themselves are upgraded, since the stored
node shape depends on those packages' rendering version rather than on
anything the environment hash already covers.[^2]

## Symptom

The build immediately after any single documented package's API changes gets
zero cache hits across the entire site — every package's code blocks
re-type-check from scratch, not just the changed one's. This is because
every documented package's declarations live in one shared VFS (so
cross-package `import type` references can resolve), and the shared VFS is
exactly what the generation key covers.

## Why this is acceptable

The cache targets repeat builds where nothing changed — CI re-runs, prose-only
edits, theme and config changes — which is the overwhelming majority of
builds in practice; a warm build's render phase measured over an order of
magnitude faster than cold on the `sites/multi` fixture. Soundness is what
makes the coarse invalidation safe to rely on at all: the alternative,
granular per-package invalidation, would require guaranteeing that a
package's cached result is genuinely unaffected by every other package's
declarations, which is false precisely because the VFS is shared for
cross-package type references to resolve.

## What a fix would take

A per-package cache key would need the shared file set split so each
package's generation hash covers only the declarations it can actually be
affected by — but that is the same split that currently makes cross-package
`import type` resolution work, so splitting it breaks the very feature the
shared VFS exists for. This is recorded as not planned, not merely
unscheduled: a fix requires resolving that tension first, which nothing in
the current design attempts.

[^1]: packages/vfs/src/TwoslashCache.ts:108-129
[^2]: packages/vfs/src/TwoslashCache.ts:19-36,66
