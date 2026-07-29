// INVARIANT · src/adapters/mcp/plannerActionAdapter.js — the mutation surface.
//
// Both MCP servers compose these same appliers (the Node server directly, the
// Cloudflare worker via the shared createServer), so the tool SET can't drift.
// What CAN drift is the docs the servers advertise (get_meta capabilities.actionDocs):
// this asserts ACTION_DOCS and the appliers stay in lockstep, and locks the action
// set so any add/remove is a deliberate, reviewed change.
//
// Tool-name/annotation introspection that needs the MCP SDK lives in
// mcp-server/test (run via `npm run test:mcp`) — that package has the SDK installed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { SUPPORTED_ACTIONS, ACTION_DOCS, SUPPORTED_UI_COMMANDS } from "../../src/adapters/mcp/plannerActionAdapter.js";

test("actions › SUPPORTED_ACTIONS is a unique list of UPPER_SNAKE names", () => {
  assert.ok(Array.isArray(SUPPORTED_ACTIONS) && SUPPORTED_ACTIONS.length > 0);
  assert.equal(new Set(SUPPORTED_ACTIONS).size, SUPPORTED_ACTIONS.length, "duplicate action name");
  for (const a of SUPPORTED_ACTIONS) assert.match(a, /^[A-Z][A-Z0-9_]+$/, `bad action name: ${a}`);
});

test("actions › ACTION_DOCS covers every action and vice versa (docs ↔ appliers parity)", () => {
  const docs = new Set(Object.keys(ACTION_DOCS));
  const undocumented = SUPPORTED_ACTIONS.filter((a) => !docs.has(a));
  const orphanDocs = [...docs].filter((a) => !SUPPORTED_ACTIONS.includes(a));
  assert.deepEqual(undocumented, [], `actions with no ACTION_DOCS entry: ${undocumented.join(", ")}`);
  assert.deepEqual(orphanDocs, [], `ACTION_DOCS entries with no applier: ${orphanDocs.join(", ")}`);
});

test("actions › the supported set matches the recorded surface (change is deliberate)", () => {
  // Update this list intentionally when adding/removing an action — it's the
  // review gate that a new mutation was meant to be exposed to Claude.
  const expected = [
    "ADD_COURSE", "REMOVE_COURSE", "MOVE_COURSE", "ADD_PLACED_OUT", "REMOVE_PLACED_OUT",
    "ADD_SUBSTITUTION", "REMOVE_SUBSTITUTION", "ADD_WORK_TERM", "REMOVE_WORK_TERM",
    "MOVE_WORK_TERM", "UPDATE_WORK_TERM", "SET_MAJOR", "SET_MAJOR2", "SET_STUDENT_TYPE",
    "SET_CONCENTRATION", "SET_MINOR1", "SET_MINOR2", "SET_BONUS_SH", "SET_SH_OVERRIDE",
    "SET_OFFERED_OVERRIDE", "SET_ENTRY", "SET_GRADUATION", "SET_CURRENT_SEM",
    "STAR_COURSE", "UNSTAR_COURSE", "ADD_TO_PALETTE", "REMOVE_FROM_PALETTE",
    "CREATE_PLAN", "RENAME_PLAN", "SWITCH_PLAN", "DELETE_PLAN",
  ];
  assert.deepEqual([...SUPPORTED_ACTIONS].sort(), [...expected].sort());
});

test("actions › UI commands are a unique UPPER_SNAKE list", () => {
  assert.ok(Array.isArray(SUPPORTED_UI_COMMANDS) && SUPPORTED_UI_COMMANDS.length > 0);
  assert.equal(new Set(SUPPORTED_UI_COMMANDS).size, SUPPORTED_UI_COMMANDS.length);
  for (const c of SUPPORTED_UI_COMMANDS) assert.match(c, /^[A-Z][A-Z0-9_]+$/);
});
