// ─────────────────────────────────────────────────────────────────────────────
// Cloudflare Worker: translate-proxy
//
// Proxies requests to Google Translate's unofficial endpoint so that users
// in regions where Google is blocked (e.g. mainland China) can still use
// course translation.  Cloudflare's network reaches Google even where the
// public internet cannot.
//
// Deploy:
//   1. Go to workers.cloudflare.com → Create Worker
//   2. Paste this file, save and deploy
//   3. Copy the worker URL (e.g. https://translate-proxy.yourname.workers.dev)
//   4. Set VITE_TRANSLATE_PROXY=<that URL> in:
//        • Cloudflare Pages → nu-map → Settings → Environment Variables
//        • GitHub repo → Settings → Secrets → Actions (as VITE_TRANSLATE_PROXY)
//      Then redeploy the app.
//
// The worker only forwards requests to /translate_a/single — all other
// paths return 404.
// ─────────────────────────────────────────────────────────────────────────────

const GOOGLE_BASE = "https://translate.googleapis.com";
const ALLOWED_PATH = "/translate_a/single";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Max-Age":       "86400",
};

export default {
  async fetch(request) {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if (url.pathname !== ALLOWED_PATH) {
      return new Response("Not found", { status: 404 });
    }

    const target = `${GOOGLE_BASE}${url.pathname}${url.search}`;

    try {
      const upstream = await fetch(target, {
        headers: { "User-Agent": "Mozilla/5.0" },
      });

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
