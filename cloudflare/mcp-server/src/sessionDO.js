// SessionDO — one Durable Object per nu-map session (browser ↔ Claude).
//
// Holds the same per-session state as the Node dev server's planState
// module (it literally reuses that module — Map-keyed by session id, so
// instances sharing an isolate can't collide) and adds:
//   • durability: pairing/consent + the latest plan snapshot survive
//     eviction via DO storage (proposals/changes are ephemeral)
//   • the browser channel: hibernatable WebSockets (/ws) with an SSE
//     fallback (/events) for clients built before the WS migration
//   • the MCP endpoint, served stateless-per-request through
//     SingleRequestTransport (JSON-mode Streamable HTTP)
//
// WebSockets use the DO Hibernation API on purpose: an SSE stream pins
// this object in memory for the life of the tab (25 s heartbeat forever),
// which bills 128 MB × wall-clock seconds and exhausted the free tier
// with two all-day tabs. A hibernated WebSocket keeps the connection
// alive while the object is evicted; ping/pong is answered by the
// runtime via setWebSocketAutoResponse without ever waking us, so idle
// duration cost is ~zero. In-memory state (planState's ephemeral
// proposals/changes) dies with each hibernation exactly as it already
// died with eviction — the constructor's blockConcurrencyWhile restores
// the durable parts (consent + plan) on every wake.

import * as planState from "../../../mcp-server/src/planState.js";
import { createServer, SYNC_PAYLOAD_VERSION } from "../../../mcp-server/src/server.js";
import { SingleRequestTransport } from "./transport.js";
import { getQuery } from "./loadData.js";

const enc = new TextEncoder();

// App-level keepalive frames. Must match the browser adapter
// (src/adapters/northeastern/aiAssistant.js) and the Node dev server
// (mcp-server/src/events.js): the browser sends PING_FRAME, the runtime
// answers PONG_FRAME on our behalf while we hibernate.
const PING_FRAME = "ping";
const PONG_FRAME = "pong";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "*",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

export class SessionDO {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.sid = ctx.id.name;          // DO is addressed by idFromName(sessionId)
    this.sseClients = new Set();     // { controller } per open browser tab (legacy SSE)
    this.heartbeat = null;

    // Keepalive answered by the runtime WITHOUT waking a hibernated DO —
    // the whole point of the WS migration. Cheap and idempotent to re-set
    // on every wake (the constructor reruns after each hibernation).
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(PING_FRAME, PONG_FRAME)
    );

    // Restore durable state (pairing/consent + last plan snapshot) so a
    // paired session survives eviction/redeploys without re-pairing.
    this.ctx.blockConcurrencyWhile(async () => {
      const [consent, plan] = await Promise.all([
        this.ctx.storage.get("consent"),
        this.ctx.storage.get("plan"),
      ]);
      if (consent) planState.setConsent(this.sid, consent);
      if (plan && !planState.getPlan(this.sid)) planState.setPlan(this.sid, plan, "browser");
    });

    // State adapter: the shared planState module + write-through
    // persistence on the durable parts.
    const persistPlan    = () => this.ctx.storage.put("plan", planState.getPlan(this.sid)).catch(() => {});
    const persistConsent = () => this.ctx.storage.put("consent", planState.getConsent(this.sid)).catch(() => {});
    this.state = {
      ...planState,
      setPlan: (sid, plan, origin) => {
        const rev = planState.setPlan(sid, plan, origin);
        persistPlan();
        return rev;
      },
      setConsent: (sid, patch) => {
        planState.setConsent(sid, patch);
        persistConsent();
      },
      confirmPairing: (sid, code) => {
        const ok = planState.confirmPairing(sid, code);
        if (ok) persistConsent();
        return ok;
      },
    };

    this.channel = {
      broadcast: (_sid, event) => this.broadcast(event),
      clientCount: () => this.sseClients.size + this.ctx.getWebSockets().length,
    };
  }

  // ── Browser channel (server → browser) ──────────────────────────

  broadcast(event) {
    const frame = JSON.stringify(event);
    // Hibernation-aware: getWebSockets() returns every socket accepted via
    // acceptWebSocket, including ones taken while a previous incarnation of
    // this object was alive — send() wakes nothing extra, the DO is already
    // awake to be running this.
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(frame); } catch { /* runtime reaps broken sockets */ }
    }
    const chunk = enc.encode(`data: ${frame}\n\n`);
    for (const client of [...this.sseClients]) {
      try { client.controller.enqueue(chunk); }
      catch { this.dropClient(client); }
    }
  }

  // ── WebSocket (hibernatable — the current transport) ────────────

  openWebSocket(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade" }, 426);
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // acceptWebSocket (NOT server.accept()) hands the socket to the
    // runtime so this object can hibernate while it stays open.
    this.ctx.acceptWebSocket(server);

    // Replay pending proposals so a tab that connects after the broadcast
    // still shows the review card (browser dedupes by proposal id).
    for (const p of planState.listProposals(this.sid)) {
      if (p.status === "pending") {
        try {
          server.send(JSON.stringify({ type: "PROPOSAL", proposalId: p.id, changeset: p.changeset, meta: p.meta }));
        } catch {}
      }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // Hibernation handlers. The channel is one-way (server → browser; the
  // browser talks back over plain POSTs), and ping/pong is auto-answered
  // without waking us — so a message here is unexpected but harmless.
  webSocketMessage(_ws, _message) {}

  webSocketClose(ws, code, _reason, _wasClean) {
    // 1006 is not a valid code to send; normalize like the runtime does.
    try { ws.close(code === 1006 ? 1000 : code); } catch {}
  }

  webSocketError(ws) {
    try { ws.close(1011); } catch {}
  }

  // ── SSE (legacy transport — kept for pre-WS client builds) ──────

  dropClient(client) {
    this.sseClients.delete(client);
    if (this.sseClients.size === 0 && this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  openSSE() {
    const client = {};
    const stream = new ReadableStream({
      start: (controller) => {
        client.controller = controller;
        controller.enqueue(enc.encode("retry: 3000\n\n"));
        // Replay pending proposals so a tab that connects after the
        // broadcast still shows the review card (browser dedupes by id).
        for (const p of planState.listProposals(this.sid)) {
          if (p.status === "pending") {
            controller.enqueue(enc.encode(
              `data: ${JSON.stringify({ type: "PROPOSAL", proposalId: p.id, changeset: p.changeset, meta: p.meta })}\n\n`
            ));
          }
        }
        this.sseClients.add(client);
        this.heartbeat ??= setInterval(() => {
          for (const c of [...this.sseClients]) {
            try { c.controller.enqueue(enc.encode(": heartbeat\n\n")); }
            catch { this.dropClient(c); }
          }
        }, 25_000);
      },
      cancel: () => this.dropClient(client),
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        ...CORS,
      },
    });
  }

  // ── MCP endpoint (stateless per request, JSON mode) ─────────────

  async handleMcp(request) {
    if (request.method === "GET")    return new Response(null, { status: 405, headers: { Allow: "POST, DELETE", ...CORS } });
    if (request.method === "DELETE") return json({ ok: true });

    let body;
    try { body = await request.json(); }
    catch { return json({ jsonrpc: "2.0", error: { code: -32700, message: "Parse error" }, id: null }, 400); }

    const query     = await getQuery(this.env);
    const server    = createServer({ query, sessionId: this.sid, state: this.state, channel: this.channel });
    const transport = new SingleRequestTransport();
    await server.connect(transport);
    try {
      const result = await transport.handle(body);
      if (result === null) return new Response(null, { status: 202, headers: CORS });
      return json(result);
    } finally {
      server.close().catch(() => {});
    }
  }

  // ── Router ──────────────────────────────────────────────────────

  async fetch(request) {
    const { pathname } = new URL(request.url);
    const seg = pathname.split("/").filter(Boolean); // e.g. ["sync-plan", sid] or ["session", sid, "mcp"]

    try {
      if (seg[0] === "ws")       return this.openWebSocket(request);
      if (seg[0] === "events")   return this.openSSE();

      if (seg[0] === "session" && seg[2] === "mcp") return this.handleMcp(request);

      if (seg[0] === "sync-plan") {
        const body = await request.json().catch(() => null);
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return json({ error: "Expected a PlanContext JSON object" }, 400);
        }
        if (!this.state.getConsent(this.sid).paired) {
          return json({ ok: false, reason: "not_paired" });
        }
        const plan = (typeof body.v === "number" && body.plan && typeof body.plan === "object")
          ? body.plan : body;
        const rev = this.state.setPlan(this.sid, plan, "browser");
        return json({ ok: true, rev, v: SYNC_PAYLOAD_VERSION });
      }

      if (seg[0] === "pair") {
        const body = await request.json().catch(() => ({}));
        const ok = this.state.confirmPairing(this.sid, body?.code);
        return json({ ok, consent: this.state.getConsent(this.sid) });
      }

      if (seg[0] === "consent") {
        const body = await request.json().catch(() => ({}));
        this.state.setConsent(this.sid, body ?? {});
        if (body?.unpair) {
          // Disconnect deletes the durable copy too — nothing outlives the link.
          await this.ctx.storage.delete("plan").catch(() => {});
        }
        return json({ ok: true, consent: this.state.getConsent(this.sid) });
      }

      if (seg[0] === "confirm-proposal") {
        const id = seg[2];
        const body = await request.json().catch(() => ({}));
        const proposal = this.state.getProposal(this.sid, id);
        if (!proposal) return json({ error: "Proposal not found" }, 404);
        this.state.resolveProposal(this.sid, id, !!body?.accepted);
        this.broadcast({ type: "PROPOSAL_RESOLVED", proposalId: id, accepted: !!body?.accepted });
        return json({ ok: true });
      }

      if (seg[0] === "plan-contents") {
        const requestId = seg[2];
        const contents = await request.json().catch(() => null);
        const ok = this.state.resolvePlanRequest(this.sid, requestId, contents);
        return json({ ok });
      }

      return json({ error: "Not found" }, 404);
    } catch (err) {
      return json({ error: `Internal error: ${err.message}` }, 500);
    }
  }
}
