---
"@tsdoctor/bundle": patch
---

## Dependencies

The `tsdoctor.json` bundle manifest schema now lives in `@tsdoctor/manifest`;
`@tsdoctor/bundle` depends on it and re-exports its full surface
(`BundleManifest`, `BundleManifestError`, `KNOWN_REGISTRY_TYPES`,
`OpenGraphConfig`, `OpenGraphImage`, `ProjectIdentity`, `RegistryRef`,
`SbomRef`, `decodeBundleManifest`, `isKnownRegistryType`, plus the new
`MANIFEST_SPEC`, `ManifestSource`, `decodeManifestSource` and
`encodeBundleManifest`), so no consumer import changes.

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| `@tsdoctor/manifest` | peerDependency | added | — | 0.1.0 |
