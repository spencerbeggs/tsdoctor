---
"@tsdoctor/bundle": patch
"@tsdoctor/model": patch
"@tsdoctor/registry": patch
"@tsdoctor/seo": patch
"@tsdoctor/snapshot": patch
---

## Bug Fixes

### Use catalog:effected for Peer Dependencies

Switch to strict versioning of peer dependencies via `@effected/pnpm-plugin-effect` to keep disapline of release cycle.