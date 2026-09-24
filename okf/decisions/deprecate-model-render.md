---
type: Decision
status: stable
title: Deprecate the model's Render module in favour of @tsdoctor/pages
description: Mark Render.tree / Render.item / Render.docs @deprecated in packages/model, pointing consumers at renderMarkdown in @tsdoctor/pages, with deletion planned a minor after the deprecation ships.
tags: [architecture, release]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: c89de21e7f269f90e070a7a322c7b2f3d7fe6d77b0a75720bbdd939ac8a72437
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# Deprecate the model's `Render` module in favour of `@tsdoctor/pages`

## Context

`packages/model/src/Render.ts`[^1] used to be the plugin's body renderer:
`Render.tree`, `Render.item` and `Render.docs` turned an `ApiItem` into
markdown text. Once `@tsdoctor/pages` lifted the page generators into a
typed IR — facts, blocks, a navigation entry, not just a body — the RSPress
adapter switched to `buildPage` and `renderMarkdown`/`renderMarkdownResult`
in `packages/pages/src/Markdown.ts`[^2], and `Render` had no remaining
in-tree consumer. `@tsdoctor/model` cannot depend on `@tsdoctor/pages`
without creating a cycle: `@tsdoctor/pages` already depends on
`@tsdoctor/model` for items, TSDoc, routes and anchors, so `Render` cannot
simply re-export or delegate to `renderMarkdown` from inside the model
package.

## Decision

`Render.tree`, `Render.item` and `Render.docs` are marked `@deprecated`[^1]
in place, still exported and still functioning, each doc comment pointing
at the replacement in `@tsdoctor/pages`. No consumer inside this repository
calls them; any doc-generation work should call `buildPage` plus
`renderMarkdown` / `renderMarkdownResult` instead. The lean is deletion a
minor release after the deprecation ships, once external consumers (if
any) have had a release to move off it.

## Alternatives rejected

- **Delete `Render` immediately alongside the IR switch.** Rejected: the
  deprecation gives any out-of-tree consumer of `@tsdoctor/model` a
  release cycle to notice and migrate before the export disappears,
  rather than a silent breaking change on an unrelated version bump.
- **Have `@tsdoctor/model` depend on `@tsdoctor/pages` so `Render` can
  delegate to `renderMarkdown`.** Rejected: `@tsdoctor/pages` already
  depends on `@tsdoctor/model` for `ApiItems`, `Routes`, `Tsdoc` and the
  rest of the vocabulary; the reverse edge would be a dependency cycle
  between the two packages.
- **Keep `Render` indefinitely as a dependency-light body renderer for
  consumers who want text and no page.** This is the recorded alternative
  to the deletion lean, not yet decided against — a consumer that wants
  only markdown text with none of the IR's facts, blocks or navigation
  entry has no equivalent inside `@tsdoctor/pages` today.

## Consequences

- Any code still importing `Render.tree` / `Render.item` / `Render.docs`
  compiles today but is on notice; the module is the single source of
  "go use `@tsdoctor/pages` instead" for the model package.
- The deletion timeline is external-facing, not internal: nothing in this
  repository's build breaks if `Render` is removed, since the RSPress
  adapter has already fully switched to the IR builders and the plain
  markdown emitter.
- Whether `Render` survives long-term as a dependency-light alternative to
  `@tsdoctor/pages`'s heavier IR remains open; the decision to delete
  rather than keep it is not yet made and is recorded as the fork this
  concept tracks.

[^1]: [packages/model/src/Render.ts](../../packages/model/src/Render.ts)
[^2]: [packages/pages/src/Markdown.ts](../../packages/pages/src/Markdown.ts)
