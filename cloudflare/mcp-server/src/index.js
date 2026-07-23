// NU Map MCP Worker — entry point.
//
// Two ways in:
//
//   OAuth (the canonical path for claude.ai / the Directory):
//     ALL  /mcp                            one URL for every user; the access
//                                          token carries the nu-map session id
//     GET  /authorize                      OAuth consent — redirects into
//                                          numap.app, where the user approves
//                                          IN THE APP (no codes, no forms here)
//     POST /authorize/complete             numap.app finishes the grant
//     POST /token, /register               implemented by the provider
//     /.well-known/*                       metadata, implemented by the provider
//
//   Legacy session URL (Claude Code / dev, pairing-code gated):
//     ALL  /session/:sid/mcp
//
// Browser channel (both paths):
//   GET  /events/:sid · POST /sync-plan/:sid · /pair/:sid · /consent/:sid
//   POST /confirm-proposal/:sid/:id · /plan-contents/:sid/:reqId · GET /health

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { getQuery } from "./loadData.js";
export { SessionDO } from "./sessionDO.js";

const APP_ORIGIN = "https://numap.app";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", ...CORS } });

/** Session id from any of the supported route shapes, or null. */
function sessionIdOf(pathname) {
  const seg = pathname.split("/").filter(Boolean);
  if (["events", "sync-plan", "pair", "consent"].includes(seg[0]) && seg[1]) return seg[1];
  if (["confirm-proposal", "plan-contents"].includes(seg[0]) && seg[1] && seg[2]) return seg[1];
  if (seg[0] === "session" && seg[1] && seg[2] === "mcp") return seg[1];
  return null;
}

const sessionStub = (env, sid) => env.SESSION.get(env.SESSION.idFromName(sid));

// ── API handler: authorized /mcp requests ───────────────────────────
// The provider has already validated the Bearer token; ctx.props is what
// the grant stored — the nu-map session this Claude user approved.

const apiHandler = {
  async fetch(request, env, ctx) {
    const sid = ctx.props?.sessionId;
    if (!sid) return json({ error: "Grant is missing a session binding" }, 403);
    // Forward into that session's Durable Object as an MCP request.
    const inner = new Request(
      new URL(`/session/${sid}/mcp`, request.url),
      request
    );
    return sessionStub(env, sid).fetch(inner);
  },
};

// ── Default handler: consent flow + browser channel + legacy MCP ────

const defaultHandler = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const url = new URL(request.url);
    const { pathname } = url;

    // OAuth consent, step 1: claude.ai sends the user here. We stash the
    // parsed request server-side and bounce the user into numap.app, where
    // the real consent UI lives (approval happens IN the app, consistent
    // with the pairing philosophy — and the app knows its own session id).
    if (pathname === "/authorize") {
      const oauthReqInfo = await env.OAUTH_PROVIDER.parseAuthRequest(request);
      const client = await env.OAUTH_PROVIDER.lookupClient(oauthReqInfo.clientId).catch(() => null);
      const pendingId = crypto.randomUUID();
      await env.OAUTH_KV.put(
        `pending_auth:${pendingId}`,
        JSON.stringify({ oauthReqInfo, clientName: client?.clientName ?? null }),
        { expirationTtl: 600 }
      );
      const target = new URL(env.APP_ORIGIN ?? APP_ORIGIN);
      target.searchParams.set("claude_connect", pendingId);
      return Response.redirect(target.href, 302);
    }

    // OAuth consent, step 2: numap.app approved. The browser is the only
    // party that knows its own session id (same-origin localStorage), so
    // possession of (pendingId, sessionId) proves app-side approval.
    if (pathname === "/authorize/complete" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const { pendingId, sessionId } = body ?? {};
      if (!pendingId || !sessionId) return json({ error: "pendingId and sessionId required" }, 400);

      const stored = await env.OAUTH_KV.get(`pending_auth:${pendingId}`, "json");
      if (!stored) return json({ error: "Unknown or expired authorization request" }, 404);
      await env.OAUTH_KV.delete(`pending_auth:${pendingId}`);

      const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
        request: stored.oauthReqInfo,
        userId: sessionId,
        metadata: { approvedAt: new Date().toISOString(), client: stored.clientName },
        scope: stored.oauthReqInfo.scope ?? [],
        props: { sessionId },
      });

      // The grant exists — mark the session paired so syncing/tools unlock
      // (same state the pairing-code flow sets).
      await sessionStub(env, sessionId).fetch(
        new Request(new URL(`/consent/${sessionId}`, request.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paired: true, enabled: true }),
        })
      );

      return json({ redirectTo });
    }

    if (pathname === "/health") {
      try {
        const query = await getQuery(env);
        return json({ ok: true, oauth: true, meta: query.meta });
      } catch (err) {
        return json({ ok: false, error: err.message }, 500);
      }
    }

    // Browser channel + legacy session-URL MCP.
    const sid = sessionIdOf(pathname);
    if (!sid) return json({ error: "Not found" }, 404);

    // Disconnect is a full reset: alongside the DO wiping its state, revoke
    // every OAuth grant for this session identity so stale tokens anywhere
    // (an old Claude Code entry, a claude.ai connector) die immediately and
    // those clients cleanly report "needs authentication" instead of
    // half-working against an abandoned identity.
    if (pathname.startsWith("/consent/") && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      if (body?.unpair) {
        try {
          const { items } = await env.OAUTH_PROVIDER.listUserGrants(sid);
          await Promise.all((items ?? []).map(g => env.OAUTH_PROVIDER.revokeGrant(g.id, sid)));
        } catch {}
      }
      return sessionStub(env, sid).fetch(
        new Request(request.url, {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(body ?? {}),
        })
      );
    }

    return sessionStub(env, sid).fetch(request);
  },
};

export default new OAuthProvider({
  apiRoute: "/mcp",
  apiHandler,
  defaultHandler,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["plan.read", "plan.propose"],
  allowPlainPKCE: false,
});
