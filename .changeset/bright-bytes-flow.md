---
"rspress-plugin-api-extractor": patch
---

## Bug Fixes

* Ports the sync `FileSystem` bridge behind `ApiExtractorPlugin.api.fromDir` / `apis.fromDir` to Effect `4.0.0-rc.115`, where `FileSystem.Size` was removed in favour of the new `ByteSize` module. Bundle discovery at config-evaluation time works again on the new Effect.
