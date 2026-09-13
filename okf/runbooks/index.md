# Runbook

* [Dogfood an unreleased @effected/* capability](dogfood-effected-overrides.md) - Link the sibling effected checkout's local build artifacts into this monorepo via pnpm overrides so an unreleased @effected/* capability can be exercised here before it ships, then unlink cleanly once it does.
* [Measure hover parity before and after a Twoslash-path change](measure-hover-parity.md) - Verify that a change to the compiler-option seam, the VFS, the Twoslash transformer or the Twoslash result cache does not silently change rendered hovers, which no MDX diff can see because they render after config() returns.
* [Re-pin a vendored reference repo after a dependency bump](repin-vendored-repo.md) - When a pinned dependency (effect, @rspress/core, vitepress, shiki, twoslash, @rsbuild/core) is bumped in this monorepo, re-pin its matching .repos/ submodule to the new tag so the vendored source stays the authority for the version actually installed.
