---
type: Limitation
title: Generated imports do not trace re-exports
description: TypeReferenceExtractor assumes a canonical reference's own package owns the type it names, so a type re-exported through an intermediate package imports from the wrong place and Twoslash reports a false "Cannot find name."
bounds: ../modules/tsdoctor-model.md
tags: [compat]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: a69c0e805633bd9408406e64fbc2affc2825746dff6b5f9df02362dc4e247805
status: stable
---

# Imports do not trace re-exports

## Trigger

A documented package's declaration references a type whose canonical
reference names package `A`, but `A` itself only re-exports that type from
package `B` — it does not declare it. `TypeReferenceExtractor` classifies
every non-built-in, non-internal canonical reference as external and imports
it from the package the reference names,[^1] with no step that resolves
through a re-export chain to the type's actual originating package.

## Symptom

The generated `.d.ts` in the virtual file system gets `import type { X }
from "A"` when `X` is really declared in `B` and merely re-exported by `A`.
If `A`'s own type declarations do not re-export `X` under the same name (or
`A` is not even a runtime dependency of the documented package), Twoslash's
type-check reports `Cannot find name 'X'` on a declaration that is otherwise
correct. A related gap: generic type parameters on a reference are never
extracted as references at all, so a generic-parameter-only external type can
be missing from the generated imports entirely regardless of the re-export
question.

## Why this is acceptable

API Extractor's canonical reference format encodes only "which package's
symbol table does this name resolve in," not "which package originally
declared it" — tracing the latter would mean walking each candidate
package's own re-export graph, which the extractor has no access to without
loading and analyzing every intermediate package's declarations, not just
the one being documented. In practice most external references are declared
directly by the package that exports them, so the gap is narrow.

## What a fix would take

Resolving a canonical reference to its originating package needs either (a)
API Extractor itself to encode the true declaring package in the canonical
reference — a change to Extractor's own output, out of this project's
control — or (b) `TypeReferenceExtractor` gaining access to the resolved
`.d.ts` of every intermediate package (via the same VFS/registry pipeline
that supplies external types) so it can follow an `export { X } from` chain
before emitting the import line. Extracting generic type parameters as
references is a smaller, separate addition: walking a token's type-argument
list, not just its own symbol.

A related manifest-side gap sits in the same area: the synthetic
`package.json` `VirtualPackage` writes emits only the simple `{ "types": ... }`
form per entry — no conditional exports — and does not flatten nested entry
names such as `./utils/helpers`, so a re-export chain that depends on
conditional export resolution cannot be reproduced in the VFS at all.[^2]

[^1]: packages/model/src/TypeReferenceExtractor.ts:74-84
[^2]: packages/vfs/src/VirtualPackage.ts:89-138
