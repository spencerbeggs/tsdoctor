# @tsdoctor/manifest

**Deprecated.** The spec-1 bundle manifest (bundle layer 3) now ships from
the kit as `@effected/manifest`, and the sidecar is named `bundle.json`
(`BUNDLE_MANIFEST_FILENAME`), not `tsdoctor.json`.

## Invariants

- `src/index.ts` is a thin re-export of `@effected/manifest`, name for name,
  so existing imports keep working for one more release. Add nothing here.
- Consumers in this repo import from `@tsdoctor/bundle` (which re-exports the
  same names) or from `@effected/manifest` directly; the platforms depend on
  `@effected/manifest`, never on this package.
- Builds via `effected package build` (no `effected.toml`).

See `../../okf/decisions/manifest-schema-home.md` for why the schema moved.
