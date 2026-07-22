// End-to-end MCP test against the running server on :27183.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const BASE = "http://localhost:27182";
const SID  = "e2e-test";

const plan = {
  planId: "p1", planName: "Main",
  placements: { CS2000: "fall2024", CS2100: "fall2024", CS3000: "spr2025", CS3650: "fall2025", MATH1341: "incoming" },
  semOrders: {}, placedOut: ["ENGW1111"], substitutions: [],
  workExperience: { wt_1: { typeId: "coop", semId: "spr2026", duration: 6, company: "Anthropic" } },
  major: "2026/computer-information-science/computer_science_bscs_(boston)",
  major2: "", concentration: "", minor1: "", minor2: "", bonusSH: 8,
  shOverrides: {}, offeredOverrides: {},
  entSem: "fall", entYear: 2024, gradSem: "spring", gradYear: 2028,
  currentSemId: "fall2025", studentType: "undergrad",
  starredIds: ["CS4700"], palette: ["CS3800"],
  allPlans: [{ id: "p1", name: "Main", active: true, studentType: "undergrad" }],
};

async function callTool(client, name, args = {}) {
  const res = await client.callTool({ name, arguments: args });
  return JSON.parse(res.content[0].text);
}

// 0. Connect MCP client
const client = new Client({ name: "e2e", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(`${BASE}/session/${SID}/mcp`)));

const tools = await client.listTools();
console.log("tools:", tools.tools.map(t => t.name).join(", "));

// 1. DEFAULT OFF: sync refused, plan tools locked until paired
let r0 = await fetch(`${BASE}/sync-plan/${SID}`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ v: 1, plan }),
});
console.log("sync before pairing:", JSON.stringify(await r0.json()));
const locked = await callTool(client, "get_plan", {});
console.log("get_plan before pairing:", locked.data.error?.slice(0, 25));

// 1b. Pair: Claude requests a code → user enters it in the app (simulated POST /pair)
const pairing = await callTool(client, "request_pairing", {});
console.log("pairing code issued:", /^[A-Z2-9]{6}$/.test(pairing.data.code), "| status:", pairing.data.status);
const badPair = await fetch(`${BASE}/pair/${SID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: "NOPE99" }) }).then(r => r.json());
const okPair  = await fetch(`${BASE}/pair/${SID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: pairing.data.code }) }).then(r => r.json());
console.log("pair wrong code:", badPair.ok, "| right code:", okPair.ok, "| paired:", okPair.consent.paired, "| autoApply:", okPair.consent.autoApply);

// 1c. Sync now succeeds
let r = await fetch(`${BASE}/sync-plan/${SID}`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ v: 1, plan }),
});
console.log("sync after pairing:", JSON.stringify(await r.json()));

// 3. get_plan with facets
const gp = await callTool(client, "get_plan", { include: ["schedule", "semesters", "violations", "nupath"] });
console.log("_plan envelope:", JSON.stringify(gp._plan));
console.log("majorLabel:", gp.data.majorLabel, "| studentType:", gp.data.studentType, "| palette:", gp.data.palette);
console.log("semesters:", gp.data._semesters.length, "| fall2025 status:", gp.data._semesters.find(s=>s.id==="fall2025")?.status);
console.log("violations:", gp.data._violations.length, "| EX satisfied:", gp.data._nupath.find(c=>c.code==="EX")?.satisfied);

// 4. Simulate a user edit between calls → envelope should report it
const plan2 = { ...plan, placements: { ...plan.placements, CS3800: "spr2026" } };
await fetch(`${BASE}/sync-plan/${SID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ v: 1, plan: plan2 }) });
const search = await callTool(client, "search_courses", { query: "algorithms", limit: 2 });
console.log("after edit, envelope says:", JSON.stringify(search._plan.recentChanges), "changed:", search._plan.changedSinceLastRead);

// 5. audit with defaults (live plan's major)
const audit = await callTool(client, "audit_requirements", {});
console.log("audit:", audit.data.label, "| sections:", audit.data.sections.length);

// 6. validate + apply (no browser connected → apply should reject)
const val = await callTool(client, "validate_changeset", { actions: [{ type: "MOVE_COURSE", courseId: "CS3650", toSemId: "spr2025" }, { type: "SET_NOT_A_THING" }] });
console.log("validate: valid:", val.data.valid, "| unsupported:", val.data.unsupported);
const app = await callTool(client, "apply_changes", { actions: [{ type: "MOVE_COURSE", courseId: "CS3650", toSemId: "spr2025" }] });
console.log("apply (auto-apply off, default):", app.data.status, "|", app.data.reason?.slice(0, 30));
await fetch(`${BASE}/consent/${SID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoApply: true }) });
const app2 = await callTool(client, "apply_changes", { actions: [{ type: "MOVE_COURSE", courseId: "CS3650", toSemId: "spr2025" }] });
console.log("apply (auto-apply on, no tab):", app2.data.status, "|", app2.data.reason?.slice(0, 30));
await fetch(`${BASE}/consent/${SID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ autoApply: false }) });

// 7. get_meta capabilities
const meta = await callTool(client, "get_meta", {});
console.log("capabilities.actions:", meta.data.capabilities.actions.length, "| uiCommands:", meta.data.capabilities.uiCommands.join(","));
console.log("data freshness term-details:", meta.data.data.files["term-details.json"]);

// 8. Kill switch: disable → plan tools deny, catalog tools still work
await fetch(`${BASE}/consent/${SID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: false }) });
const denied = await callTool(client, "get_plan", {});
const stillOk = await callTool(client, "search_courses", { query: "linear algebra", limit: 1 });
console.log("kill switch: get_plan →", denied.data.error?.slice(0, 30), "| search still works:", stillOk.data.length === 1);
await fetch(`${BASE}/consent/${SID}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: true }) });
const restored = await callTool(client, "get_plan", {});
console.log("re-enabled: get_plan planName:", restored.data.planName);

await client.close();
console.log("E2E OK");
