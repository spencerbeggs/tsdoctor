---
status: current
module: rspress-plugin-api-extractor
category: architecture
created: 2026-01-17
updated: 2026-09-03
last-synced: 2026-09-03
completeness: 90
related:
  - rspress-plugin-api-extractor/multi-entry-resolution.md
  - rspress-plugin-api-extractor/multi-entry-vfs.md
  - rspress-plugin-api-extractor/page-generation-system.md
  - rspress-plugin-api-extractor/type-loading-vfs.md
---

# Multi-entry point support

## Table of contents

- [Overview](#overview)
- [Current state](#current-state)
- [How the subsystems relate](#how-the-subsystems-relate)
- [Rationale](#rationale)
- [Related documentation](#related-documentation)

## Overview

Modern npm packages expose multiple entry points — `.` plus `./testing`, platform-specific subpaths, plugin subpaths — through the `exports` map. The plugin supports these end to end, detecting the entry point count and adjusting generation while staying fully backward compatible with single-entry packages. Two independent subsystems carry the support, each with its own doc.

## Current state

- **Doc generation** — `multi-entry-resolution.md`: `@tsdoctor/model`'s `EntryPoints.resolve` deduplication, the `Routes` collision detector and how `prepareWorkItems` attaches `availableFrom` to work items so the page can carry an "Available from" block.
- **Virtual TypeScript environment** — `multi-entry-vfs.md`: `ApiExtractedPackage`, per-entry `.d.ts` generation and the synthetic `package.json` (`types` for one entry, `exports` for several) produced via `VirtualPackage`.

## How the subsystems relate

Both read the same `ApiPackage` but produce different artifacts and share no state. The resolution pipeline produces pages and cross-link routes; the VFS subsystem produces declarations for Twoslash. `modules/kitchensink/`, which declares a `./testing` entry, exercises both at once: deduplicated pages with "Available from" metadata on the doc side, separate `index.d.ts` and `testing.d.ts` files on the VFS side.

## Rationale

- **Why two subsystems rather than one:** pages and type environments answer different questions about the same model and are consumed at different build phases; coupling them would make the VFS depend on categorization or the pages depend on TypeScript.

## Related documentation

- **Multi-entry resolution:** `multi-entry-resolution.md`
- **Multi-entry VFS:** `multi-entry-vfs.md`
- **The pipeline that consumes resolved items:** `page-generation-system.md`
- **The VFS's consumer:** `type-loading-vfs.md`
