// NU Map MCP Worker — entry router.
//
// Same HTTP surface as the Node dev server (mcp-server/index.js); every
// session-scoped route is forwarded to that session's Durable Object.
//
//   GET  /events/:sid                    SSE → browser
//   POST /sync-plan/:sid                 browser → server (plan snapshots)
//   POST /pair/:sid                      pairing-code confirmation (in-app)
//   POST /consent/:sid                   kill switch / auto-apply / unpair
//   POST /confirm-proposal/:sid/:id      user approved/rejected a proposal
//   POST /plan-contents/:sid/:reqId      answer to a REQUEST_PLAN event
//   ALL  /session/:sid/mcp               MCP protocol (Streamable HTTP, JSON mode)
//   GET  /health

import { getQuery } from "./loadData.js";
export { SessionDO } from "./sessionDO.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
};

/** Session id from any of the supported route shapes, or null. */
function sessionIdOf(pathname) {
  const seg = pathname.split("/").filter(Boolean);
  if (["events", "sync-plan", "pair", "consent"].includes(seg[0]) && seg[1]) return seg[1];
  if (["confirm-proposal", "plan-contents"].includes(seg[0]) && seg[1] && seg[2]) return seg[1];
  if (seg[0] === "session" && seg[1] && seg[2] === "mcp") return seg[1];
  return null;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });

    const { pathname } = new URL(request.url);

    if (pathname === "/health") {
      try {
        const query = await getQuery(env);
        return Response.json({ ok: true, meta: query.meta }, { headers: CORS });
      } catch (err) {
        return Response.json({ ok: false, error: err.message }, { status: 500, headers: CORS });
      }
    }

    const sid = sessionIdOf(pathname);
    if (!sid) return Response.json({ error: "Not found" }, { status: 404, headers: CORS });

    const stub = env.SESSION.get(env.SESSION.idFromName(sid));
    return stub.fetch(request);
  },
};
