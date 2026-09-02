---
"@tsdoctor/model": minor
---

## Features

`ApiExtractedPackage` and `TypeReferenceExtractor` move here from the RSPress adapter, where they were framework-neutral code sitting behind a framework-specific package name. Both speak API Extractor's vocabulary, which is this package's domain, and a second adapter would otherwise have to import them from a package named after the first one.

### `ApiExtractedPackage`

Reconstructs `.d.ts` files from an `ApiPackage`, extending `VirtualPackage` from `@tsdoctor/vfs`. Emits one declaration file per entry point with enum values, full JSDoc, namespace members and every interface member kind, then renders the set to a `Vfs` with a synthetic `package.json`.

Two fidelity repairs it carries: `abstract` is propagated onto reconstructed class headers, and dts-rollup's `$N` disambiguation suffixes are stripped from reference tokens when they match the token's canonical symbol. Without either, the generated declarations produce false errors in a virtual TypeScript environment.

Its private `extractPlainText` is deliberately **not** `Tsdoc`'s prose extraction: it preserves `{@link X.Y}` syntax and reconstructs fenced code blocks, where `Tsdoc`'s flattens links to display text and drops fences. Now that the two live in one package, the declaration site says so.

### `TypeReferenceExtractor`

Extracts external type references from an API model and formats them as `import type` statements, so a reconstructed declaration file resolves the types it names. Classifies each canonical reference as built-in, internal or external, and reduces a namespaced reference to its namespace root — the binding that must be in lexical scope.

## Dependencies

`@effected/package-json` is dropped as a peer: it had zero imports in this package, and its only consumer was the `@alpha` `StructuredData` stub that phase 4 deleted.

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/vfs | dependency | added | — | 0.0.0 |
| @effected/package-json | peerDependency | removed | catalog:effected | — |
