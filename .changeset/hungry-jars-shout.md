---
"rspress-plugin-api-extractor": minor
---

## Bug Fixes

### Member anchors and cross-links now point at the same place

A class or interface member's `#fragment` and the `id=` the page rendered were computed by two different sanitizers. A member named `get_value` was linked as `#get-value` and rendered as `id="get_value"`, so the cross-link landed nowhere. Both sides now derive anchors from one function in `@tsdoctor/model`.

Separately, a class with both a `static create()` and an instance `create()` emitted the *same* id for both members — two elements sharing one HTML id, with the instance member displaced from the anchor its own cross-link pointed at. Each member now gets its own.

**Migration.** Anchor URLs change for affected members:

| Member | Old fragment | New fragment |
| :----- | :----------- | :----------- |
| `get_value` | `#get_value` | `#get-value` |
| `MY_CONST` | `#my_const` | `#my-const` |
| `static create()` | `#static-create` | `#create` |
| `create()` instance | `#static-create` | `#instance-create` |

Only members whose names contain `_` or `$`, and members involved in a static/instance name collision, are affected. Nothing that previously worked breaks — the id and the link already disagreed, so no *functioning* deep link used the old pair — but external links written against the old fragments need updating, and any bookmark to a colliding member should be re-checked.

Regenerated pages differ in those `id=` attributes, so the snapshot database marks the affected pages modified on the next build and their `article:modified_time` bumps.

A bare `Class.member` cross-link reference now resolves to the **static** member when a class has both, matching TypeScript's own access expression. `Class.(member:instance)` and `Class.prototype.member` reach the instance one.

### Scoped package names no longer render with stray quotes

The API index page built its `description` by interpolating a YAML-escaped package name **into** a larger string, so the escaping quotes ended up as literal characters in the value. A scoped package rendered as:

```yaml
description: "Auto-generated API documentation for \"@modules/kitchensink\""
```

The value is now assembled and quoted by the frontmatter emitter as a whole, so it parses back as `Auto-generated API documentation for @modules/kitchensink`. Only packages whose names require YAML quoting — scoped names above all — were affected, and only on the generated API index page.

### Twoslash now loads the standard library on the default configuration

`lib` was passed to the compiler in the `tsconfig.json` spelling (`["ESNext", "DOM"]`) where the compiler API expects file names (`["lib.esnext.d.ts", "lib.dom.d.ts"]`). Four of the five configuration paths therefore loaded **no** standard library at all, so Twoslash could not resolve `Promise`, `Array` or any DOM global. The diagnostics were suppressed by `noErrorValidation`, so this surfaced as hovers rendering `any` rather than as build errors.

Conversion now happens at a single seam, and accepts either spelling.

**This can surface diagnostics that were previously invisible.** A site with no `tsconfig.json` in its bundle was not type-checking its `@example` blocks in any meaningful sense; now it is, and genuine errors in those examples will appear in `.api-docs/build/issues.json`. They are not new errors — they were always there. Sites that declare `lib` in a discovered `tsconfig.json` are unaffected, as that path was already correct.

Note that declaring `lib` replaces the default array wholesale rather than merging with it, so a `tsconfig.json` saying `lib: ["esnext"]` yields no DOM globals regardless of the plugin default.
