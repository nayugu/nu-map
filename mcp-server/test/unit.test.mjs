// Unit tests for the pure MCP adapter layer (no server, no real data).
// Run: npm test  (node --test)
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyChangeset,
  completedCourseIds,
  checkViolations,
  SUPPORTED_ACTIONS,
} from "../../src/adapters/mcp/plannerActionAdapter.js";
import {
  semTypeProb,
  effectiveOffered,
  seatStats,
} from "../../src/adapters/northeastern/offeringStats.js";
import {
  deriveTerms,
  computeBirthTermCode,
  sanitizeDesc,
  normalizeCourse,
} from "../../src/adapters/northeastern/courseNorm.js";
import { resolveInMap, parseMajorPathParts } from "../../src/data/programPaths.js";
import * as planState from "../src/planState.js";

// ── Fixtures ────────────────────────────────────────────────────────

const courseMap = {
  CS1000: { id: "CS1000", prereqs: [], coreqs: [] },
  CS2000: { id: "CS2000", prereqs: [{ subject: "CS", number: "1000" }], coreqs: [] },
  CS2001: { id: "CS2001", prereqs: [], coreqs: [{ subject: "CS", number: "2000" }] },
};

const basePlan = () => ({
  placements: { CS1000: "fall2024", CS2000: "spr2025" },
  placedOut: [], substitutions: [], workExperience: {},
  shOverrides: {}, offeredOverrides: {},
  currentSemId: "fall2025",
});

// ── plannerActionAdapter ────────────────────────────────────────────

test("applyChangeset applies actions to a clone and never mutates the input", () => {
  const plan = basePlan();
  const { plan: next, appliedCount } = applyChangeset(
    plan, [{ type: "MOVE_COURSE", courseId: "CS2000", toSemId: "fall2025" }], courseMap
  );
  assert.equal(appliedCount, 1);
  assert.equal(next.placements.CS2000, "fall2025");
  assert.equal(plan.placements.CS2000, "spr2025"); // original untouched
});

test("applyChangeset skips and reports unknown action types (tolerant reader)", () => {
  const { appliedCount, unsupported } = applyChangeset(
    basePlan(),
    [{ type: "SET_FROM_THE_FUTURE" }, { type: "SET_BONUS_SH", amount: 8 }],
    courseMap
  );
  assert.equal(appliedCount, 1);
  assert.deepEqual(unsupported, ["SET_FROM_THE_FUTURE"]);
});

test("checkViolations flags wrong-order prereqs and split coreqs", () => {
  const plan = { ...basePlan(), placements: { CS2000: "fall2024", CS1000: "spr2025", CS2001: "fall2025" } };
  const v = checkViolations(plan, courseMap);
  assert.ok(v.some(x => x.type === "prereq" && x.courseId === "CS2000"));
  assert.ok(v.some(x => x.type === "coreq"  && x.courseId === "CS2001"));
});

test("completedCourseIds: incoming + semesters before currentSemId", () => {
  const plan = { ...basePlan(), placements: { A: "incoming", B: "fall2024", C: "fall2025", D: "spr2026" } };
  assert.deepEqual(completedCourseIds(plan).sort(), ["A", "B"]);
});

test("palette/star actions maintain their lists; ADD_COURSE clears palette", () => {
  const plan = { ...basePlan(), palette: ["CS2001"], starredIds: [] };
  const { plan: next } = applyChangeset(plan, [
    { type: "STAR_COURSE", courseId: "CS1000" },
    { type: "ADD_TO_PALETTE", courseId: "CS1000" },   // no-op: already placed
    { type: "ADD_COURSE", courseId: "CS2001", semId: "fall2025" },
  ], courseMap);
  assert.deepEqual(next.starredIds, ["CS1000"]);
  assert.deepEqual(next.palette, []);                  // placing removed it
  assert.equal(next.placements.CS2001, "fall2025");
});

test("argument validation rejects nonsense with reasons instead of applying it", () => {
  const cm = { ...courseMap, VAR1: { id: "VAR1", sh: 1, shMin: 1, shMax: 4, prereqs: [], coreqs: [] } };
  const { plan: next, invalid, appliedCount } = applyChangeset(basePlan(), [
    { type: "ADD_COURSE", courseId: "NOPE123", semId: "fall2025" },      // unknown course
    { type: "ADD_COURSE", courseId: "CS2001", semId: "garbage" },        // bad semId
    { type: "SET_SH_OVERRIDE", courseId: "CS1000", value: 2 },           // fixed-credit course
    { type: "SET_SH_OVERRIDE", courseId: "VAR1", value: 9 },             // out of range
    { type: "SET_SH_OVERRIDE", courseId: "VAR1", value: 3 },             // valid
    { type: "SET_OFFERED_OVERRIDE", courseId: "CS1000", semTypeId: "SP", status: false }, // bad semTypeId
    { type: "SET_STUDENT_TYPE", studentType: "phd" },                    // bad value
    { type: "SET_BONUS_SH", amount: "12" },                              // string, not number
  ], cm);
  assert.equal(appliedCount, 1);
  assert.equal(invalid.length, 7);
  assert.ok(invalid.find(x => x.type === "SET_SH_OVERRIDE" && x.reason.includes("fixed credits")));
  assert.equal(next.shOverrides.VAR1, 3);
  assert.equal(next.placements.NOPE123, undefined);      // nothing leaked
});

test("substitutions validate both courses and reject removing a missing pair", () => {
  const { plan: next, invalid, appliedCount } = applyChangeset(basePlan(), [
    { type: "ADD_SUBSTITUTION", fromId: "CS1000", toId: "GHOST999" },      // unknown toId
    { type: "ADD_SUBSTITUTION", fromId: "CS1000" },                        // missing toId
    { type: "ADD_SUBSTITUTION", fromId: "CS1000", toId: "CS2000" },        // valid
    { type: "REMOVE_SUBSTITUTION", fromId: "CS1000", toId: "CS2001" },     // pair doesn't exist
    { type: "REMOVE_SUBSTITUTION", fromId: "CS1000", toId: "CS2000" },     // valid (added above)
  ], courseMap);
  assert.equal(appliedCount, 2);
  assert.equal(invalid.length, 3);
  assert.ok(invalid.find(x => x.type === "ADD_SUBSTITUTION" && x.reason.includes("Unknown course: GHOST999")));
  assert.ok(invalid.find(x => x.type === "ADD_SUBSTITUTION" && x.reason.includes("toId is required")));
  assert.ok(invalid.find(x => x.type === "REMOVE_SUBSTITUTION" && x.reason.includes("No substitution")));
  assert.deepEqual(next.substitutions, []);
});

test("SET_STUDENT_TYPE clears programs, so type-then-program order works", () => {
  const plan = { ...basePlan(), major: "2026/x/old_major", concentration: "Old" };
  const { plan: next } = applyChangeset(plan, [
    { type: "SET_STUDENT_TYPE", studentType: "graduate" },
    { type: "SET_MAJOR", programId: "2026/y/new_ms" },
    { type: "SET_CONCENTRATION", label: "ML" },
  ], courseMap);
  assert.equal(next.studentType, "graduate");
  assert.equal(next.major, "2026/y/new_ms");             // survived the clear
  assert.equal(next.concentration, "ML");
});

test("action registry covers the port's documented types", () => {
  for (const t of ["SET_MAJOR2", "SET_STUDENT_TYPE", "STAR_COURSE", "ADD_TO_PALETTE"]) {
    assert.ok(SUPPORTED_ACTIONS.includes(t), `${t} missing from registry`);
  }
});

// ── offeringStats ───────────────────────────────────────────────────

test("semTypeProb excludes pre-birth entries and needs ≥2 data points", () => {
  const hist = { 202310: false, 202410: true, 202510: true, 202610: false };
  // birth = 202410 → falls: 202410 T, 202510 T, 202610 F → 2/3
  assert.ok(Math.abs(semTypeProb(hist, 202410, "fall") - 2 / 3) < 1e-9);
  // only one spring entry → null
  assert.equal(semTypeProb({ 202430: true }, null, "spring"), null);
});

test("effectiveOffered: override beats history; no-data defaults offered", () => {
  const hist = { 202410: false, 202510: false };
  assert.deepEqual(
    effectiveOffered(hist, null, "fall", { fall: true }),
    { offered: true, source: "override", prob: 0 }
  );
  assert.equal(effectiveOffered(hist, null, "fall").offered, false);
  assert.equal(effectiveOffered({}, null, "fall").source, "no-data");
});

test("seatStats derives fill/open/perSec exactly as the gauge does", () => {
  const s = seatStats(112, 125, 1);
  assert.equal(s.fill, 90);
  assert.equal(s.open, 13);
  assert.equal(s.perSec, 13);
  assert.equal(s.availability, "room");
  assert.equal(seatStats(10, 0, 1), null); // no capacity → no stats
});

// ── courseNorm ──────────────────────────────────────────────────────

test("deriveTerms applies the ≥2/3 rule post-birth only", () => {
  const hist = { 202210: false, 202310: false, 202410: true, 202510: true };
  const birth = computeBirthTermCode(hist);
  assert.equal(birth, 202410);
  assert.deepEqual(deriveTerms(hist, birth), ["fall"]);   // 2/2 post-birth = 100%
  assert.deepEqual(deriveTerms(hist, null), []);          // 2/4 = 50% is below the 2/3 bar
});

test("normalizeCourse: credit ranges, CPS flag, id shape", () => {
  const c = normalizeCourse(
    { subject: "cps ", number: "1100", title: "T", credits: 1, creditsMax: 4, description: "Open only to nobody" },
    { CPS: "PS" }
  );
  assert.equal(c.id, "CPS1100");
  assert.equal(c.sh, 1);
  assert.equal(c.shMax, 4);
  assert.equal(c.isCps, true);
  assert.equal(c.desc, "");   // restriction-only description sanitized away
});

test("sanitizeDesc keeps real content", () => {
  assert.equal(sanitizeDesc("Covers algorithms."), "Covers algorithms.");
});

// ── programPaths ────────────────────────────────────────────────────

test("resolveInMap: newest year wins across tiers", () => {
  const map = {
    "2026/khoury/cs_bscs_(boston)": 1,
    "2025/khoury/cs_bscs_(boston)": 1,
    "2026/newcollege/data_&_stuff": 1,
  };
  const p = parseMajorPathParts;
  assert.equal(resolveInMap(map, "2024/khoury/cs_bscs_(boston)", p), "2026/khoury/cs_bscs_(boston)");
  assert.equal(resolveInMap(map, "2024/oldcollege/data_and_stuff", p), "2026/newcollege/data_&_stuff");
  assert.equal(resolveInMap(map, "2024/khoury/never_existed", p), null);
});

// ── planState (revision + envelope + consent) ──────────────────────

test("planState: revisions, change feed, and read-marking", () => {
  const sid = "unit-test-1";
  planState.setPlan(sid, { placements: { A: "fall2025" } });
  planState.setPlan(sid, { placements: { A: "spr2026", B: "fall2025" } });

  const env1 = planState.planEnvelope(sid);
  assert.equal(env1.rev, 2);
  assert.equal(env1.changedSinceLastRead, true);
  assert.ok(env1.recentChanges.some(c => c.includes("A moved fall2025 → spr2026")));
  assert.ok(env1.recentChanges.some(c => c.includes("B placed in fall2025")));

  const env2 = planState.planEnvelope(sid);
  assert.equal(env2.changedSinceLastRead, false);  // read pointer advanced
});

test("planState: claude's own applies don't flag changedSinceLastRead", () => {
  const sid = "unit-test-2";
  planState.setPlan(sid, { placements: {} });
  planState.planEnvelope(sid); // mark read
  planState.setPlan(sid, { placements: { X: "fall2025" } }, "claude");
  const env = planState.planEnvelope(sid);
  assert.equal(env.changedSinceLastRead, false);   // Claude already knows what it did
  assert.equal(env.recentChanges, undefined);
});

test("planState: proposal resolution reaches the envelope", () => {
  const sid = "unit-test-2b";
  planState.setPlan(sid, { placements: {} });
  planState.planEnvelope(sid); // mark read
  const id = planState.addProposal(sid, { actions: [{ type: "SET_BONUS_SH", amount: 4 }] });
  planState.resolveProposal(sid, id, true);
  const env = planState.planEnvelope(sid);
  assert.equal(env.changedSinceLastRead, true);
  assert.ok(env.recentChanges.some(c => c.includes(`${id} approved by user`)));
  assert.equal(planState.listProposals(sid).find(p => p.id === id).status, "approved");
});

test("planState: everything defaults OFF until paired", () => {
  const sid = "unit-test-3";
  const c = planState.getConsent(sid);
  assert.deepEqual(
    { paired: c.paired, enabled: c.enabled, autoApply: c.autoApply },
    { paired: false, enabled: false, autoApply: false }
  );
  // enabled cannot be forced on while unpaired
  planState.setConsent(sid, { enabled: true, autoApply: true });
  assert.equal(planState.getConsent(sid).enabled, false);
  assert.equal(planState.getConsent(sid).autoApply, false);
});

test("planState: pairing codes — wrong/expired rejected, right code links", () => {
  const sid = "unit-test-3b";
  const { code } = planState.createPairingCode(sid);
  assert.match(code, /^[A-Z2-9]{6}$/);
  assert.equal(planState.confirmPairing(sid, "WRONG1"), false);
  assert.equal(planState.getConsent(sid).paired, false);
  assert.equal(planState.confirmPairing(sid, code.toLowerCase()), true); // case-insensitive
  assert.equal(planState.getConsent(sid).paired, true);
  assert.equal(planState.getConsent(sid).enabled, true);
  // codes are single-use: same code again fails
  assert.equal(planState.confirmPairing(sid, code), false);
});

test("planState: unpair resets everything; kill switch pauses without unpairing", () => {
  const sid = "unit-test-3c";
  const { code } = planState.createPairingCode(sid);
  planState.confirmPairing(sid, code);
  planState.setConsent(sid, { autoApply: true });
  planState.setConsent(sid, { enabled: false });        // pause
  assert.deepEqual(
    (({ paired, enabled, autoApply }) => ({ paired, enabled, autoApply }))(planState.getConsent(sid)),
    { paired: true, enabled: false, autoApply: true }
  );
  planState.setConsent(sid, { unpair: true });          // disconnect
  assert.deepEqual(
    (({ paired, enabled, autoApply }) => ({ paired, enabled, autoApply }))(planState.getConsent(sid)),
    { paired: false, enabled: false, autoApply: false }
  );
});

test("every tool surfaces a title and read-only/destructive annotations", async () => {
  const { createServer } = await import("../src/server.js");
  const stubQuery = { meta: {}, getSources: () => [] };
  const server = createServer({ query: stubQuery, sessionId: "ann-test", state: planState, channel: { broadcast() {}, clientCount: () => 0 } });
  const tools = server._registeredTools;
  const names = Object.keys(tools);
  assert.ok(names.length >= 17, `expected ≥17 tools, got ${names.length}`);
  for (const name of names) {
    const ann = tools[name].annotations;
    assert.ok(ann?.title, `${name} missing annotations.title`);
    assert.ok(typeof ann.readOnlyHint === "boolean", `${name} missing readOnlyHint`);
    assert.ok(typeof ann.destructiveHint === "boolean", `${name} missing destructiveHint`);
  }
  // The one destructive-capable tool is apply_changes (DELETE_PLAN)
  assert.equal(tools.apply_changes.annotations.destructiveHint, true);
  assert.equal(tools.get_plan.annotations.readOnlyHint, true);
});

test("planState: plan-contents request resolves or times out", async () => {
  const sid = "unit-test-4";
  const { requestId, promise } = planState.createPlanRequest(sid, 50);
  assert.equal(planState.resolvePlanRequest(sid, requestId, { planName: "Other" }), true);
  assert.deepEqual(await promise, { planName: "Other" });

  const t = planState.createPlanRequest(sid, 30);
  assert.equal(await t.promise, null); // timeout → null
});
