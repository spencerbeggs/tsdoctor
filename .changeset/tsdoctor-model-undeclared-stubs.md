---
"@tsdoctor/model": patch
---

## Bug Fixes

Reconstructed `.d.ts` entry points no longer fail to type-check when a member references a name nothing declares or imports. That happens with a type the package does not export (a forgotten export, when API Extractor runs without `includeForgottenExports`) and with a dotted name API Extractor could not resolve, such as `SqliteMigrator.MigrationError` arriving with no canonical reference. A name another entry point of the same package exports is now imported from that entry. Any other such name gets a non-exported `any` stub, as both a type and a value so a class can extend it, with type parameters when it is used generically. Before this, the missing name raised `TS2304` or `TS2503` and broke every Twoslash hover in the block. Closes #177, #178.
