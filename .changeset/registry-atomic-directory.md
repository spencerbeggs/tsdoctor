---
"@tsdoctor/registry": patch
---

## Bug Fixes

- `TypeCache.writePackage` keeps the previous package tree complete until the new one is ready to take its place. A crash during the swap no longer loses the old tree: the next write restores it before staging
- `TypeCache.writePackage` no longer fails when only the removal of the retired tree fails. The new tree is already live and complete, and the next write clears the leftover

## Maintenance

- Staging now uses the sibling directories `.<version>.staging` and `.<version>.old`. A `.staging-<version>` directory left behind by a crash in an earlier version is ignored and can be deleted
