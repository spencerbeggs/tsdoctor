---
status: current
module: rspress-plugin-api-extractor
category: source-mapping
created: 2026-05-26
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 88
related:
  - rspress-plugin-api-extractor/multi-entry-point-support.md
  - rspress-plugin-api-extractor/multi-entry-resolution.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/import-generation-system.md
---

# Multi-entry VFS generation

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [ApiExtractedPackage](#apiextractedpackage)
- [Excerpt rendering and reference fidelity](#excerpt-rendering-and-reference-fidelity)
- [VFS layout](#vfs-layout)
- [Known limitations](#known-limitations)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

To give Twoslash a TypeScript project it can type-check against, the plugin reconstructs `.d.ts` files from the API Extractor model and writes them into a virtual file system under `node_modules/<package>/`. Each entry point gets its own declaration file, and the synthetic `package.json` exposes them via a `types` field (single entry) or an `exports` map (multiple entries) so TypeScript resolves cross-entry references the way the real package would.

## Current state

| Concern | Where it lives |
| --- | --- |
| `ApiExtractedPackage` (declaration reconstruction) | `packages/model/src/ApiExtractedPackage.ts` |
| `VirtualPackage` (the VFS map and `package.json` synthesis) | `packages/vfs/src/VirtualPackage.ts` |
| Import prepending after `toVfs()` | `import-generation-system.md` |

## ApiExtractedPackage

`ApiExtractedPackage` extends `VirtualPackage` from `@tsdoctor/vfs` and overrides declaration generation to emit high-fidelity `.d.ts` output from an `ApiPackage` — enum values, full JSDoc, namespace members and every interface member kind — while delegating the VFS map and `package.json` synthesis to the base class. `VirtualPackage` is a Schema class whose constructor takes `{ name, version, entries }` and validates at construction, so the entries map must be complete before `super` runs.

Factories: `fromApiModel(modelPath)` loads an `.api.json`; `fromPackage(apiPackage, packageName)` builds from an in-memory `ApiPackage`. `fromPackage` walks the entry points, derives each file name (`index.d.ts` for the main entry, `<name>.d.ts` for named entries) and generates declarations for each. Because generation is an instance method but the instance cannot be constructed without its entries, `fromPackage` uses a scratch instance with a placeholder entries map to build the real map, then constructs the returned instance from it.

`ApiExtractedPackage` keeps its own private `extractPlainText`, which is not the model's prose extraction: it preserves `{@link X.Y}` syntax and reconstructs fenced code blocks for faithful JSDoc, whereas prose extraction flattens links and drops fences. They are not interchangeable.

## Excerpt rendering and reference fidelity

Excerpts are rendered token by token through a private `renderExcerpt` rather than read as raw `excerpt.text`, which repairs two fidelity hazards that otherwise emit false Twoslash errors:

- **The abstract modifier** is propagated onto reconstructed class headers, including through the namespace-nested class path. The body keeps abstract members, so dropping the modifier on the header produces "abstract member in a non-abstract class" in the VFS.
- **dts-rollup `$N` aliases** are normalized: the rollup renames a re-imported symbol `Name$1` while its canonical reference stays `Name`, and the import prepender imports the canonical name, so emitting the suffixed text leaves `Name$1` undefined. The suffix is stripped only when the de-suffixed text matches the token's canonical symbol, so identifiers that genuinely end in `$N` are untouched.

## VFS layout

`VirtualPackage.toVfs()` returns a `Vfs` (a `Map<string, string>`) prefixed with `node_modules/<package>/`:

```text
Single entry:                       Multiple entries:
node_modules/my-package/            node_modules/my-package/
  index.d.ts                          index.d.ts
  package.json  { "types": … }        testing.d.ts
                                      package.json  { "exports": { ".": …, "./testing": … } }
```

The `types`-versus-`exports` decision lives in `VirtualPackage`, driven by the entry count; `ApiExtractedPackage` only supplies the entries. Two structural errors throw at construction: declaring `package.json` as an entry, and two entry file names that normalize to the same export key. `toVfs()` emits declarations only; external references are prepended afterwards (`import-generation-system.md`).

## Known limitations

- The synthetic `package.json` emits only the simple `{ "types": … }` form per entry, not conditional exports.
- Nested entry names such as `./utils/helpers` are carried through as file names but not specially flattened.

## Rationale

- **Why reconstruct from the model rather than ship the real `.d.ts`:** the model is the plugin's input contract (`bundle-spec.md`); a bundle carries no declaration files, and reconstructing them keeps the type environment a pure function of the model.
- **Why the scratch instance:** the Schema class validates on construction, and the alternative — constructing with an empty map and mutating it — is exactly what that validation forbids.

## Related documentation

- **Overview linking both subsystems:** `multi-entry-point-support.md`
- **Deduplication and route collisions:** `multi-entry-resolution.md`
- **The VFS's consumer:** `type-loading-vfs.md`
- **Import prepending:** `import-generation-system.md`
