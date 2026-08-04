// NU Map — Copyright (C) 2025-2026 Nathan Gu and Matthew Gu
// SPDX-License-Identifier: AGPL-3.0-only
// AGPL-3.0-only + attribution term under §7(b); see LICENSING.md and NOTICE.
//
// NU Map MCP Server — entry point & composition root.
//
// This is where the hexagon gets assembled for Node: the Northeastern
// adapters (fs-based catalog + program registry, calendar, attributes,
// special terms, credits, offering stats) are injected into the
// institution-agnostic MCP planner-query adapter, which the MCP tool
// layer (src/server.js) serializes. No domain logic lives in this repo
// directory — it all comes from src/adapters and src/core.
//
// HTTP surface:
//   GET  /ws/:sessionId                   WebSocket   → browser  (proposals, apply, commands, plan requests)
//   GET  /events/:sessionId               SSE stream  → browser  (legacy transport, same frames)
//   POST /sync-plan/:sessionId            browser     → server   (live plan state; {v, plan} envelope or bare plan)
//   POST /confirm-proposal/:sid/:id       browser     → server   (user approved / rejected a proposal)
//   POST /consent/:sessionId              browser     → server   ({enabled} — the in-app kill switch)
//   POST /plan-contents/:sid/:requestId   browser     → server   (response to a REQUEST_PLAN event)
//   GET  /health                          liveness probe
//   ALL  /session/:sessionId/mcp          MCP protocol (Streamable HTTP, stateless per session)

import express from "express";
import cors from "cors";
import { WebSocketServer } from "ws";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadCatalog, courseUrl } from "../src/adapters/northeastern/courseCatalog.node.js";
import { loadPrograms } from "../src/adapters/northeastern/programRegistry.node.js";
import calendar from "../src/adapters/northeastern/calendar.js";
import attributeSystem from "../src/adapters/northeastern/attributeSystem.js";
import specialTerms from "../src/adapters/northeastern/specialTerms.js";
import creditSystem from "../src/adapters/northeastern/creditSystem.js";
import * as offeringStats from "../src/adapters/northeastern/offeringStats.js";
import { createPlannerQuery } from "../src/adapters/mcp/plannerQueryAdapter.js";

import { addClient, addSocket, broadcast, clientCount } from "./src/events.js";
import * as planState from "./src/planState.js";
import { createMemoryShareBox } from "./src/shareBox.js";
import { createServer, SYNC_PAYLOAD_VERSION } from "./src/server.js";

// Node flavor of the injected deps: module singletons.
const channel = { broadcast, clientCount };

const PORT = parseInt(process.env.PORT ?? "27182", 10);

// ── Boot: assemble the query adapter ────────────────────────────────
console.log("Loading course catalog and program data…");
const catalog  = loadCatalog();
const programs = loadPrograms();
const query = createPlannerQuery({
  catalog, programs,
  calendar, attributeSystem, specialTerms, creditSystem, offeringStats, courseUrl,
  sources: [
    { id: "catalog",  label: "catalog.northeastern.edu", url: "https://catalog.northeastern.edu/course-descriptions/", usedFor: "course catalog data" },
    { id: "nubanner", label: "nubanner.neu.edu",         url: "https://nubanner.neu.edu/StudentRegistrationSsb",       usedFor: "term availability, enrollment, and meeting-pattern history" },
  ],
});
console.log(`  ${Object.keys(catalog.courseMap).length} courses  |  ${programs.programs.length} programs (${programs.programs.filter(p => p.level === "grad").length} grad)`);

// ── Express ─────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));

// Replay pending proposals on connect: a proposal broadcast while the
// tab's channel was still connecting would otherwise never show its
// review card (Claude keeps waiting on a decision the user can't see).
// The browser dedupes by proposal id, so replays are idempotent.
function pendingProposalEvents(sessionId) {
  return planState.listProposals(sessionId)
    .filter(p => p.status === "pending")
    .map(p => ({ type: "PROPOSAL", proposalId: p.id, changeset: p.changeset, meta: p.meta }));
}

// ── SSE  (server → browser; legacy transport, kept for old clients) ─
app.get("/events/:sessionId", (req, res) => {
  addClient(req.params.sessionId, res);
  for (const ev of pendingProposalEvents(req.params.sessionId)) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }
});

// ── Plan sync  (browser → server) ──────────────────────────────────
// Tolerant reader: accepts the { v, plan } envelope or a bare legacy
// PlanContext object, and ignores unknown fields either way.
// Plan data is only STORED while paired — before the user links their
// Claude, nothing leaves their browser and nothing sits on the server.
app.post("/sync-plan/:sessionId", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Expected a PlanContext JSON object" });
  }
  if (!planState.getConsent(req.params.sessionId).paired) {
    return res.json({ ok: false, reason: "not_paired" });
  }
  const plan = (typeof body.v === "number" && body.plan && typeof body.plan === "object")
    ? body.plan
    : body;
  const rev = planState.setPlan(req.params.sessionId, plan, "browser");
  res.json({ ok: true, rev, v: SYNC_PAYLOAD_VERSION });
});

// ── Pairing confirmation (browser → server) ─────────────────────────
// The user enters the code Claude showed them INTO NU Map — approval
// happens in the app, never in the chat.
app.post("/pair/:sessionId", (req, res) => {
  const ok = planState.confirmPairing(req.params.sessionId, req.body?.code);
  res.json({ ok, consent: planState.getConsent(req.params.sessionId) });
});

// ── Consent (kill switch, auto-apply, unpair, restore-after-restart) ─
// Browser-only channel: the browser owns the session secret, so it may
// restore `paired` after a server restart. MCP tools cannot reach this.
app.post("/consent/:sessionId", (req, res) => {
  planState.setConsent(req.params.sessionId, req.body ?? {});
  res.json({ ok: true, consent: planState.getConsent(req.params.sessionId) });
});

// ── Proposal confirmation  (browser → server) ────────────────────────
app.post("/confirm-proposal/:sessionId/:id", (req, res) => {
  const { sessionId, id } = req.params;
  const { accepted }      = req.body ?? {};
  const proposal          = planState.getProposal(sessionId, id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  planState.resolveProposal(sessionId, id, !!accepted);
  broadcast(sessionId, { type: "PROPOSAL_RESOLVED", proposalId: id, accepted: !!accepted });
  res.json({ ok: true });
});

// ── Plan-contents response  (browser → server, answers REQUEST_PLAN) ─
app.post("/plan-contents/:sessionId/:requestId", (req, res) => {
  const ok = planState.resolvePlanRequest(
    req.params.sessionId, req.params.requestId, req.body ?? null
  );
  res.json({ ok });
});

// ── Share by code (browser ↔ browser, this server is just the coat check) ──
// One-shot relay for plan snapshots: park under a short code, first claim
// takes it and burns it, unclaimed shares expire. Session-free — sharing
// needs no pairing and touches no per-session state. See src/shareBox.js.
const shareBox = createMemoryShareBox();

const shareStatus = (r) =>
  r.ok ? 200
  : r.reason === "rate_limited" || r.reason === "too_many_live" ? 429
  : r.reason === "not_found" ? 404
  : 400;

app.post("/share", async (req, res) => {
  const result = await shareBox.create(req.body?.payload, req.ip);
  res.status(shareStatus(result)).json(result);
});

app.post("/claim/:code", async (req, res) => {
  const result = await shareBox.claim(req.params.code, req.ip);
  res.status(shareStatus(result)).json(result);
});

app.get("/share-status/:code", async (req, res) => {
  const result = await shareBox.status(req.params.code, req.ip);
  res.status(shareStatus(result)).json(result);
});

// ── Health ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true, courses: Object.keys(catalog.courseMap).length }));

// ── MCP transport  (stateless Streamable HTTP, per session) ──────────
app.all("/session/:sessionId/mcp", async (req, res) => {
  const { sessionId } = req.params;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session cookies
  });
  const mcpServer = createServer({ query, sessionId, state: planState, channel });
  try {
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.error("[MCP] transport error:", err.message);
    if (!res.headersSent) res.status(500).json({ error: "Internal MCP error" });
  } finally {
    res.on("finish", () => mcpServer.close().catch(() => {}));
  }
});

// ── Start ────────────────────────────────────────────────────────────
const httpServer = app.listen(PORT, () => {
  console.log(`\nNU Map MCP server listening on http://localhost:${PORT}`);
  console.log(`  MCP endpoint:  /session/:sessionId/mcp`);
  console.log(`  WS → browser:  /ws/:sessionId`);
  console.log(`  SSE → browser: /events/:sessionId (legacy)`);
  console.log(`  Plan sync:     POST /sync-plan/:sessionId`);
  console.log(`  Consent:       POST /consent/:sessionId`);
});

// ── WebSocket  (server → browser; same JSON frames as the SSE data) ──
// Mirrors the Cloudflare worker's /ws/:sessionId hibernation endpoint so
// VITE_MCP_SERVER_URL can point at either. `ws` lives only in this
// package — the browser bundle never sees it.
const wss = new WebSocketServer({ noServer: true });
httpServer.on("upgrade", (req, socket, head) => {
  // Share pickup interrupt: the sender tab parks a socket on its code
  // and is pushed 'claimed' the instant the code burns (see shareBox).
  const sw = /^\/share-ws\/([^/?#]+)/.exec(req.url ?? "");
  if (sw) {
    const code = decodeURIComponent(sw[1]);
    wss.handleUpgrade(req, socket, head, (ws) => {
      shareBox.watch(code, req.socket.remoteAddress, ws);
    });
    return;
  }
  const m = /^\/ws\/([^/?#]+)/.exec(req.url ?? "");
  if (!m) { socket.destroy(); return; }
  const sessionId = decodeURIComponent(m[1]);
  wss.handleUpgrade(req, socket, head, (ws) => {
    addSocket(sessionId, ws);
    for (const ev of pendingProposalEvents(sessionId)) {
      try { ws.send(JSON.stringify(ev)); } catch {}
    }
  });
});
