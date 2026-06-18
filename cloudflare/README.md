# Cloudflare Workers

## translate-proxy

Proxies requests to Google Translate so course translation works in regions where Google is blocked (e.g. mainland China).

**Deployed at:** `https://translate-proxy.snowflakewithblueeyes.workers.dev`

**Configured via:** `VITE_TRANSLATE_PROXY` environment variable in Cloudflare Pages → nu-map → Settings → Variables and secrets.

To update the worker, edit `translate-proxy.js` and redeploy it from the Cloudflare Workers dashboard.
