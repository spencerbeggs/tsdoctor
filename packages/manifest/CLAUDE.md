# @tsdoctor/manifest

The `tsdoctor.json` sidecar manifest: bundle layer 3. Schema only — this
package depends on `effect` alone so a bundler can write the file through
`encodeBundleManifest` and a reader can decode it through
`decodeBundleManifest` without either dragging in the other's stack.

## Invariants

- `spec` is `1` and the only required field. Additive fields are minor
  revisions; unknown enum-ish values (`registries[].type`, `sbom.format`)
  degrade, never reject.
- `ManifestSource` is what an author checks in: `BundleManifest` minus
  `spec` and `project`. A source file never declares its own spec version
  or its inherited tier; the bundler supplies both at emit time.
- `@tsdoctor/bundle` re-exports every name here. Consumers in this repo
  import from the bundle package; only writers import this one directly.
