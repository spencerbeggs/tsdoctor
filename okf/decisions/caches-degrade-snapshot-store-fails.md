---
type: Decision
status: stable
title: The type and Twoslash caches degrade; the snapshot store fails
description: TwoslashCacheService and TypeRegistryService degrade to a cache miss on failure; SnapshotService.layer stays fatal with StoreError | StoreMigrationError, because a silently regenerated snapshot corrupts the timestamps a crawler reads as authoritative.
tags: [architecture, performance]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 37e5025b2399c120e57a7ab696ea0c7be026fda55c24b9755151e9e4bc82dc15
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# The type and Twoslash caches degrade; the snapshot store fails

## Context

Three RSPress adapter services acquire a resource at `ManagedRuntime`
construction rather than per method call: `TypeRegistryService`,
`TwoslashCacheService`[^1] and `SnapshotService`[^2]. In Effect v4,
`provideLayer` is a `scopedWith` over `buildWithScope` that forks a child
`MemoMap` whose parent never actually built the layer — so per-method
provision would build and tear down the registry stack and the Twoslash
cache twice per build. Each of the three can fail to acquire its resource
(no `HOME` for XDG, an unwritable cache database, a corrupt or
unmigratable SQLite file), and each failure needs a posture: whether the
build should continue in a degraded state or stop.

## Decision

`TwoslashCacheService.layer` and `TypeRegistryService.layer` must degrade
to a cache miss rather than fail — a build that loses access to either
cache is still a correct build, just a slower one, and an unreachable or
corrupt cache must not break a build that would otherwise succeed.
`TwoslashCacheService.layer`[^1] degrades through `@effected/store`'s
`Cache.degrading(CacheLive)`, not a hand-written `Layer.catchCause`: a
hand-written catch absorbs every cause including interruption, so a fiber
being interrupted during shutdown was previously handed a working
degraded cache instead of actually stopping. Degrading at the `Cache`
level also means the ordinary behaviour over an always-missing cache
already is the degraded behaviour, so there is no second implementation
to keep in step. `TypeRegistryService`[^3] keeps a hand-written
`Layer.catchCause` because its construction can fail outside the cache
itself (no `HOME` for XDG, an unwritable metadata database), and that
catch explicitly re-raises interruption by rebuilding the cause from
`Cause.interruptors(cause)` so the recorded interruptor stays the
original fiber rather than being absorbed.

`SnapshotService.layer(dbPath)`[^2] is the deliberate counter-example: its
error channel stays `StoreError | StoreMigrationError` all the way to the
application layer. It is built on `@effected/store`'s `Store.layerSqlite`
with `checkpointOnClose: true`, and a database that cannot be opened or
migrated stops the build loudly rather than silently regenerating every
page's snapshot. `CacheShape.degraded` is surfaced on
`TwoslashCacheServiceShape` specifically so a degraded cache and a
genuinely cold one are distinguishable in the build summary — without the
flag, an unusable cache reports identically to a cache that is merely
cold on a fresh clone.

## Alternatives rejected

- **Use a hand-written `Layer.catchCause` for the Twoslash cache too,
  matching the type registry.** Rejected: `catchCause` absorbs
  interruption along with every other cause, and a cache-backed layer
  interrupted during shutdown was previously handed a working degraded
  cache and carried on rather than actually stopping.
- **Make `SnapshotService.layer` degrade like the two cache layers.**
  Rejected: a cache miss costs build time; a silently regenerated
  snapshot corrupts the `publishedTime` / `modifiedTime` timestamps a
  crawler reads as authoritative. The failure posture follows what the
  loss would cost, and those two costs are not comparable.
- **Acquire each service's resource per method call instead of once at
  `ManagedRuntime` construction.** Rejected: Effect v4's `provideLayer`
  forks a child `MemoMap` per call, so per-method provision opens and
  tears down the registry stack and the Twoslash cache twice for every
  build rather than once.

## Consequences

- A build with no reachable Twoslash cache or type registry still
  succeeds; only its speed and the summary's `degraded` flag change.
- A build with a corrupt or unmigratable snapshot database stops before
  it does any doc generation, because `SnapshotService.layer`'s failure
  surfaces the moment the main `ManagedRuntime` is built.
- Any new cache-backed service added to the adapter inherits the same
  question — degrade or fail — and the answer is decided by what a
  silent loss would cost, not by matching whatever the nearest existing
  service already does.

[^1]: [platforms/rspress/src/services/TwoslashCacheService.ts](../../platforms/rspress/src/services/TwoslashCacheService.ts)
[^2]: [packages/snapshot/src/SnapshotService.ts](../../packages/snapshot/src/SnapshotService.ts)
[^3]: [platforms/rspress/src/services/TypeRegistryService.ts](../../platforms/rspress/src/services/TypeRegistryService.ts)
