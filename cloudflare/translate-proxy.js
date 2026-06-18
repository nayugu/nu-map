// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Worker: translate-proxy
//
// Proxies requests to the MyMemory translation API so that users in regions
// where mymemory.translated.net is blocked can still use course translation.
//
// Deploy:
//   1. Go to workers.cloudflare.com → Create Worker
//   2. Paste this file, save and deploy
//   3. Optionally add a custom domain (e.g. translate.numap.app) under the
//      worker's Settings → Triggers → Custom Domains tab.
//   4. Set VITE_TRANSLATE_PROXY=<worker URL> in:
//        • Cloudflare Pages → nu-map → Settings → Environment Variables
//        • GitHub repo → Settings → Secrets → Actions (as VITE_TRANSLATE_PROXY)
//      Then redeploy the app.
//
// The worker only forwards requests to /get — all other paths return 404.
// ─────────────────────────────────────────────────────────────────────────────

const UPSTREAM     = "https://api.mymemory.translated.net";
const ALLOWED_PATH = "/get";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age":       "86400",
};

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname !== ALLOWED_PATH) {
      return new Response("Not found", { status: 404 });
    }

    const target = `${UPSTREAM}${url.pathname}${url.search}`;

    try {
      const upstream = await fetch(target);
      const body = await upstream.arrayBuffer();

      return new Response(body, {
        status: upstream.status,
        headers: {
          ...CORS,
          "Content-Type":  upstream.headers.get("Content-Type") ?? "application/json",
          "Cache-Control": "public, max-age=86400",
        },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 502,
        headers: { ...CORS, "Content-Type": "application/json" },
      });
    }
  },
};
