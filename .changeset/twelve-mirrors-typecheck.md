---
"rspress-plugin-api-extractor": minor
---

## Features

### Per-API TypeScript configuration is now honored

In multi-API mode, Twoslash previously type-checked every code example in one shared TypeScript environment: the first entry in the `apis` array that declared a `tsconfig` or `compilerOptions` won for the whole build, and the plugin warned when other entries disagreed. Each documented API is now type-checked under its own configuration, including user-authored ` ```ts with-api ` fences on that API's own pages — those previously always ran under the first environment regardless of which package's page they appeared on.

```typescript
apis: [
  {
    packageName: "@my/pkg-a",
    model: "./pkg-a/api.json",
    tsconfig: "./pkg-a/tsconfig.json",
  },
  {
    packageName: "@my/pkg-b",
    model: "./pkg-b/api.json",
    compilerOptions: { strict: false },
  },
],
```

`tsconfig` and `compilerOptions` merge on top of the defaults rather than replacing them, so declaring one option overrides just that option. APIs that declare the same configuration share one environment. The `ConfigCascadeWarning` this behavior used to produce is gone.

One nuance: only the compiler *configuration* is per-API — the underlying file set stays shared across all documented APIs, which is what lets a type owned by one package resolve when another package's page references it.

### Twoslash results are cached between builds

Type-checking code examples was measured at ~97% of render-phase code-block time. Twoslash results are now cached between builds and reused when nothing that could affect them has changed — on a two-API fixture site the render phase dropped from 8.1s to 0.2s on a warm cache, with byte-identical output.

The cache lives in the user's XDG cache directory (`~/.cache/tsdoctor/twoslash.sqlite`) — nothing to commit or gitignore. Each entry is keyed on the code, the compiler options, the declarations it was checked against and the TypeScript version that checked them, so it never serves a stale result — a compiler upgrade starts a fresh generation even against unchanged declarations; the trade-off is coarse invalidation, so repeat builds over an unchanged API become nearly free (CI re-runs, prose-only edits, theme changes) while a build right after an API item changes gets no benefit. Every failure path (a missing cache directory, an unreadable entry) degrades to a cache miss rather than failing the build. The end-of-build summary now logs a `Twoslash cache: N/N hits (P%), N entries` line.

### Richer build diagnostics

Production builds now also write `.api-docs/build/render-phase.json`, alongside the existing `issues.json`, with per-scope, per-component and per-file code-block timings plus the slowest blocks observed. The end-of-build summary gained a per-scope render-phase breakdown, and its per-phase timing line now names each phase and its duration instead of only counting how many phases ran.
