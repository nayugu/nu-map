// UNIT · the slot model — where slots live and what they are allowed to do.
//
// The property everything rests on: the semester grid sees slots, and nothing
// about the DEGREE ever does. Two earlier designs got this wrong in opposite
// directions — one put slots in `placements` where graduation credit found
// them, the other kept them so separate that half the app never learned they
// existed — so these tests pin the seam rather than the plumbing.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SLOT_PREFIX, isSlotId, slotId, unfilledSlots,
  withSlots, withSlotCards,
  moveSlot, fillSlot, emptySlot, removeSlot, reopenOrphanedSlots,
  provenanceOf, canFill, semesterSlotSH,
} from "../../src/core/slotModel.js";

const slot = (over = {}) => ({
  id: "~slot:fall2029:khoury-elective:0",
  semId: "fall2029", label: "Khoury Elective", sh: 4,
  constraint: "inferred", candidates: [], filledBy: null, ...over,
});

// ── Identity ─────────────────────────────────────────────────────────────────

test("slot id › is distinguishable from a course without a lookup", () => {
  assert.ok(isSlotId(slotId("fall2029", "Khoury Elective", 0)));
  // The three id shapes that share this namespace must never collide.
  assert.ok(!isSlotId("CS2500"));
  assert.ok(!isSlotId("CS2500#2"));
  assert.ok(!isSlotId(undefined));
  assert.ok(!isSlotId(null));
});

test("slot id › carries no '#', which would read as a repeat instance", () => {
  assert.ok(!slotId("fall2029", "Take CS 2500 #2 again", 0).includes("#"));
});

test("slot id › is stable for the same slot and distinct for siblings", () => {
  // "General Elective" twice in one term is two slots, and re-applying the
  // template must land on the same two rather than adding more.
  assert.equal(slotId("sumB2027", "General Elective", 0), slotId("sumB2027", "General Elective", 0));
  assert.notEqual(slotId("sumB2027", "General Elective", 0), slotId("sumB2027", "General Elective", 1));
  assert.notEqual(slotId("sumB2027", "General Elective", 0), slotId("fall2026", "General Elective", 0));
});

// ── The seam: what the grid sees vs what the degree sees ─────────────────────

test("grid view › an unfilled slot has a position", () => {
  const slots = { a: slot({ id: "a" }) };
  assert.deepEqual(withSlots({ CS2500: "fall2026" }, slots),
    { CS2500: "fall2026", a: "fall2029" });
});

test("grid view › a FILLED slot adds nothing — its course is the placement", () => {
  // The whole point of the split. Once a course answers the reservation, the
  // course is an ordinary placement and the slot must not double it.
  const slots = { a: slot({ id: "a", filledBy: "CS4520" }) };
  const placements = { CS4520: "fall2029" };
  assert.deepEqual(withSlots(placements, slots), placements);
  assert.deepEqual(withSlotCards({ CS4520: {} }, slots), { CS4520: {} });
});

test("grid view › returns the input unchanged when there is nothing to add", () => {
  // Same courtesy applySubstitutions extends, so the memo downstream is cheap.
  const placements = { CS2500: "fall2026" };
  const courseMap = { CS2500: { id: "CS2500" } };
  assert.equal(withSlots(placements, {}), placements);
  assert.equal(withSlotCards(courseMap, {}), courseMap);
  assert.equal(withSlots(placements, { a: slot({ id: "a", filledBy: "X" }) }), placements);
});

test("grid view › a slot card carries the catalog's credit value", () => {
  // Without it a freshly loaded template reads at roughly half the credits the
  // department printed and every term looks like a warning that is not real.
  // Safe only because this map is DERIVED — nothing totalling degree credit
  // ever receives it.
  const cards = withSlotCards({}, { a: slot({ id: "a" }) });
  assert.equal(cards.a.sh, 4);
  assert.equal(cards.a.isSlot, true);
  assert.equal(cards.a.code, "Khoury Elective");
  // It must not look like a course to anything that inspects one.
  assert.equal(cards.a.subject, "");
  assert.equal(cards.a.prereqs, null);
  assert.deepEqual(cards.a.nuPath, []);
});

test("grid view › the inputs are never mutated", () => {
  const placements = { CS2500: "fall2026" };
  const courseMap = { CS2500: { id: "CS2500" } };
  withSlots(placements, { a: slot({ id: "a" }) });
  withSlotCards(courseMap, { a: slot({ id: "a" }) });
  assert.deepEqual(placements, { CS2500: "fall2026" });
  assert.deepEqual(Object.keys(courseMap), ["CS2500"]);
});

// ── Transitions ──────────────────────────────────────────────────────────────

test("transitions › filling records the answer without placing the course", () => {
  // Placement goes through the ordinary path, so a filled slot is an ordinary
  // course everywhere that matters.
  const slots = fillSlot({ a: slot({ id: "a" }) }, "a", "CS4520");
  assert.equal(slots.a.filledBy, "CS4520");
  assert.equal(slots.a.label, "Khoury Elective", "the reservation keeps its identity");
});

test("transitions › emptying gives the reservation back", () => {
  const filled = { a: slot({ id: "a", filledBy: "CS4520" }) };
  assert.equal(emptySlot(filled, "a").a.filledBy, null);
  // Idempotent, and unknown ids are inert.
  assert.equal(emptySlot({ a: slot({ id: "a" }) }, "a").a.filledBy, null);
  assert.deepEqual(removeSlot({}, "nope"), {});
});

test("transitions › only an unfilled slot moves; a filled one follows its course", () => {
  const open = { a: slot({ id: "a" }) };
  assert.equal(moveSlot(open, "a", "spr2030").a.semId, "spr2030");
  const filled = { a: slot({ id: "a", filledBy: "CS4520" }) };
  assert.equal(moveSlot(filled, "a", "spr2030"), filled, "position comes from the placement");
});

test("transitions › deleting the course reopens the slot", () => {
  // The department still says something belongs there, so removing the course
  // must leave the reservation rather than a hole.
  const slots = { a: slot({ id: "a", filledBy: "CS4520" }) };
  assert.equal(reopenOrphanedSlots(slots, {}).a.filledBy, null);
  // Still placed → untouched, and the same reference so no needless rerender.
  assert.equal(reopenOrphanedSlots(slots, { CS4520: "fall2029" }), slots);
});

// ── Strictness follows the confidence of the source ──────────────────────────

test("canFill › an exact slot is closed, because the catalog printed the codes", () => {
  const s = slot({ constraint: "exact", candidates: ["CS4530", "CS4535"] });
  assert.equal(canFill(s, "CS4530"), true);
  assert.equal(canFill(s, "PHIL1145"), false);
});

test("canFill › an INFERRED slot is open, because we guessed which requirement it is", () => {
  // The elimination matcher can be wrong — "Computing and social issues" is
  // the catalog's own name for a section it calls "Supporting Course" — and a
  // guess has no business closing a door.
  const s = slot({ constraint: "inferred", candidates: ["HIST2220"] });
  assert.equal(canFill(s, "PHIL1145"), true);
});

test("canFill › an open slot takes anything", () => {
  assert.equal(canFill(slot({ constraint: "open" }), "PHIL1145"), true);
});

test("canFill › a substitution widens even the closed case", () => {
  // What keeps a hard slot consistent with a planner that warns but does not
  // stop: an advisor-approved swap is recorded once and then works everywhere,
  // instead of being a silent mismatch or a blocked student.
  const s = slot({ constraint: "exact", candidates: ["CS4530"] });
  assert.equal(canFill(s, "CS4400", [{ from: "CS4400", to: "CS4530" }]), true);
  // and only in the direction stated
  assert.equal(canFill(s, "CS4400", [{ from: "CS4530", to: "CS4400" }]), false);
});

test("canFill › a missing slot is never fillable", () => {
  assert.equal(canFill(null, "CS2500"), false);
  assert.equal(canFill(undefined, "CS2500"), false);
});

// ── Questions the UI asks ────────────────────────────────────────────────────

test("provenance › a placed course knows which reservation it answered", () => {
  const slots = { a: slot({ id: "a", filledBy: "CS4520" }), b: slot({ id: "b" }) };
  assert.equal(provenanceOf(slots, "CS4520").label, "Khoury Elective");
  assert.equal(provenanceOf(slots, "CS2500"), null);
});

test("slot SH › counts only what is still unfilled, per semester", () => {
  const slots = {
    a: slot({ id: "a", semId: "fall2029", sh: 4 }),
    b: slot({ id: "b", semId: "fall2029", sh: 4 }),
    c: slot({ id: "c", semId: "fall2029", sh: 4, filledBy: "CS4520" }),
    d: slot({ id: "d", semId: "spr2030", sh: 4 }),
  };
  assert.equal(semesterSlotSH(slots, "fall2029"), 8, "the filled one is the course's credit now");
  assert.equal(semesterSlotSH(slots, "spr2030"), 4);
  assert.equal(semesterSlotSH(slots, "sumA2030"), 0);
  assert.equal(semesterSlotSH({}, "fall2029"), 0);
});

test("slot SH › a slot with no stated hours contributes nothing", () => {
  // 0.9% of grid cells have no hours column; they are prose notes, not credit.
  assert.equal(semesterSlotSH({ a: slot({ sh: null }) }, "fall2029"), 0);
});
