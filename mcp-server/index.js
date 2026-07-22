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
//   GET  /events/:sessionId               SSE stream  → browser  (proposals, apply, commands, plan requests)
//   POST /sync-plan/:sessionId            browser     → server   (live plan state; {v, plan} envelope or bare plan)
//   POST /confirm-proposal/:sid/:id       browser     → server   (user approved / rejected a proposal)
//   POST /consent/:sessionId              browser     → server   ({enabled} — the in-app kill switch)
//   POST /plan-contents/:sid/:requestId   browser     → server   (response to a REQUEST_PLAN event)
//   GET  /health                          liveness probe
//   ALL  /session/:sessionId/mcp          MCP protocol (Streamable HTTP, stateless per session)

import express from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { loadCatalog, courseUrl } from "../src/adapters/northeastern/courseCatalog.node.js";
import { loadPrograms } from "../src/adapters/northeastern/programRegistry.node.js";
import calendar from "../src/adapters/northeastern/calendar.js";
import attributeSystem from "../src/adapters/northeastern/attributeSystem.js";
import specialTerms from "../src/adapters/northeastern/specialTerms.js";
import creditSystem from "../src/adapters/northeastern/creditSystem.js";
import * as offeringStats from "../src/adapters/northeastern/offeringStats.js";
import { createPlannerQuery } from "../src/adapters/mcp/plannerQueryAdapter.js";

import { addClient, broadcast } from "./src/events.js";
import * as planState from "./src/planState.js";
import { createServer, SYNC_PAYLOAD_VERSION } from "./src/server.js";

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

// ── SSE  (server → browser) ─────────────────────────────────────────
app.get("/events/:sessionId", (req, res) => addClient(req.params.sessionId, res));

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

// ── Health ───────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true, courses: Object.keys(catalog.courseMap).length }));

// ── MCP transport  (stateless Streamable HTTP, per session) ──────────
app.all("/session/:sessionId/mcp", async (req, res) => {
  const { sessionId } = req.params;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session cookies
  });
  const mcpServer = createServer({ query, sessionId });
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
app.listen(PORT, () => {
  console.log(`\nNU Map MCP server listening on http://localhost:${PORT}`);
  console.log(`  MCP endpoint:  /session/:sessionId/mcp`);
  console.log(`  SSE → browser: /events/:sessionId`);
  console.log(`  Plan sync:     POST /sync-plan/:sessionId`);
  console.log(`  Consent:       POST /consent/:sessionId`);
});
