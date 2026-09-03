---
"@tsdoctor/vfs": minor
---

## Features

`@tsdoctor/vfs` now exports the Twoslash result cache — the keying scheme,
the generation codec and the in-memory `TwoslashTypesCache` implementation
(`makeTwoslashCache`, `twoslashEnvHash`, `twoslashEntryKey`,
`twoslashBlobKey`, `encodeTwoslashCache`, `decodeTwoslashCache`) — moved out
of the RSPress adapter so any adapter can persist and share one Twoslash
result cache:

```ts
import { makeTwoslashCache, twoslashEnvHash } from "@tsdoctor/vfs";

const typesCache = makeTwoslashCache({ store, envHash: twoslashEnvHash(vfs, tsVersion) });
```

`@shikijs/twoslash` is now an optional peer dependency, alongside the
existing `typescript` and `@typescript/vfs`.
