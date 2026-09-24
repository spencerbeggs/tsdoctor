---
type: Convention
title: SEO derivation degrades, never fails the build
description: No head-tag, Open Graph, JSON-LD, or attribution derivation may abort a docs build; each failure degrades to a warning and the page renders without that tag.
generated:
  by: okfit/claude-code
  at: 2026-09-13T14:07:05Z
  body_sha256: 7b1ce5e4bb1db596ddc7bb14538f7bc62509f9916bbd069c0b6fa98b2f264382
stale_after: 2026-12-12T00:00:00Z
tags: [architecture]
sources:
  - id: structured-data
    resource: ../../packages/seo/src/StructuredData.ts
  - id: attribution
    resource: ../../packages/seo/src/Attribution.ts
  - id: head-tag
    resource: ../../packages/seo/src/HeadTag.ts
  - id: build-stages
    resource: ../../platforms/rspress/src/build-stages.ts
  - id: vitepress-generate
    resource: ../../platforms/vitepress/src/Generate.ts
status: stable
---

# SEO derivation degrades, never fails the build

No `@tsdoctor/seo` derivation may abort a docs build. When Open Graph image
resolution, JSON-LD structured-data derivation, or a `package.json` manifest
decode fails, the page renders without that tag rather than the build
failing.

## Rules

- An `OgImageError` becomes a `ConfigValidationWarning` event; the page
  renders with no `og:image`.
- A `StructuredDataError` (a malformed, duplicated, or colliding `@id`)
  becomes a `ConfigValidationWarning` event; the page renders with no
  JSON-LD `<script>`. See the emit sites around `ConfigValidationWarning` in
  `platforms/rspress/src/build-stages.ts`.
- A `PackageManifest` decode failure degrades to `manifest` being absent —
  no page in that API carries JSON-LD, and no fatal error surfaces.
- An Open Graph asset-publish failure follows the same posture: it degrades
  to no image rather than failing config resolution.
- `attributionFacts` (`packages/seo/src/Attribution.ts`) is **total**: a
  field that cannot be derived is *absent*, never guessed. Do not fabricate
  a license URL by concatenating an SPDX id onto a well-known base — a
  `LicenseRef` has no such page, and a license outside the SPDX catalog
  drops out of the result entirely rather than appearing with an invented
  URL. Do not guess a person/organization distinction from a name's shape —
  npm carries no such distinction, so everyone credited is modelled as a
  `Person`.
- Serialize JSON-LD with `JsonLdDocument.toScriptBody()`
  (`packages/seo/src/StructuredData.ts`), never with
  `JSON.stringify(graph.toJsonLd())`. `toScriptBody` is the only serializer
  that escapes the sequences that would close the surrounding `<script>` tag
  — every string in the graph originates in author-written TSDoc, so this is
  a script-injection boundary, not a formatting preference. The adapter's
  own `escapeScriptBody` (in `HeadTag.jsonLd`) composes on top of it rather
  than replacing it.
- The VitePress adapter's silent `Effect.orElseSucceed` around Open Graph
  asset publishing (`platforms/vitepress/src/Generate.ts`) is a recorded gap
  against this convention, not the pattern to copy: it degrades with no
  warning surfaced anywhere because that adapter has no event bus yet. New
  degrade paths should emit a warning event where an event bus exists,
  matching the RSPress adapter's posture, not the VitePress adapter's
  current silence.

## Why

Every SEO tag a page carries ends up in markup a crawler treats as
authoritative. A docs build that fails outright because a CDN is unreachable
or one package's `package.json` is malformed is worse than one that ships
with a plain page and no `og:image` — the content is still correct and
navigable. Attribution specifically must never guess: a wrong license URL or
a wrongly typed contributor is a false statement published to every crawler
that reads the page, which is strictly worse than omitting the field.

## How to check

- Every catch site around an SEO derivation call in `build-stages.ts` and
  `layers/config-resolution.ts` should end in a `ConfigValidationWarning`
  emit, never an `Effect.die` or an unhandled rethrow.
- `attributionFacts` given a manifest with none of the SPDX/repository/
  person fields returns empty arrays and no optional properties — never a
  failure.
- `grep -n "JSON.stringify" packages/seo/src platforms/*/src` should not
  turn up a JSON-LD serialization call; only `toScriptBody()` (or, in the
  RSPress head-tag renderer, `escapeScriptBody` layered on top of it) is
  legitimate there.
- Trigger a deliberately malformed `package.json` or an unreachable OG image
  path in a fixture build and confirm the build completes with the affected
  tag simply missing, not a stack trace.
