---
"rspress-plugin-api-extractor": minor
---

## Breaking Changes

The `siteUrl` plugin option is removed. The canonical site URL is now derived from RSPress's own config — `siteOrigin` plus `base` — rather than asked for a second time. RSPress already knows where a site is deployed, and a plugin-level answer that disagreed with it could silently emit `canonical`/`og:url` tags for a host the site isn't served from.

**Migration:** delete `siteUrl` from the plugin options and set `siteOrigin` in `rspress.config.ts` instead:

```typescript
// rspress.config.ts
export default defineConfig({
	siteOrigin: "https://example.com",
	// ...
});
```

Open Graph URLs also now fall back to **root-relative** (e.g. `/api/class/foo`) when no `siteOrigin` is configured, matching RSPress's own documented `base + routePath` fallback, instead of omitting the tags entirely. A site with no `siteOrigin` that previously emitted no `og:*` tags will now emit them with relative URLs — this keeps them inspectable under `rspress dev` on localhost.

This is a breaking change on the pre-1.0 line, released as `minor` per this repo's convention for 0.x breaking changes.

## Bug Fixes

* Three plugin configuration failures that previously escaped as unhandled errors — an unparseable `tsconfig.json`, a missing `package.json` during discovery, and a conflicting `externalPackages`/`peerDependencies` declaration — now fail as a typed `ConfigValidationError` with a `cause` carrying the original failure. A build hitting one of these now reports the problem through the normal diagnostic path (`.api-docs/build/issues.json`) instead of dying with an unhandled rejection and leaving no record of what went wrong.
* Two build metrics, `external.packages.total` and `api.versions.loaded`, were being recorded outside the current build's fiber and landing in a process-wide metric registry instead of the build's own. They now update the build's registry, so the end-of-build summary reports them correctly.
