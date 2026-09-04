---
"@tsdoctor/bundle": minor
---

## Features

Adds `publishBundleAssets`, which copies a resolved bundle's bundle-relative
Open Graph images into a site's public directory and returns each one as a
`PublishedOpenGraphImage` carrying an absolute (or root-relative) URL. An
image already declared with an `url` passes through unchanged. Identical
bytes are not rewritten, so a rebuild over an unchanged image leaves the
published file's mtime untouched, and a manifest that left `width`/`height`
undeclared gets them measured from the file's own bytes.

```ts
import { publishBundleAssets } from "@tsdoctor/bundle";

const images = yield* publishBundleAssets({
	bundleDir,
	images: resolvedBundle.openGraph?.images ?? [],
	publicDir: "docs/public",
	siteUrl,
	unscopedName: "my-package",
});
```

A publish failure surfaces as the new `BundleAssetError`.

Fetching a remote bundle (`fetchNpmBundle`, `fetchGitHubReleaseBundle`) now
also persists any Open Graph image assets the manifest declares by
bundle-relative path, so a fetched bundle's `og:image` is never dangling. A
manifest declaring an asset that is missing from the fetched bundle now fails
with `BundleFetchError`'s new `"missingAsset"` reason.

## Dependencies

`image-size` is added as a peer dependency, used to measure an Open Graph
image's dimensions when the manifest does not declare them.

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| `image-size` | peerDependency | added | — | ^2.0.2 |
