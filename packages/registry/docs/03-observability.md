# Observability

The library is silent by default. It calls `Effect.log` nowhere, so nothing reaches your logs unless you ask for it. Diagnostics come from three opt-in surfaces: a typed event channel, tracing spans, and the typed errors on every failure.

## The event channel

`RegistryEvent` is a schema-backed tagged union emitted at each lifecycle point. Emission resolves the `RegistryObserver` service through `Effect.serviceOption`, which has two consequences worth knowing: providing no observer costs nothing and no-ops, and subscribing adds no requirement to any signature you compose.

Events are schema-backed rather than plain data because they cross the library-host boundary and hosts ship them to telemetry.

### Event catalogue

| Variant | Fields | When |
| --- | --- | --- |
| `VersionResolved` | `package`, `requested`, `resolved` | A range or tag resolved to a pinned version. |
| `VersionResolveFailed` | `package`, `requested`, `kind` | Resolution failed; `kind` is `not-found`, `no-match` or `network`. |
| `CacheHit` | `package`, `version`, `age` | Both planes agreed; served from disk. |
| `CacheStale` | `package`, `version` | Files present, metadata expired or absent. |
| `CacheMiss` | `package`, `version` | Nothing cached. |
| `FetchStart` | `package`, `version` | A CDN fetch began. |
| `FetchFailed` | `url`, `status`, `bodySnippet` | One request returned a non-2xx response. |
| `PackageLoaded` | `package`, `version`, `files`, `source`, `duration` | A package loaded; `source` is `cache` or `network`. |
| `PackageLoadFailed` | `package`, `version`, `kind`, `error` | Loading failed; carries the typed error itself. |
| `BatchStart` | `total`, `packages` | A multi-package load began. |
| `BatchComplete` | `loaded`, `failed`, `total`, `totalFiles`, `duration` | A batch finished. |

`age` and `duration` are `Duration` values, not numbers of milliseconds. `PackageLoadFailed.kind` is classified from typed error tags and structured fields — never from message substrings — and is one of `not-found`, `version-range`, `schema`, `network`, `cache` or `unknown`.

### Subscribing

`layerCallback` is the lowest-friction bridge, and works from non-Effect hosts because it takes a plain function.

```ts
import { Effect, Layer } from "effect";
import { RegistryObserver } from "@tsdoctor/registry";

const ObserverLayer = RegistryObserver.layerCallback((event) => {
  switch (event._tag) {
    case "PackageLoaded":
      console.log(`loaded ${event.package} (${event.files} files, ${event.source})`);
      // one line per package, with its file count and whether it came from cache or network
      break;
    case "PackageLoadFailed":
      console.warn(`failed ${event.package}: ${event.kind}`);
      // one line per failure, with the classified kind
      break;
    default:
      break;
  }
});

await Effect.runPromise(program.pipe(Effect.provide(ObserverLayer), Effect.provide(RegistryLayer)));
```

Narrow with `switch (event._tag)` or `Match`. A throwing callback is a programmer bug and stays a defect — it is not laundered into a typed error channel.

For anything beyond a callback, implement the service directly. The shape is a single `emit` returning an `Effect`, so you can back it with a `PubSub`, a `Stream` sink, your own logger, or a metrics exporter.

```ts
import { Effect, Layer } from "effect";
import { RegistryObserver } from "@tsdoctor/registry";

const ObserverLayer = Layer.succeed(RegistryObserver, {
  emit: (event) => Effect.logDebug("registry", event),
});
```

`RegistryObserver.layerNoop` drops every event. It behaves identically to providing nothing, but makes the intent visible in a composition.

## Tracing

Every public service method is defined with `Effect.fn`, so each one opens a named span: `TypeRegistry.getVfs`, `TypeRegistry.getPackageVfs`, `TypeCache.read`, `TypeCache.prune`, `PackageFetcher.getTypeFiles` and so on. Provide any OpenTelemetry tracing layer and the spans appear with no further wiring.

Spans and events answer different questions. Spans give you timing and causality across a whole operation; events give you a discrete, typed record of what the cache and CDN did.

## Typed errors

The third surface is the error channel. Failures carry structure rather than prose, so a handler can branch on fields instead of parsing messages.

```ts
import { Effect } from "effect";

const handled = program.pipe(
  Effect.catchTag("BatchLoadError", (error) =>
    Effect.sync(() => {
      for (const failure of error.failures) {
        console.warn(`${failure.name}@${failure.version}`, failure.error);
      }
    }),
  ),
);
```

`BatchLoadError` carries one entry per failed package with its typed error preserved. It is raised only when every requested package fails; a partial failure merges the successes and reports the rest through `PackageLoadFailed` events.

See the [API reference](05-api-reference.md) for the full error catalogue.
