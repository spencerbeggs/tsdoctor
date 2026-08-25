---
"@tsdoctor/model": minor
---

## Features

### `Routes.memberAnchors` and `ApiItems.memberAnchors`

Anchor ids for every member of a class or interface, computed in one place so a member's cross-link `#fragment` and its rendered `id=` cannot disagree.

- `Routes.memberAnchors(refs)` — pure, over `{ id, displayName, slot }` records
- `Routes.memberAnchor(displayName, prefix?)` — the single-member form
- `ApiItems.memberAnchors(item)` — derives the slots from an `ApiClass` / `ApiInterface` and delegates
- `Routes.MemberSlot` and `Routes.MemberRef` describe the input shape

When several members sanitize to the same anchor, the highest-priority slot keeps the bare anchor and the rest are prefixed. Priority runs static method, static property, instance method, getter, instance property — static leads so a member's anchor agrees with the bare cross-link key that resolves to it, and the prefix marks the non-canonical side (`instance-create`).

### `Routes.memberRouteKeys` and `ApiItems.memberRouteKeys`

Cross-link keys for a class's members. A bare `Class.member` reference resolves to the **static** member when a class has both — `Registry.create` is the static access expression in TypeScript, while the instance one is `registry.create`.

Where a static/instance collision makes that ambiguous, three further keys are emitted, using the TSDoc declaration-reference selectors API Extractor canonical references already carry:

| Key | Resolves to |
| :-- | :---------- |
| `Registry.create` | the static member |
| `Registry.(create:static)` | the static member, explicitly |
| `Registry.(create:instance)` | the instance member |
| `Registry.prototype.create` | the instance member |

`Class#member` is deliberately not emitted: `#` is the URL fragment delimiter, so such a key reads ambiguously beside a route, and in modern TypeScript it denotes a private field. Selector keys appear only where a collision exists, so a class with no colliding names keeps a single key per member.

## Bug Fixes

### Colliding members no longer share an anchor

A class with both a `static create()` and an instance `create()` previously produced the *same* anchor for both members, because the prefix was keyed by sanitized name rather than by member. Anchors are now keyed per member: the static member takes `#create` and the instance member `#instance-create`.

### Cross-links to keys ending in a non-word character now match

`CrossLinker` anchored every pattern with a trailing `\b`. That is an assertion about the adjacent character, not a delimiter: after a `)` it matches only when a word character follows, so a key in selector form was unmatchable in every realistic sentence position. Names ending in a word character — every plain identifier and every `Class.member` key — are unaffected.

### `Routes.sanitizeId` is now genuinely the only implementation

Its documentation already claimed to be canonical. It was not: the RSPress adapter carried a second sanitizer for page-side `id=` attributes that kept `_` and mapped `$` to `-`, while this one maps `_` to `-` and strips `$`. A member named `get_value` was linked as `#get-value` and rendered as `id="get_value"`, so the cross-link landed nowhere. Both sides call this function now.

**Anchor URLs change for affected members.** Any member whose name contains `_` or `$`, and the lower-priority half of any static/instance name collision, gets a new fragment. Nothing that previously worked breaks — the id and the link already disagreed, so no functioning deep link used the pair — but external links written against the old fragments need updating.

Regenerated pages differ in those `id=` attributes, so consuming sites will see the affected pages marked modified on their next build and their `article:modified_time` bump.
