---
"@tsdoctor/registry": patch
---

## Dependencies

Republishes the package so its `@effected/store` peer range matches the rest of the `@tsdoctor` set. `@tsdoctor/registry@0.2.0` was published before the catalog moved to `@effected/store@0.5.0` and shipped a `^0.4.0` peer, which is disjoint from the `^0.5.0` that `@tsdoctor/bundle`, `@tsdoctor/snapshot` and `rspress-plugin-api-extractor` declare — on a `0.x` line those two ranges share no version, so a consumer installing the plugin could not satisfy every peer with a single copy of the package.

| Dependency      | Type           | Action  | From   | To     |
| :-------------- | :------------- | :------ | :----- | :----- |
| @effected/store | peerDependency | updated | ^0.4.0 | ^0.5.0 |
