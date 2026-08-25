---
"@tsdoctor/bundle": minor
---

## Breaking Changes

The `BundleHash` surface is rebuilt on `@effected/jsonc`'s `JsoncFingerprint` — RFC 8785 (JCS) canonicalization plus SHA-256 through core's `Crypto` service:

* `hashText`, `hashJsonValue`, `hashLayerText` and `fingerprintResolvedBundle` are now Effects requiring the `Crypto.Crypto` service — provide `@effect/platform-node`'s `NodeCrypto.layer` (or any `Crypto` layer) at the application edge, the same posture as the package's `FileSystem | Path` requirements
* `canonicalJson` and `sha256Hex` are removed from the public surface; canonicalization is strict by design — an `undefined`-valued member or a non-plain object (a class instance, a `Date`) fails typed instead of being silently dropped, so Schema-encode values to plain JSON before hashing

## Features

* Bundle discovery reads `package.json` through `@effected/package-json`'s `LenientManifest`: a malformed individual field now degrades to absence instead of failing discovery, per the ladder's enrich-never-gate rule. Malformed JSON text (or a non-object document) still fails typed as `invalidPackageJson`.
