# @tsdoctor/registry documentation

External TypeScript type loading for Effect: fetch, cache and resolve type definitions from npm via the jsDelivr CDN into a `Vfs`, the virtual file system Twoslash-style documentation tooling type-checks against.

## Install

```bash
npm install @tsdoctor/registry effect @effect/platform-node @effected/store @effected/semver
```

Requires Node.js >=24.11.0. Those four peers are the required set. `@effected/xdg` is optional, needed only for `TypeCache.layerXdg`.

## Pages

- [Getting started](./01-getting-started.md) — Install the package, understand which peers you actually need, and wire the services for either a throwaway cache or a persistent XDG-rooted one.
- [Caching](./02-caching.md) — `TypeCache` keeps fetched declarations local so repeated lookups cost a disk read instead of a CDN round trip.
- [Observability](./03-observability.md) — The library is silent by default, with diagnostics available through a typed event channel, tracing spans and typed errors.
- [Architecture](./04-architecture.md) — How the services fit together, why this package builds no platform layers of its own, and what the error model guarantees.
- [API reference](./05-api-reference.md) — Everything exported from `@tsdoctor/registry`.
- [Troubleshooting](./06-troubleshooting.md) — Common failures, and what each one is actually telling you.
