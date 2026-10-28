---
"@tsdoctor/vfs": minor
---

## Breaking Changes

`twoslashEntryKey` now returns `string | undefined` instead of `string`. It returns `undefined` when the compiler options cannot be canonicalized (for example, when they contain a function or a non-plain object). Blocks with such options are neither cached nor served from the cache. Callers that use the key directly must handle `undefined`.

```ts
const key = twoslashEntryKey(code, "ts", compilerOptions);
if (key !== undefined) {
	// safe to look up or store
}
```

## Features

* Compiler options are now folded into each Twoslash cache key through RFC 8785 canonicalization, so key order never changes a key and options set to `undefined` are treated as absent.
* `TWOSLASH_CACHE_FORMAT` is now `2`. Every persisted Twoslash cache is discarded once after upgrading, so the first build after upgrade is slower while the cache is rebuilt.

## Bug Fixes

* Non-`Error` values thrown inside the package now render their message or JSON in error text instead of `[object Object]`.
