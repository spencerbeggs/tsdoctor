---
"@tsdoctor/bundle": minor
---

## Features

### Image measurement via `@effected/images`

`publishBundleAssets` now measures Open Graph image width and height with `@effected/images` instead of `image-size`. The replacement is an ordinary dependency, so consumers no longer need to supply an `image-size` peer dependency.

## Breaking Changes

* Only PNG, JPEG, GIF, WebP and AVIF assets are measured. SVG (and other formats such as BMP, ICO and TIFF) now publish without `width` and `height`; `image-size` previously reported the SVG viewport size. Supply raster OG images if you rely on published dimensions.
