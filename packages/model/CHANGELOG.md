# @tsdoctor/model

## 0.1.0

### Features

#### New package, seeded from `api-extractor-llms`

- `@tsdoctor/model` is a new package that renders Microsoft API Extractor models into LLM-lean markdown, with injectable frontmatter and cross-link routes. It replaces `api-extractor-llms@0.2.0`, which is now dissolved and will not receive further releases, and carries forward the same public API:

- `loadApiModel` — load an `.api.json` file into an `ApiModel`

- `renderItem` / `renderPackage` / `isEmittable` — render API items to markdown

- `CrossLinker` — resolve type references to markdown links

- `TypeSignatureFormatter` — format TypeScript signatures for display

- TSDoc extraction helpers — `getSummary`, `getReleaseTag`, `getParams`, `getReturns`, `getExamples`, `getDeprecation`, `hasModifierTag`, `extractPlainText`

```typescript
import { loadApiModel, renderPackage } from "@tsdoctor/model";
```

- Consumers of `api-extractor-llms` migrate by depending on `@tsdoctor/model` instead; the imported names are unchanged. [#163][#163]

### Thanks

Thanks to [@spencerbeggs](https://github.com/spencerbeggs) for their contributions!

[#163]: https://github.com/spencerbeggs/tsdoctor/pull/163
