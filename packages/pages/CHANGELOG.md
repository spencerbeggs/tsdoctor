# @tsdoctor/pages

## 0.1.7

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/model | dependency | updated | 0.6.5 | 0.6.6 |
| @tsdoctor/seo | dependency | updated | 0.2.1 | 0.2.2 |
| @effected/markdown | peerDependency | updated | ^0.9.1 | ^0.10.0 |
| effect | peerDependency | updated | 4.0.0-rc.112 | 4.0.0-rc.115 |

[#237][#237]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#237]: https://github.com/spencerbeggs/tsdoctor/pull/237

## 0.1.6

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @microsoft/api-extractor-model | dependency | updated | ^7.33.11 | ^7.33.12 |
| @tsdoctor/model | dependency | updated | 0.6.4 | 0.6.5 |

[#233][#233]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#233]: https://github.com/spencerbeggs/tsdoctor/pull/233

## 0.1.5

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/model | dependency | updated | 0.6.3 | 0.6.4 |
| @effected/markdown | peerDependency | updated | ^0.9.0 | ^0.9.1 |

[#225][#225]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#225]: https://github.com/spencerbeggs/tsdoctor/pull/225

## 0.1.4

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/model | dependency | updated | 0.6.2 | 0.6.3 |
| @tsdoctor/seo | dependency | updated | 0.2.0 | 0.2.1 |
| @effected/markdown | peerDependency | updated | ^0.8.1 | ^0.9.0 |
| effect | peerDependency | updated | 4.0.0-rc.109 | 4.0.0-rc.112 |

[#221][#221]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#221]: https://github.com/spencerbeggs/tsdoctor/pull/221

## 0.1.3

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/model | dependency | updated | 0.6.1 | 0.6.2 |
| @effected/markdown | peerDependency | updated | ^0.8.0 | ^0.8.1 |

[#218][#218]

### Thanks

Thanks to [@spencerbeggs](https://github.com/apps/spencerbeggs) for their contributions!

[#218]: https://github.com/spencerbeggs/tsdoctor/pull/218

## 0.1.2

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/seo | dependency | updated | 0.1.2 | 0.2.0 |

## 0.1.1

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @tsdoctor/model | dependency | updated | 0.6.0 | 0.6.1 |
| @tsdoctor/seo | dependency | updated | 0.1.1 | 0.1.2 |

### Maintenance

- Force package bumps

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

## 0.1.0

### Features

- First release. `@tsdoctor/pages` is the framework-neutral page IR for
  generating API documentation: a typed block vocabulary, `ApiItem` → `Page`
  builders, a per-API navigation tree, display/source code preparation, a
  plain-markdown emitter, and the llms.txt text transforms — everything a
  static-site adapter needs to decide WHAT a generated page contains, leaving
  the adapter to decide only how to render it.

- Two entry points cover the whole pipeline:

```ts
import { prepareWorkItems, buildPage, buildNav, renderMarkdown } from "@tsdoctor/pages";

const { workItems, crossLinkData } = prepareWorkItems({ apiPackage, categories, linker });

for (const workItem of workItems) {
  const page = buildPage({ item: workItem.item, /* … */ linker });
  if (page._tag === "Some") {
    const markdown = renderMarkdown(page.value);
  }
}
```

- `prepareWorkItems` resolves multi-entry re-exports, detects synthetic base
  declarations, categorizes items, and builds the cross-link route map,
  returning uncategorized items and route collisions as data rather than
  throwing. `buildPage` lifts one `ApiItem` into a `Page` — title, description,
  route, head tags, and an ordered list of typed blocks (signature, members,
  parameter and enum tables, examples, the synthetic base-class section) — with
  prose already cross-linked and parsed to mdast. `buildNav` assembles the
  per-API sidebar tree from the resolved categories.

- This package is the extraction behind the `rspress-plugin-api-extractor`
  adapter's switch to a shared IR and the new `vitepress-plugin-api-extractor`
  adapter; see their own release notes for what changed in each. [#208][#208]

### Dependencies

| Dependency | Type | Action | From | To |
| --- | --- | --- | --- | --- |
| @microsoft/api-extractor-model | dependency | added | — | ^7.33.11 |
| @tsdoctor/model | dependency | added | — | 0.6.0 |
| @tsdoctor/seo | dependency | added | — | 0.1.1 |
| prettier | dependency | added | — | ^3.9.6 |
| @effected/markdown | peerDependency | added | — | ^0.8.0 |
| effect | peerDependency | added | — | 4.0.0-rc.109 |

[#208][#208]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#208]: https://github.com/spencerbeggs/tsdoctor/pull/208
