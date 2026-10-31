---
"@tsdoctor/bundle": minor
---

## Breaking Changes

`hashText`, `hashJsonValue`, `hashLayerText` and `fingerprintResolvedBundle` now require core's `Digest` service (`effect/crypto`) instead of the removed `Crypto` service. They no longer fail with `PlatformError`. Hashes are unchanged.

Provide a `Digest` layer at the edge, such as `NodeCrypto.layerDigest` from `@effect/platform-node` or `Digest.layerWebCrypto` from `effect/crypto`:

```ts
import { NodeCrypto, NodeFileSystem } from "@effect/platform-node";
import { Effect, Layer, Path } from "effect";

program.pipe(Effect.provide(Layer.mergeAll(NodeFileSystem.layer, Path.layer, NodeCrypto.layerDigest)));
```
