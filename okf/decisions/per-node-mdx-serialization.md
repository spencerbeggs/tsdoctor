---
type: Decision
status: draft
title: MDX pages serialize each block node separately, joins owned by the emitter
description: emitMdxBody serializes each block's mdast node as its own one-node Root and places the separators itself, because the kit's MDX-presence escaping is tree-wide.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: c5982ae55dcf97c5135cd895bd7f6b07ed87405bf8029dea86a3b75dd78633b1
---

# MDX pages serialize each block node separately, joins owned by the emitter

## Context

`platforms/rspress/src/emit/mdx.ts`'s `emitMdxBody` turns a `@tsdoctor/pages`
`Page` into MDX: JSX elements (`ApiSignature`, `ApiMember`, `ApiExample`)
carrying JSON-encoded props, tables as JSON props, and prose in between.
`@effected/markdown`'s stringifier escapes `{` throughout an entire tree the
moment any `MdxJsxFlowElement` is present anywhere in it — that escape is
presence-keyed at the tree level, not per node, and there is no stringify
option, per-node flag, or separator option to turn it off locally.
Serializing the whole page as one mdast tree would therefore have every
prose node's `{` characters escaped the instant one JSX block appears
anywhere on the page, corrupting plain prose that was never meant to carry
MDX syntax.

## Decision

Each top-level block's mdast node is serialized as its own one-node `Root`
(`stringifyNode`, `mdx.ts:111`, wrapping `Markdown.stringifyResult(Root.make({
children: [node] }))`), and the emitter itself places the separator between
blocks — a blank line, or the single newline between an enum's signature
and its members table — rather than assembling one page-wide tree and
serializing it once. `emitMdxBody` returns an Effect `Result` so a
stringify failure is typed rather than thrown (`mdx.ts:107`).

Generics escaping (`<T>`, `<K, V>`) runs on the mdast tree, not as a
string-level regex: a run inside a `Text` node is rewritten into an
`InlineCode` node (`escapeGenericsInPhrasing`, `mdx.ts:150-156`), which the
kit then serializes as backticked text. A string-level regex could not do
this, because by the time the kit has already escaped a bare `<` the
generic text no longer matches the original pattern. The escaping is
applied only where the RSPress adapter's earlier hand-written generator
classes applied it — the deprecation notice, member summaries and returns,
function-level parameter descriptions, the returns section, see-also
references, and the namespace member index — and deliberately not to
member-level parameter descriptions or enum member descriptions. That
inconsistency is a carried behavior, not an oversight to silently fix,
because the emitter's contract when it replaced the generator classes was
byte-identical output.

`@effected/markdown`'s own inline escaping stays minimal by design: `_` is
escaped only where it could bind emphasis, `&` only when entity-shaped, `>`
only at line start, `#` in a heading only as an ATX closing sequence, and a
`{#id}` heading suffix survives raw on a non-MDX tree. The one raw-output
hatch the kit offers is an inline `Html` node, whose `value` is emitted
verbatim on any tree — that is what a future collapse to one page-wide tree
would need to lean on for every pre-escaped run.

## Alternatives rejected

- **Serialize the whole page as one mdast tree and post-process the
  bytes.** Rejected twice over: it triggers the kit's tree-wide `{`
  escaping on every prose node the moment any JSX block exists, and
  `@effected/markdown` deliberately does not post-process its own output —
  there is no reversal shim to undo an escape it already applied.
- **Ask the kit for a per-node or opt-out escaping flag.** Declined as a
  kit change: the presence-keyed `{` escape is treated as a kit invariant,
  and the documented alternative is the `Html` node raw-output hatch, which
  the emitter does not yet use.
- **Apply generics escaping as a string-level regex before parsing.**
  Rejected because a regex cannot see through the kit's own escaping order,
  and because the exact set of prose fields that get escaped versus not
  is a byte-parity requirement inherited from the generator classes this
  emitter replaced — a regex pass over raw strings has no place to encode
  that field-by-field distinction cleanly.

## Consequences

- Adding a new block kind means adding a `stringifyNode` call and deciding
  its separator explicitly; nothing about page-wide serialization is
  automatic.
- The generics-escaping inconsistency (applied to some prose fields, not
  others) must be preserved until a labelled, deliberate product change —
  fixing it silently inside an unrelated refactor is exactly the class of
  change the byte-parity gate exists to catch.
- If `@effected/markdown` ever exposes a documented raw-output hatch beyond
  the `Html` node, collapsing to one page-wide tree becomes possible; until
  then, per-node serialization is load-bearing, not an implementation
  detail.
