---
"@tsdoctor/registry": minor
---

## Breaking Changes

`TypeResolver` now resolves manifests the way TypeScript does, through `@effected/package-json`'s `PackageExports`. Results change for some packages:

* Export conditions are walked in the manifest's own key order. A package that lists `import` before `types` now resolves to the declaration under `import`.
* JS targets go through TypeScript's extension substitution, so `./dist/index.mjs` resolves to `dist/index.d.mts` instead of the JS file.
* `typesVersions` is ignored when `exports` is present.
* `resolveImport` now resolves the root through `main` when `exports`, `types` and `typings` are absent.
* Trailing-slash folder export keys (`"./lib/": "./lib/"`) no longer resolve.
* `resolveTypeEntries` returns only the main entry when the `exports` map holds an invalid target.
