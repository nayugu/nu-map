# Cloudflare Workers

## translate-proxy

Proxies requests to the MyMemory translation API so course translation works in regions where `mymemory.translated.net` is blocked.

> **Note:** Most users don't need this proxy — MyMemory's API is CORS-enabled and accessible directly from browsers in most regions including mainland China. The proxy is a fallback for any region where MyMemory itself is blocked.

**Custom domain:** `https://translate.numap.app`

**Configured via:** `VITE_TRANSLATE_PROXY` environment variable in Cloudflare Pages → nu-map → Settings → Variables and secrets.

Set `VITE_TRANSLATE_PROXY=https://translate.numap.app` (or your worker's `.workers.dev` URL) and redeploy the app to activate proxying.

To update the worker, edit `translate-proxy.js` and redeploy it from the Cloudflare Workers dashboard.
