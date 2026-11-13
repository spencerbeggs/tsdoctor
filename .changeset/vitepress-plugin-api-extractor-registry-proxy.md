---
"vitepress-plugin-api-extractor": minor
---

## Features

External package types are now fetched with your package manager's proxy and TLS settings. The plugin reads the configuration pnpm would use from the site's directory, including `HTTPS_PROXY`, `HTTP_PROXY` and `NO_PROXY`, the npmrc `proxy`, `https-proxy` and `noproxy` settings, `cafile`, `ca` and `strict-ssl`, and `pnpm-workspace.yaml`. Builds behind a corporate proxy or a TLS-intercepting CA now load external types instead of quietly rendering code blocks without them.

If that configuration can't be applied (for example, an npmrc names a `cafile` that doesn't exist), the plugin fetches directly as before and prints a warning with the reason on its first fetch.
