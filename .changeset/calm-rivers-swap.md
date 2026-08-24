---
"rspress-plugin-api-extractor": patch
---

## Dependencies

Swaps two dependencies for their `@tsdoctor` monorepo successors as part of the phase 1 `@tsdoctor` consolidation. No plugin behavior, public API, or module layout changed.

| Dependency             | Type       | Action  | From    | To          |
| :---------------------- | :--------- | :------ | :------ | :---------- |
| type-registry-effect    | dependency | removed | ^2.3.5  | —           |
| @tsdoctor/registry       | dependency | added   | —       | workspace:* |
| api-extractor-llms       | dependency | removed | ^0.2.0  | —           |
| @tsdoctor/model          | dependency | added   | —       | workspace:* |
