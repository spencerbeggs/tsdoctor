---
"@tsdoctor/model": minor
"@tsdoctor/vfs": minor
"rspress-plugin-api-extractor": patch
---

## Features

`@tsdoctor/model` gains the frontmatter contract: `parseFrontmatter`, `stringifyFrontmatter`, `emitFrontmatterBlock` and `ParsedFrontmatter`, moved from the RSPress adapter. Splitting a markdown document at its fence boundaries and re-joining it is not framework-specific, and a second adapter would need it byte-identical — the frontmatter a page carries feeds the snapshot hash that decides whether the page is rewritten.

`@tsdoctor/vfs` gains the TypeScript configuration resolution that feeds its environments: `DEFAULT_COMPILER_OPTIONS`, `mergeCompilerOptions`, `resolveTypeScriptConfig` and its two single-config resolvers, plus the `TypeScriptConfig` and `CompilerOptionsInput` types. These sit beside the `TsEnvironment` and the compiler-options seam they configure.

The Tier 1 plan had deliberately left the cascade in the adapter, on the grounds that an unwired cascade should not be exported into a core package. That objection is gone: the version and package-override levels nothing read were deleted, and what remains is defaults, global, API.

## Refactoring

The adapter's `internal-types.ts` is down to 40 lines and re-exports the moved types, so its import sites are unchanged.

`category-resolver.ts` was a Tier 1 candidate and **stays in the adapter**. It merges full category configs — `displayName`, `folderName`, `collapsible` — across a plugin, package and version precedence chain, which is sidebar presentation plus multiVersion product policy rather than model vocabulary. The framework-neutral half already exists as `@tsdoctor/model`'s `CategorySpec`, which is what categorization consumes.

Verified output-neutral: a cold-cache build of the `multi` fixture site produced the same 230 Twoslash hovers across the same 129 code blocks.
