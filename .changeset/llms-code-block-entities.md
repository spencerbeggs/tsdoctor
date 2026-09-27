---
"rspress-plugin-api-extractor": patch
---

## Bug Fixes

* Code blocks in SSG-MD output (`llms.txt`, `llms-full.txt`) no longer contain HTML character references: `Array<string>` and `a && b` were emitted as `Array&#x3C;string>` and `a &#x26;&#x26; b`. The code is now read from the highlighted tree's text nodes instead of round-tripping through HTML.
