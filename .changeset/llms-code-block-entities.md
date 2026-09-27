---
"rspress-plugin-api-extractor": patch
---

## Bug Fixes

* `with-api` code blocks in SSG-MD output (`llms.txt`, `llms-full.txt`) now contain the code a reader sees on the page. They previously went through an HTML round-trip that left character references (`Array&#x3C;string>`) and folded Twoslash hover-popup text into the code.
