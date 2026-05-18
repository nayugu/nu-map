// NU Map MCP Server — entry point
//
// STATUS: Built and functional, but not yet deployed.
// To enable the Claude integration:
//   1. Deploy this server to a persistent host (Railway, Fly.io, etc.)
//   2. Set VITE_MCP_SERVER_URL=https://your-host in the frontend build env
//   3. Uncomment aiAssistant in src/config.js and ClaudePanel in src/ui/Header.jsx
//   4. Have Northeastern IT approve the connector, or wire in an Anthropic API key
//
// Exposes:
//   GET  /events/:sessionId               SSE stream  → browser  (proposals, apply events, UI commands)
//   POST /sync-plan/:sessionId            browser     → server   (live plan state)
//   POST /confirm-proposal/:sid/:id       browser     → server   (user approved / rejected a proposal)
//   ALL  /session/:sessionId/mcp          MCP protocol (Streamable HTTP, stateless per session)

import express from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { addClient, broadcast } from "./src/events.js";
import * as planState from "./src/planState.js";
import { loadData } from "./src/data.js";
import { createServer } from "./src/server.js";

const PORT = parseInt(process.env.PORT ?? "27182", 10);

// ── Boot ────────────────────────────────────────────────────────────
console.log("Loading course catalog and major data…");
const data = await loadData();
console.log(
  `  ${Object.keys(data.courseMap).length} courses  |  ${data.programs.length} programs loaded`
);

// ── Express ─────────────────────────────────────────────────────────
const app = express();
app.use(cors({ origin: "*" }));
app.use(express.json({ limit: "2mb" }));

// ── SSE  (server → browser) ─────────────────────────────────────────
app.get("/events/:sessionId", (req, res) => addClient(req.params.sessionId, res));

// ── Plan sync  (browser → server) ──────────────────────────────────
app.post("/sync-plan/:sessionId", (req, res) => {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res.status(400).json({ error: "Expected a PlanContext JSON object" });
  }
  planState.setPlan(req.params.sessionId, body);
  res.json({ ok: true });
});

// ── Proposal confirmation  (browser → server) ────────────────────────
app.post("/confirm-proposal/:sessionId/:id", (req, res) => {
  const { sessionId, id } = req.params;
  const { accepted }      = req.body ?? {};
  const proposal          = planState.getProposal(sessionId, id);
  if (!proposal) return res.status(404).json({ error: "Proposal not found" });
  planState.resolveProposal(sessionId, id);
  broadcast(sessionId, { type: "PROPOSAL_RESOLVED", proposalId: id, accepted: !!accepted });
  res.json({ ok: true });
});

// ── MCP transport  (stateless Streamable HTTP, per session) ──────────
// Each request gets its own transport + server instance.
// State (plan, proposals) lives in the planState module, keyed by sessionId.
app.all("/session/:sessionId/mcp", async (req, res) => {
  const { sessionId } = req.params;
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session cookies
  });
  const mcpServer = createServer({ data, sessionId });
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
  console.log(`  Confirm:       POST /confirm-proposal/:sessionId/:id`);
});
