// End-to-end test of the WebSocket browser channel against a running
// server (npm start, or PORT=28001 node index.js + MCP_BASE to match).
// Exercises exactly what the browser adapter does: pair, connect the WS,
// app-level ping/pong keepalive, live PROPOSAL broadcast, pending-proposal
// replay on a late-connecting tab, and PROPOSAL_RESOLVED fan-out.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { WebSocket } from "ws";

const BASE    = process.env.MCP_BASE ?? "http://localhost:27182";
const WS_BASE = BASE.replace(/^http/, "ws");
const SID     = "ws-e2e-test";

const plan = {
  planId: "p1", planName: "Main",
  placements: { CS2000: "fall2024", CS3000: "spr2025", CS3650: "fall2025" },
  semOrders: {}, placedOut: [], substitutions: [], workExperience: {},
  major: "", major2: "", concentration: "", minor1: "", minor2: "", bonusSH: 0,
  shOverrides: {}, offeredOverrides: {},
  entSem: "fall", entYear: 2024, gradSem: "spring", gradYear: 2028,
  currentSemId: "fall2025", studentType: "undergrad",
  starredIds: [], palette: [],
  allPlans: [{ id: "p1", name: "Main", active: true, studentType: "undergrad" }],
};

const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

function openWS() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${WS_BASE}/ws/${SID}`);
    const events = [];
    ws.on("message", (d) => events.push(d.toString()));
    ws.on("open", () => resolve({ ws, events }));
    ws.on("error", reject);
  });
}

const nextFrame = ({ ws }) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timed out waiting for a frame")), 5000);
    ws.once("message", (d) => { clearTimeout(t); resolve(d.toString()); });
  });

const post = (path, body) =>
  fetch(`${BASE}${path}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(r => r.json());

async function callTool(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(res.content[0].text);
}

// 1. Pair (Claude issues a code, the "user" enters it) and sync a plan.
const client = new Client({ name: "ws-e2e", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/session/${SID}/mcp`)));
const pairing = await callTool(client, "request_pairing", {});
const paired  = await post(`/pair/${SID}`, { code: pairing.data.code });
if (!paired.ok) fail("pairing rejected");
await post(`/sync-plan/${SID}`, { v: 1, plan });
console.log("paired + plan synced");

// 2. WebSocket connect + app-level keepalive.
const tab1 = await openWS();
const pong = nextFrame(tab1);
tab1.ws.send("ping");
if (await pong !== "pong") fail("expected pong for ping");
console.log("ws connected, ping → pong");

// 3. A proposal broadcast reaches the connected tab as a JSON frame.
const proposalFrame = nextFrame(tab1);
const proposed = await callTool(client, "propose_changes", {
  actions: [{ type: "MOVE_COURSE", courseId: "CS3650", toSemId: "spr2025" }],
  rationale: "ws-e2e",
});
if (proposed.data.status !== "queued") fail(`propose not queued: ${JSON.stringify(proposed.data)}`);
const ev1 = JSON.parse(await proposalFrame);
if (ev1.type !== "PROPOSAL" || ev1.proposalId !== proposed.data.proposalId) fail("tab1 did not get the PROPOSAL");
console.log("live PROPOSAL broadcast received");

// 4. A tab connecting AFTER the broadcast gets the pending proposal replayed.
const tab2 = await openWS();
const replay = JSON.parse(await (tab2.events[0] ? Promise.resolve(tab2.events[0]) : nextFrame(tab2)));
if (replay.type !== "PROPOSAL" || replay.proposalId !== proposed.data.proposalId) fail("no pending-proposal replay on connect");
console.log("pending PROPOSAL replayed to late tab");

// 5. Resolution fans out to every connected tab.
const res1 = nextFrame(tab1), res2 = nextFrame(tab2);
await post(`/confirm-proposal/${SID}/${proposed.data.proposalId}`, { accepted: true });
const [r1, r2] = (await Promise.all([res1, res2])).map(JSON.parse);
if (r1.type !== "PROPOSAL_RESOLVED" || !r1.accepted) fail("tab1 missed PROPOSAL_RESOLVED");
if (r2.type !== "PROPOSAL_RESOLVED" || !r2.accepted) fail("tab2 missed PROPOSAL_RESOLVED");
console.log("PROPOSAL_RESOLVED fan-out ok");

// 6. Clean close.
tab1.ws.close(); tab2.ws.close();
await post(`/consent/${SID}`, { unpair: true });
await client.close();
console.log("ws-e2e: ALL OK");
process.exit(0);
