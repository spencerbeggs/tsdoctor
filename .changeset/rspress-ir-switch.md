---
"rspress-plugin-api-extractor": minor
---

## Breaking Changes

Four pieces of public surface that were decoded but never read by the build
are removed. None of them ever affected generated output, so a config that
set them behaves exactly as before once the key is deleted; a config that
still passes one now fails schema validation at plugin construction.

- `categories.<key>.tsdocModifier` — accepted on `CategoryConfig` but never
  consulted; items were always routed by `itemKinds`. Remove the key. There
  is no per-item category routing; rename the item instead.
- `externalPackages[].tsconfig` and `externalPackages[].compilerOptions` —
  accepted on each external package spec but never applied. Remove them and
  set `tsconfig` / `compilerOptions` at the API level (`api:` or each
  `apis:` entry), which is what every code example is type-checked under.
- `observability.thresholds.slowHttpRequest` — accepted and carried on the
  resolved thresholds, but no phase ever compared against it. Remove the key;
  the remaining thresholds are unchanged.
- The `LogLevel` type export — no plugin option was typed by it. Type
  `observability.logLevel` against its own values (`"none" | "error" |
  "warn" | "info" | "debug" | "trace" | "verbose"`) instead.

## Bug Fixes

Fixed a race in prose cross-linking on multi-API builds. The plugin used to
cross-link prose through a module-level holder swapped per API while
`generateApiDocs` ran multiple APIs concurrently, so whichever API installed
the holder last owned it for every page generated afterwards — on a
`multiVersion` site, v1 pages could link into v2's default-version routes;
on a multi-API site, one package's prose could be linked against another
package's route map. Cross-linking is now deterministic per API.

## Refactoring

Page generation now runs through `@tsdoctor/pages`: the eight hand-written
page generator classes are replaced by that package's `buildPage` builders
plus a local MDX emitter, verified byte-identical against the previous
output across every fixture site. This is an internal restructuring with no
change to generated output beyond the cross-link fix above.
