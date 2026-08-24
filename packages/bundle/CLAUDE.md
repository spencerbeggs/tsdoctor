# packages/bundle/CLAUDE.md

`@tsdoctor/bundle` (publishable, versioned via changesets) — the versioned
bundle spec: layered bundle discovery, the `tsdoctor.json` sidecar manifest
(spec 1), the six-tier provenance-carrying resolver and canonical input
hashing. Phase-2 package; the settled spec lives in
`.claude/design/rspress-plugin-api-extractor/bundle-spec.md` and is the
authority for the ladder, tier ranking, manifest shape and change-detection
model.

## Key Facts

- Modules (flat, module-per-concept): `BundleManifest.ts` (schema + typed
  decode, graceful degradation for unknown registry types / top-level
  fields), `PlatformOverrides.ts` (the top-ranked override tier),
  `Bundle.ts` (descriptor + four layer readers + `readBundle`),
  `BundleDiscovery.ts` (`discoverBundle`/`discoverBundles`, generalizing the
  plugin's `fromDir`/`fromParentDir` without the RSPress baseRoute logic),
  `BundleResolver.ts` (pure `resolveBundle`, `Provenanced<A>` fields),
  `BundleHash.ts` (pure canonical hashing + per-field fingerprints),
  `BundleFetch.ts` (`fetchNpmBundle` / `fetchGitHubReleaseBundle` over
  `@effected/npm`'s `NpmRegistry`+`PackageTarball` and `@effected/github`'s
  `GitHubRelease`, cached under the XDG cache via `@effected/store` `Cache` +
  `@effected/xdg` `AppDirs` namespace `"tsdoctor"` — consumers provide those
  services; cache layout `bundles/npm/<name>/<version>` and
  `bundles/github/<owner>/<repo>/<tag>/<asset>`; the real `*.npm.meta.tgz`
  release asset unpacks to a `meta/` root, which `locateBundleRoot` handles
  alongside npm's `package/`).
- Layers enrich, never gate: absence of layers 1–3 is `Option.none()`, a
  PRESENT-but-malformed file fails typed (`BundleLayerError` /
  `BundleManifestError` / `BundleDiscoveryError`, all `Schema.TaggedError`).
- No services of its own: filesystem functions keep
  `FileSystem | Path` in `R`; consumers compose the platform at the edge
  (same posture as `@effected/walker`).
- Deliberately free of `@microsoft/api-extractor-model` — layer 0 reads only
  the model's `name`. Full model loading is `@tsdoctor/model`'s job.
- `ProvenanceSource` extends the spec's six tiers with `"tsconfig"` for the
  compiler-options pass-through; the display-name chain deliberately skips
  the `manifest.project` tier (project identity is exposed separately).
- Fingerprints hash `{ value, source }` pairs — an override flip with an
  unchanged value is a visible diff by design.
- Builds via `@savvy-web/bundler` (`savvy.build.ts`); tsconfig extends
  `@savvy-web/bundler/tsconfig/ecma.json`; source `package.json` stays
  `"private": true` (`publishConfig` drives publishing). `@effected/*` deps
  only via `catalog:effected` / `catalog:effected:peers`.
- Tests: `@effect/vitest`, `@effected/memfs` for filesystem cases, plus a
  real fixture bundle at `__test__/fixtures/kitchensink/`.

## Commands

```bash
pnpm --filter @tsdoctor/bundle run build:dev
pnpm vitest run packages/bundle/
```

## Design Docs

- @../../.claude/design/rspress-plugin-api-extractor/bundle-spec.md
- @../../.claude/design/rspress-plugin-api-extractor/tsdoctor-package-architecture.md
- @../../.claude/design/rspress-plugin-api-extractor/roadmap-1.0.md
