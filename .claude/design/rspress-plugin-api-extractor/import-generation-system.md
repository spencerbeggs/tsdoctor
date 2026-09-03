---
status: current
module: rspress-plugin-api-extractor
category: import-generation
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 88
related:
  - rspress-plugin-api-extractor/type-loading-vfs.md
  - rspress-plugin-api-extractor/multi-entry-vfs.md
  - rspress-plugin-api-extractor/configuration-system.md
---

# Import generation system

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [Integration flow](#integration-flow)
- [Reference classification](#reference-classification)
- [Import statement rules](#import-statement-rules)
- [Known limitations](#known-limitations)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

The `.d.ts` files reconstructed into the virtual file system declare a package's own types but reference types owned by other packages (`ZodType` from `zod`). Without `import type` statements for those references, Twoslash reports `Cannot find name` and hover tooltips break. The import generation system extracts external type references from the API Extractor model and prepends `import type` statements to each entry point's declaration file.

## Current state

| Concern | Where it lives |
| --- | --- |
| Reference extraction and import formatting (`TypeReferenceExtractor`, `ImportStatement`) | `packages/model/src/TypeReferenceExtractor.ts` |
| Prepending into the VFS (RSPress) | `prependImportsToVfs` in `platforms/rspress/src/layers/config-resolution.ts` |
| Prepending into the VFS (VitePress) | `platforms/vitepress/src/Generate.ts` |
| Hidden imports for example blocks | `prependHiddenImports` in `packages/pages/src/Examples.ts` |

## Integration flow

```text
ApiExtractedPackage.fromPackage(apiPackage, name).toVfs()
  -> node_modules/<name>/<entry>.d.ts   (declarations only)
        |
prependImportsToVfs(vfs, apiPackage, name)
  -> per entry point:
       TypeReferenceExtractor.extractImportsForEntryPoint(entryPoint)
       TypeReferenceExtractor.formatImports(imports)
       prepend to that entry's .d.ts
        |
combined VFS -> the Twoslash TypeScript environment
```

Per-entry extraction walks only the members exported from that entry, so each `.d.ts` imports only the external types it uses. Prepending runs immediately after `toVfs()` and mutates the VFS map in place (`multi-entry-vfs.md`).

## Reference classification

API Extractor encodes type references as canonical references of the form `packageName!symbolName:kind`. Each reference is sorted into one of three buckets: **built-in** (empty package name, or a quoted name such as a Node builtin — `Promise`, `Record`, `Buffer`) and **internal** (the package being documented, already declared in the VFS) are filtered out; everything else is **external** and becomes an `import type`.

Namespaced token text (`Schema.Struct`, `z.ZodType`) is reduced to its namespace root — the first dotted segment — not the leaf. The reconstructed declaration body keeps the qualified form verbatim, so the binding that must be in lexical scope is the namespace root; importing the leaf would leave the namespace identifier undefined and collapse `typeof X.Type` companion types to an error type, producing a false `TS2353`.

## Import statement rules

Generated imports are always type-only, named, deduplicated and sorted by package then symbol. `ImportStatement` (`packageName`, a `symbols` set, `typeOnly`) is the one shape that crosses the boundary; `formatImports` renders it. The same `ImportStatement[]` also feeds `prependHiddenImports`, which builds the `source` text of example blocks (`doc-ir-and-pages.md`).

## Known limitations

- A qualified reference imports only its namespace root; nesting depth is irrelevant because the body resolves the leaf through the root.
- Re-exports are not traced: imports assume the originating package owns the type.
- Generic type parameters are not extracted as references.

## Rationale

- **Why per entry point:** a `testing` entry must not import what only the main entry references, or the synthetic package's exports map stops describing reality.
- **Why the namespace root:** it is the package's importable export; the leaf is reachable through it and importing the leaf breaks the very companion pattern the docs are trying to render.

## Related documentation

- **Type loading and the VFS:** `type-loading-vfs.md`
- **Per-entry `.d.ts` generation:** `multi-entry-vfs.md`
- **Where prepending runs in config resolution:** `configuration-system.md`
