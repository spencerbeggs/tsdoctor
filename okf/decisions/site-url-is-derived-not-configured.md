---
type: Decision
status: stable
title: The canonical site URL is derived, never configured
description: There is no siteUrl plugin option; deriveSiteUrl joins RSPress's own siteOrigin and base.
tags: [architecture]
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: f1defaa3a669e984c678c39fa748d505019193fcfe6d53999645488ee7a0c1c8
verified:
  - by: human:spencer
    at: 2026-09-24T20:24:18Z
---

# The canonical site URL is derived, never a plugin option

## Context

Every generated page needs a canonical URL, an `og:url`, and JSON-LD
identifiers built from one absolute base. RSPress already knows its own
deployment origin and base path (`siteOrigin`, `base` on the config RSPress
hands the plugin); the adapter also has enough information to expose a
`siteUrl` plugin option if it wanted to.

## Decision

There is no `siteUrl` option. `RspressConfigSubset`[^1] carries RSPress's own
`siteOrigin` and `base`, and `deriveSiteUrl(siteOrigin, base)`[^2] joins them
in RSPress's documented `siteOrigin + base + routePath` order to produce the
prefix every head tag is built against. `config-resolution.ts` calls it
directly off the subset it is handed[^3]. With no `siteOrigin` configured,
`deriveSiteUrl` returns `""`, so URLs come out root-relative rather than
absolute — head tags still emit and are inspectable under `rspress dev`,
they just are not absolute. Because of that, head-tag emission is gated on
`packageName` being present, never on the derived URL being non-empty[^4]:
gating on non-emptiness would silently drop every tag on a dev build with no
configured `siteOrigin`.

## Alternatives rejected

- **A `siteUrl` plugin option.** Asking the operator to state the deployment
  URL a second time invites the plugin's answer to disagree with RSPress's
  own `siteOrigin`/`base`, producing a `canonical` and `og:url` for a host
  the site is not actually served from.
- **Gating head-tag emission on a non-empty derived URL.** Rejected because a
  dev build with no `siteOrigin` set would then emit zero head tags, making
  it impossible to inspect OG/canonical/JSON-LD output locally before a
  production `siteOrigin` is configured.

## Consequences

- A site's canonical URL is a single source of truth: RSPress's own
  `siteOrigin` + `base` configuration, never a second plugin-level knob that
  can drift from it.
- A `rspress dev` session with no `siteOrigin` produces root-relative head
  tags rather than no head tags, which is what makes local inspection of
  OG/canonical/JSON-LD possible before deployment configuration exists.
- Anything that wants an absolute site URL (JSON-LD `@id`s, `og:url`) must go
  through `deriveSiteUrl` fed from `RspressConfigSubset`; there is no other
  legitimate source for it in the adapter.

[^1]: [platforms/rspress/src/services/ConfigService.ts](../../platforms/rspress/src/services/ConfigService.ts) — `RspressConfigSubset`
[^2]: [packages/seo/src/Canonical.ts](../../packages/seo/src/Canonical.ts) — `deriveSiteUrl`
[^3]: [platforms/rspress/src/layers/config-resolution.ts](../../platforms/rspress/src/layers/config-resolution.ts)
[^4]: [platforms/rspress/src/build-stages.ts](../../platforms/rspress/src/build-stages.ts)
