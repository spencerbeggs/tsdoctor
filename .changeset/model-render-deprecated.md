---
"@tsdoctor/model": minor
---

## Documentation

The `Render` module (`tree`, `item`, `docs`, `isEmittable`, `RenderItemOptions`)
and the types it alone consumes (`DocMeta`, `FrontmatterRenderer`,
`RenderedDoc`, `RenderPackageOptions`) are deprecated in favor of
`@tsdoctor/pages`, the framework-neutral page IR. Every export is kept for
one more minor release before removal.

Replace `Render.tree` / `Render.item` with `buildPage` + `markdownTree` /
`renderMarkdown`, and `Render.docs` with `prepareWorkItems` + `buildPage` +
`renderMarkdown` (adapters assemble frontmatter from the `Page`'s facts and
head tags rather than an injected `FrontmatterRenderer`):

```ts
import { buildPage, renderMarkdown } from "@tsdoctor/pages";

const page = buildPage({ item, /* … */ linker });
if (page._tag === "Some") {
  const markdown = renderMarkdown(page.value);
}
```
