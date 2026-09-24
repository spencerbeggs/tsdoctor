---
type: Convention
status: stable
title: Do not hand-format, hand-sort, or hand-chmod what the pre-commit hook already normalizes
description: lint-staged (Biome, sort-package-json, markdownlint-cli2, yaml fmt) formats staged files at commit and strips the exec bit off *.sh; tsgo --noEmit is the only blocking step.
tags: [dx]
stale_after: 2026-12-12T00:00:00Z
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: f8f3582bd8d1e883bc9e99e67ae691d88abde4c95edc6548fb6761a4afdc9492
---

# Do not hand-format what the pre-commit hook already normalizes

`lib/configs/lint-staged.config.ts` exports `Preset.silk()`[^1] from
`@savvy-web/silk/lint`, and Husky's `pre-commit` hook runs it over staged
files on every commit. Do not perform any of the following by hand — the
hook applies it and re-stages the result:

- Sort or reorder imports.
- Hand-wrap long lines or otherwise reformat code.
- Reorder `package.json` keys.
- Reformat YAML or `pnpm-workspace.yaml`.
- Run a standalone formatting pass "to be safe" before committing.

The one blocking, non-autofixing step in the pipeline is `tsgo --noEmit` (or
`tsc --noEmit`) over `*.{ts,cts,mts,tsx}` — a real type error fails the
commit; nothing else in the pipeline can.

**`*.sh` files land as `100644`, never `100755`, and that is intentional.**
The hook runs `chmod -x` on every staged shell script — every shell script in
this repo (plugin hooks, the bats test runner) is invoked as `bash <script>`,
so nothing needs the executable bit at runtime, and the sole excluded path is
`.claude/scripts/`. Writing an executable script during development, running
`chmod +x` to test it, and seeing the commit flip it back to `644` is
standard behavior — this is documented in `savvy-web/systems#289`[^2] and in
the config file's own header comment[^1]. Do not "fix" a `755`→`644` mode
change in a diff, do not flag it in code review, and do not open an issue
about it.

Direct Biome invocation via `bunx biome` / `npx biome` / a bare `biome`
binary is denied in this repo: it does not resolve this repo's Biome config
and can corrupt vendored `.repos/**` submodules if pointed at them by
mistake. Use `pnpm run lint`, `pnpm run lint:fix`, `pnpm run lint:fix:unsafe`
or `pnpm run lint:md` / `lint:md:fix` instead.

## Why

The pipeline exists precisely so contributors and agents do not need to
carry formatting rules in their heads — Biome's `check --write`,
`sort-package-json`, `markdownlint-cli2 --fix` and the yaml formatter all run
automatically and re-stage their output, so a hand-formatting pass either
duplicates work the hook will redo anyway or produces a diff that disagrees
with what the hook would have written, forcing a second commit. The exec-bit
strip specifically exists because every script in the repo runs through
`bash <script>`, making the executable bit meaningless at runtime but a
recurring false positive in code review if treated as drift.

## How to check

```bash
pnpm run lint            # Biome check
pnpm run lint:fix        # Biome safe fixes
pnpm run lint:md         # markdownlint-cli2
pnpm exec lint-staged --config "$(pwd)/lib/configs/lint-staged.config.ts"
```

Read `lib/configs/lint-staged.config.ts`'s header comment for the current
tool list; treat any `*.sh` `755`→`644` diff as expected, not a regression.

[^1]: [lib/configs/lint-staged.config.ts](../../lib/configs/lint-staged.config.ts)
[^2]: savvy-web/systems#289
