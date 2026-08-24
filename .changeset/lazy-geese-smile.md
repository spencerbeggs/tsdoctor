---
"rspress-plugin-api-extractor": minor
---

## Maintenance

The plugin's internals were reorganized around the four `@tsdoctor/*` core packages (`@tsdoctor/model`, `@tsdoctor/registry`, `@tsdoctor/bundle`, `@tsdoctor/snapshot`); generated documentation output and the public plugin configuration API are unchanged. Two effects are visible on upgrade:

* **One-time type-cache invalidation.** The XDG cache namespace used for external type loading is renamed from `"type-registry-effect"` to `"tsdoctor"`, so the first build after upgrading does a cold refetch of any cached external package types. Subsequent builds are unaffected.
* **Frontmatter scalars are now double-quoted.** Frontmatter parsing/emission moved off `gray-matter` onto a YAML 1.2-based implementation; regenerated pages may show a frontmatter diff (double-quoted strings instead of unquoted/single-quoted) even when their content is otherwise unchanged.

The snapshot database implementation and `fromDir`/`fromParentDir` bundle discovery now live in the new `@tsdoctor/bundle` and `@tsdoctor/snapshot` workspace dependencies.
