---
type: Gotcha
title: An undimensioned metric total outlives the build that produced it
description: Each build gets its own MetricStore, but an attribute-free metric's registry entry is resolved once and cached on the metric object, so undimensioned totals accumulate across dev HMR rebuilds and same-process test runs.
resource: ../../platforms/rspress/src/layers/build-metrics.ts
tags: [observability, testing]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 0160ccb356f03b57fda1bba6c5379114b54f6e43f6eb787d7f2940250158f858
status: stable
---

# An undimensioned metric total outlives the build that produced it

## What you see

A test asserts `Metric.value(BuildMetrics.externalPackagesTotal)` and gets
a number larger than the single build under test produced — or a dev
server's build summary keeps climbing across HMR rebuilds instead of
reporting that rebuild's own count.

## What you will wrongly conclude

That `makeMetricStore()`'s per-build isolation is broken, or that the
counter is being incremented twice somewhere in the pipeline.

## What is actually true

`makeMetricStore()`[^1] does give each build its own `Metric.MetricRegistry`
rather than the process-wide default the `Context.Reference` falls back to.
But that isolation only covers metrics recorded WITH attributes: Effect
resolves an attribute-free metric's registry entry once and caches the
hook on the metric object itself, so a module-level constant like
`BuildMetrics.externalPackagesTotal` or `BuildMetrics.apiVersionsLoaded`
keeps pointing at whichever registry touched it first, for the life of the
process. Attributed writes (the per-scope, per-component code-block
metrics) skip that cache and resolve against the calling context every
call, which is why the dimensioned report isolates cleanly while the
undimensioned totals stay cumulative — a second build in the same process
(dev HMR, or two tests in one vitest worker) sees the first build's count
plus its own.

`Metric.value` cannot detect a metric that escaped to the wrong registry:
it reads the right number whichever registry wrote it, because there is
only one registry as far as `Metric.value`'s own resolution is concerned.
Only `Metric.snapshot` taken through an explicit `metrics.layer` can prove
containment — by showing which registry's snapshot does or does not
contain the series.

## What to do

- Never assert an absolute value on an undimensioned `BuildMetrics`
  constant in a test that might share a process with another test
  touching the same constant; assert a delta (before/after), or isolate
  the assertion in its own test file the way
  `platforms/rspress/__test__/config-service-metrics.test.ts` does.
- To prove a metric reaches the intended registry rather than the process
  default, take a `Metric.snapshot` through that registry's `layer` and
  check containment — `Metric.value` alone proves nothing about which
  registry answered.
- Treat every undimensioned `BuildMetrics` total in a long-running dev
  session as cumulative across HMR rebuilds, not per-rebuild.

[^1]: [platforms/rspress/src/layers/build-metrics.ts](../../platforms/rspress/src/layers/build-metrics.ts)
