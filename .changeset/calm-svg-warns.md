---
"rspress-plugin-api-extractor": minor
---

## Features

### Image measurement via `@effected/images`

Configured local Open Graph images are now measured, and their MIME type detected, with `@effected/images` instead of `image-size`. The `unreadable-image` warning now names the precise parse failure, such as a truncated header.

## Breaking Changes

* SVG and other unsupported image formats now emit the existing `unreadable-image` config warning and omit `width`, `height` and `type` from the generated metadata. `image-size` previously measured SVG files. Use a PNG, JPEG, GIF, WebP or AVIF image for Open Graph metadata.
