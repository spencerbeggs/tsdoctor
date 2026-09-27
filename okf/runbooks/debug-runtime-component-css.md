---
type: Runbook
title: Debug runtime component CSS in a live fixture site
description: Iterate on an RSPress runtime component's styling or Twoslash popup behaviour against a running fixture site, inspecting it in a browser, without being fooled by a dev server that never reloads the plugin's built output.
resource: ../../platforms/rspress/src/runtime/components
tags: [dx, testing]
generated:
  by: okfit/claude-code
  at: 2026-09-27T18:03:13Z
  body_sha256: aa9d383a746efc0852b408dbf0a35cb6038171c68911cf533b2fa3a66e6b5391
status: stable
---

# Debug runtime component CSS in a live fixture site

## Trigger

A change to a component under `platforms/rspress/src/runtime/components/`
whose effect only shows in a browser: layout, CSS-module specificity, or
Twoslash popup positioning. Unit tests cannot see any of these.

## Steps

1. Build the plugin and the fixture modules once: `pnpm run build`.
2. Start the basic fixture without opening a browser:
   `NO_OPEN=1 pnpm dev:basic`, then browse
   `http://localhost:4173/api/...` (4173 is `serve()`'s default port), for
   example through Playwright MCP.
3. Edit the component's CSS or `index.tsx`.
4. Rebuild the plugin alone:
   `pnpm --filter rspress-plugin-api-extractor run build:dev`.
5. Kill and restart the dev server. It does not hot-reload the plugin's
   built `dist/dev/pkg` output, so without a restart the browser keeps
   showing the previous build and an edit looks like it did nothing.
6. Re-inspect the page, and repeat from step 3.

## What to know while inspecting

- Twoslash popup CSS is global, not a CSS module:
  `src/runtime/components/shared/_twoslash.css`, targeting Shiki-generated
  class names.
- `SignatureCode` styling is a CSS module
  (`SignatureCode/index.module.css`). Module selectors outrank global ones,
  so a global rule needs three classes
  (`.twoslash .twoslash-popup-container .twoslash-popup-docs`) to beat a
  module's one-class-plus-element selector (`.code-xxx code`).
- A visible Twoslash popup is `position: fixed` so it escapes scroll
  containers; `SignatureCode/index.tsx` sets `--popup-top`, `--popup-left`
  and `--popup-max-width` on hover.
- A hidden popup collapses to `width: 0; height: 0; overflow: hidden` so it
  does not enlarge the `<pre>` scroll area.
- The `<pre>` uses `overflow-x: auto` for horizontal scrolling, which by
  the CSS spec forces `overflow-y: auto` as well.

Authoring rules for the components themselves are in
[runtime-component-authoring](../conventions/runtime-component-authoring.md).

## Done when

The restarted dev server renders the edited component as intended in the
browser, in both light and dark (`html.rp-dark`) themes, and a hovered
Twoslash popup neither clips nor enlarges its code block's scroll area.
