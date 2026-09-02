---
"rspress-plugin-api-extractor": patch
---

## Bug Fixes

User-supplied `compilerOptions` are now **decoded rather than cast**. They arrive from plugin config as `unknown` and were asserted into the internal options type at the boundary, so a value the compiler could not act on reached the TypeScript environment unchecked. They now decode through `@tsdoctor/vfs`'s `decodeCompilerOptions`, and a value that cannot be mapped fails as a `ConfigValidationError` — reaching the `issues.json` artifact — instead of silently type-checking every example against something else. The same decode applies to the options returned by a `tsconfig` loader function.

Both cache-backed layers swallowed **interruption**. They degraded a failed cache construction with `Layer.catchCause`, which catches every cause — so a fiber being shut down was handed a working degraded cache instead of the interrupt propagating. The hand-written form got the hard half right (a sqlite driver reports construction failure as a *defect*, so a failure-only catch would miss the case the posture exists for) and this half wrong. Both now use `@effected/store`'s `Cache.degrading`, which catches failures and defects and propagates interruption.

A degraded cache and a genuinely cold one used to behave identically — every lookup misses — so a broken Twoslash cache directory read as "no cached results yet" on every build, forever, with the slowdown never explained. The service now surfaces whether the cache degraded at construction, and the console build summary reports which one happened.

## Refactoring

### The compiler-options seam moves to `@tsdoctor/vfs`

`tsconfig-parser.ts`, the whitelist type and `toProgrammaticCompilerOptions` now sit beside the `TsEnvironment` they configure. `DEFAULT_COMPILER_OPTIONS` is written entirely in the canonical tsconfig spelling; it previously mixed numeric enums for `target`/`module`/`moduleResolution` with tsconfig strings for `lib`, which is the confusion the decode step removes. The encoded values are unchanged, and a cold-cache build of the `multi` fixture site produced the same 230 Twoslash hovers across the same 129 code blocks as before. `TypeScriptConfig.compilerOptions` is typed as untrusted input rather than as the decoded options, so the two shapes can no longer be confused at a call site.

### Model handling moves to `@tsdoctor/model`

`ApiExtractedPackage` and `TypeReferenceExtractor` are imported from `@tsdoctor/model` rather than carried here. Both were framework-neutral — no RSPress, React, Shiki or HAST references between them — and belong with the rest of the API Extractor model handling. No behaviour change; the page generators, the VFS build and the import prepender call the same code from a new home.

### Virtual file system primitives move to `@tsdoctor/vfs`

`VirtualPackage` and the `Vfs` type are imported from `@tsdoctor/vfs` rather than `@tsdoctor/registry`, which no longer carries them — the same values from the same source, under a new package name.

`TwoslashCacheService` degrades one level down, at the `Cache` rather than around the service, so its separate degraded implementation is gone: the ordinary implementation running over an always-missing cache *is* the degraded behaviour, and a second implementation was only a way for the two to disagree. `TypeRegistryService` keeps a layer-level catch, because its construction can fail outside the cache — the XDG root and the type cache are independent failure sources — but that catch now re-raises an interrupting cause instead of degrading it, rebuilding the interrupt from the original cause's interruptors rather than raising it fresh. `Effect.interrupt` reports the *current* fiber as the interruptor, discarding the one that actually cancelled the build: measured against rc.109 it yields `[1]` where the original was `[4242]`. It misattributes rather than erases, which is the harder failure to notice — an empty interruptor set reads as "no attribution available", a wrong one reads as fact. Both directions are pinned, along with a regression test asserting that a hand-written `catchCause` over an interrupted layer *succeeds*, which is exactly the bug.

## Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/vfs | dependency | added | — | 0.0.0 |
