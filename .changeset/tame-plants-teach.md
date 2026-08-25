---
"@tsdoctor/snapshot": minor
---

## Breaking Changes

`SnapshotServiceLive(dbPath)` is removed. Build the layer from the service itself instead:

```typescript
import { SnapshotService } from "@tsdoctor/snapshot";

const layer = SnapshotService.layer(dbPath);
```

`SnapshotServiceShape.hashContent` is removed from the service interface — it had no consumers of the method form. The standalone `hashContent` export from the package root (`import { hashContent } from "@tsdoctor/snapshot"`) is unchanged and remains the supported way to hash content.

This is a breaking API change on the pre-1.0 line, released as `minor` per this repo's convention for 0.x breaking changes.

## Features

Adds in-memory test doubles for consumers that need to provide `SnapshotService` without a real SQLite database:

```typescript
import { SnapshotService } from "@tsdoctor/snapshot";

const layer = SnapshotService.layerTest({
	getSnapshot: () => Effect.succeed(Option.none()),
});
```

`SnapshotService.makeTest(overrides)` returns the shape directly; `SnapshotService.layerTest(overrides)` wraps it in a `Layer`. Defaults describe a build with no prior snapshot: every lookup misses, every write is accepted and discarded, and `cleanupStale` reports nothing stale.
