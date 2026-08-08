// UNIT · src/core/semGrid.js + src/core/specialTermUtils.js — the timeline and
// the co-op/summer "spill" rule. Pure; no calendar adapter (uses the legacy
// NU-compatible fallback layout, which is deterministic).
//
// Scope note: the AY2026+ merged-summer "…50" split into synthetic Summer A/B
// (and the fullSummer double-count) lives in scripts/scrape-availability.js —
// the scrape layer — not here. What semGrid owns is the *slot* structure; what
// governs whether a term occupies one slot or spills into the next is termSpans,
// pinned below.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getSemSlotSH } from "../../src/core/planModel.js";
import { generateSemesters, deriveSemMaps, buildCohortSemesters } from "../../src/core/semGrid.js";
import { resolveTermByDuration, computeGrantedAttrs, termSpans } from "../../src/core/specialTermUtils.js";

// ── generateSemesters (legacy fallback layout) ────────────────────────
test("generateSemesters › always prepends the Incoming Credit slot at index 0", () => {
  const sems = generateSemesters(2024, 1);
  assert.equal(sems[0].id, "incoming");
  assert.equal(sems[0].type, "special");
});

test("generateSemesters › one year › fall, spring, and two summer slots with correct themes", () => {
  const sems = generateSemesters(2024, 1);
  const ids = sems.map(s => s.id);
  assert.deepEqual(ids, ["incoming", "fall2024", "spr2025", "sumA2025", "sumB2025"]);
  const byId = Object.fromEntries(sems.map(s => [s.id, s]));
  assert.equal(byId.fall2024.type, "fall");
  assert.equal(byId.spr2025.type, "spring");
  assert.equal(byId.sumA2025.type, "summer");
  assert.equal(byId.sumB2025.type, "summer");
  // Summer slots are half-weight (they carry half the term load).
  assert.equal(byId.fall2024.weight, 1.0);
  assert.equal(byId.sumA2025.weight, 0.5);
});

test("generateSemesters › distinct semTypeId per summer session (drives offering checks)", () => {
  const byId = Object.fromEntries(generateSemesters(2024, 1).map(s => [s.id, s]));
  assert.equal(byId.sumA2025.semTypeId, "sumA");
  assert.equal(byId.sumB2025.semTypeId, "sumB");
});

// ── deriveSemMaps ─────────────────────────────────────────────────────
test("deriveSemMaps › INDEX is ordinal; NEXT/PREV chain adjacent semesters", () => {
  const sems = generateSemesters(2024, 1); // incoming, fall2024, spr2025, sumA2025, sumB2025
  const { SEM_INDEX, SEM_NEXT, SEM_PREV } = deriveSemMaps(sems);
  assert.equal(SEM_INDEX.incoming, 0);
  assert.equal(SEM_INDEX.fall2024, 1);
  assert.equal(SEM_NEXT.incoming, "fall2024");
  assert.equal(SEM_PREV.fall2024, "incoming");
  // Endpoints have no neighbour past the edge.
  assert.equal(SEM_NEXT.sumB2025, undefined);
  assert.equal(SEM_PREV.incoming, undefined);
});

// ── buildCohortSemesters ──────────────────────────────────────────────
test("buildCohortSemesters › keeps incoming first and ends at the graduation term", () => {
  const sems = buildCohortSemesters("fall", 2024, "spring", 2026);
  const ids = sems.map(s => s.id);
  assert.equal(ids[0], "incoming");
  assert.ok(ids.includes("fall2024"), "entry term present");
  assert.equal(ids[ids.length - 1], "spr2026", "graduation term is the last row");
});

// ── termSpans — the spill rule (co-op / summer double-occupancy) ──────
test("termSpans › a term spans only when it out-weighs the slot it sits in", () => {
  assert.equal(termSpans(2.0, 1.0), true,  "6-month co-op over a fall/spring slot spills");
  assert.equal(termSpans(1.0, 0.5), true,  "4-month co-op over a summer slot spills");
  assert.equal(termSpans(0.5, 0.5), false, "2-month term in a summer slot fits exactly");
  assert.equal(termSpans(1.0, 1.0), false, "equal weight does not spill");
});

// ── resolveTermByDuration ─────────────────────────────────────────────
test("resolveTermByDuration › matches on duration, falls back to the first entry", () => {
  const durations = [{ duration: 4, weight: 1.0 }, { duration: 6, weight: 2.0 }];
  assert.equal(resolveTermByDuration(durations, 6).weight, 2.0);
  assert.equal(resolveTermByDuration(durations, 99), durations[0], "unknown duration → first entry");
});

// ── computeGrantedAttrs ───────────────────────────────────────────────
test("computeGrantedAttrs › unions grants of placed terms, ignores unplaced/unknown", () => {
  const types = [
    { id: "coop", attributeGrants: ["EX"] },
    { id: "research", attributeGrants: ["EX", "IC"] },
  ];
  const specialTermPl = {
    t1: { typeId: "coop", semId: "fall2024" },   // placed → grants EX
    t2: { typeId: "research", semId: "spr2025" },// placed → grants EX, IC
    t3: { typeId: "coop", semId: null },          // not placed → contributes nothing
    t4: { typeId: "ghost", semId: "fall2024" },   // unknown type → contributes nothing
  };
  const granted = computeGrantedAttrs(specialTermPl, types);
  assert.deepEqual([...granted].sort(), ["EX", "IC"]);
});

test("computeGrantedAttrs › no placed terms › empty set", () => {
  assert.equal(computeGrantedAttrs({}, []).size, 0);
});

// ── Slot credit hours ────────────────────────────────────────────────────────
//
// The distinction the whole slot design rests on: a slot counts toward what a
// TERM looks like, and never toward graduation. 51% of an undergraduate sample
// plan's credit is a slot, so a term that ignored them would read at half the
// load its department printed — and a plan that counted them toward the degree
// would tell a student they are most of the way through a degree they have not
// chosen a single course for.

test("slot SH › a slot contributes to its term", () => {
  const slots = {
    a: { id: "a", semId: "fall2026", sh: 4 },
    b: { id: "b", semId: "fall2026", sh: 4 },
    c: { id: "c", semId: "spr2027", sh: 4 },
  };
  assert.equal(getSemSlotSH("fall2026", slots), 8);
  assert.equal(getSemSlotSH("spr2027", slots), 4);
  assert.equal(getSemSlotSH("sumA2027", slots), 0);
});

test("slot SH › a work term takes none of it", () => {
  // A co-op semester is not a study load however much is parked in it — the
  // same rule courses already follow through getSemStudySH.
  const slots = { a: { id: "a", semId: "spr2027", sh: 4 } };
  assert.equal(getSemSlotSH("spr2027", slots, { spr2027: "coop-1" }), 0);
  assert.equal(getSemSlotSH("spr2027", slots, {}, { spr2027: "coop-1" }), 0);
});

test("slot SH › a slot with no stated hours contributes nothing", () => {
  // 0.9% of grid cells have no hours column — they are prose notes rather than
  // slots, and must not be counted as free credit.
  assert.equal(getSemSlotSH("fall2026", { a: { id: "a", semId: "fall2026" } }), 0);
});

test("slot SH › empty and missing inputs are safe", () => {
  assert.equal(getSemSlotSH("fall2026", {}), 0);
  assert.equal(getSemSlotSH("fall2026", null), 0);
  assert.equal(getSemSlotSH("fall2026", undefined), 0);
});
