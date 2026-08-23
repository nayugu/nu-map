// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
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
//   GET  /ws/:sid (WebSocket, hibernatable) · GET /events/:sid (legacy SSE)
//   POST /sync-plan/:sid · /pair/:sid · /consent/:sid
//   POST /confirm-proposal/:sid/:id · /plan-contents/:sid/:reqId · GET /health
//
// Share by code (session-free, one-shot plan relay — ShareBoxDO):
//   POST /share · POST /claim/:code

import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { getQuery, isolateStats } from "./loadData.js";
import { maintenanceGate } from "./maintenance.js";
export { SessionDO } from "./sessionDO.js";
export { ShareBoxDO } from "./shareBoxDO.js";

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
  if (["ws", "events", "sync-plan", "pair", "consent"].includes(seg[0]) && seg[1]) return seg[1];
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
    // Scheduled maintenance closes this surface too. The site's edge returns
    // 503 during an `offline` window, and a worker that kept answering would
    // leave Claude reading and proposing against a deployment we took off for
    // safety. See ./maintenance.js — fails open, never gates /health.
    const shut = await maintenanceGate(request, env);
    if (shut) return shut;
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
    // Same gate as apiHandler, and deliberately BEFORE the router: during an
    // offline window there is nothing here worth answering except /health,
    // which ./maintenance.js exempts precisely so an incident stays observable.
    const shut = await maintenanceGate(request, env);
    if (shut) return shut;
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

    // OAuth consent, denied: build the spec-compliant error redirect back
    // to the client (redirect_uri?error=access_denied&state=…) so Claude
    // Code / claude.ai get a clean rejection instead of hanging on a
    // callback that never arrives.
    if (pathname === "/authorize/deny" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const stored = body?.pendingId
        ? await env.OAUTH_KV.get(`pending_auth:${body.pendingId}`, "json")
        : null;
      if (!stored) return json({ redirectTo: null });
      await env.OAUTH_KV.delete(`pending_auth:${body.pendingId}`);
      const info = stored.oauthReqInfo;
      let redirectTo = null;
      if (info?.redirectUri) {
        const u = new URL(info.redirectUri);
        u.searchParams.set("error", "access_denied");
        u.searchParams.set("error_description", "The user declined to share their NU Map plan.");
        if (info.state) u.searchParams.set("state", info.state);
        redirectTo = u.href;
      }
      return json({ redirectTo });
    }

    // Share by code: one-shot plan relay, session-free (no pairing, no
    // OAuth — the payload is the grade-free snapshot-link artifact and
    // burns on first claim). SHARE_DISABLED is the kill switch: set it
    // to any value in the dashboard to 503 these routes without a deploy.
    if (pathname === "/share" || pathname.startsWith("/claim/") || pathname.startsWith("/share-status/")) {
      if (env.SHARE_DISABLED) return json({ ok: false, reason: "disabled" }, 503);
      return env.SHAREBOX.get(env.SHAREBOX.idFromName("global")).fetch(request);
    }

    // Deep health check. `ok: true` used to mean only "the build did not
    // throw", which is a weaker statement than it looks: a scrape that half
    // failed, or a DATA_ORIGIN serving the SPA shell instead of JSON, both
    // produce a catalog that parses fine and is mostly empty. This endpoint is
    // what a monitor polls, so it has to be able to say "up but wrong".
    //
    // The floors below are deliberately far under the real figures (7,966
    // courses and 1,071 programs as of 2026-08-22). They are not accuracy
    // checks — verify-chart and the scrape rails do that job properly — they
    // are a tripwire for the order-of-magnitude failure, which is the one a
    // liveness probe can actually catch.
    if (pathname === "/health") {
      try {
        const query = await getQuery(env);
        const counts = query.healthCounts?.() ?? null;
        const floors = { courses: 5000, programs: 500 };
        const degraded = counts
          ? Object.entries(floors).filter(([k, min]) => (counts[k] ?? 0) < min).map(([k]) => k)
          : [];
        return json({
          ok: degraded.length === 0,
          oauth: true,
          meta: query.meta,
          counts,
          degraded: degraded.length ? degraded : undefined,
          isolate: isolateStats(),
        }, degraded.length ? 503 : 200);
      } catch (err) {
        // The message is the operator's, not a user's — this endpoint is not
        // reachable from a plan and carries no personal data.
        return json({ ok: false, error: err.message, isolate: isolateStats() }, 500);
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
